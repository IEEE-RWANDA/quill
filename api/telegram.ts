import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAllowed } from "../lib/auth.js";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  escapeHtml,
  type InlineKeyboard,
} from "../lib/telegram.js";
import { findSite, tokenForSite } from "../lib/sites.js";
import { route, rewrite } from "../lib/claude.js";
import {
  getFile,
  openPullRequest,
  mergePullRequest,
  closePullRequest,
  prUrl,
} from "../lib/github.js";

// Allow up to 60s — the message flow makes two Claude calls plus a few GitHub
// calls. This still returns well within Telegram's webhook timeout.
export const config = { maxDuration: 60 };

const HELP = [
  "<b>Quill</b> — chat-driven content editor for your sites.",
  "",
  "Just tell me what to change, e.g.:",
  "• <i>Add a vibecoded site: FooBar, https://foo.bar, a demo of X</i>",
  "• <i>Change the IEEE Rwanda Section description to \"...\"</i>",
  "",
  "I'll open a pull request and send you Merge / Discard buttons.",
].join("\n");

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  // Reject anything that isn't Telegram calling with our secret token.
  if (
    req.headers["x-telegram-bot-api-secret-token"] !==
    process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    res.status(401).send("unauthorized");
    return;
  }

  const update = req.body ?? {};
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.text) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("quill error:", err);
    const chatId =
      update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    if (chatId) {
      await sendMessage(
        chatId,
        "⚠️ Something went wrong handling that. Check the Vercel logs for details.",
      );
    }
  }

  // Always ack so Telegram doesn't retry the update.
  res.status(200).send("ok");
}

async function handleMessage(message: any): Promise<void> {
  const chatId: number = message.chat.id;
  const userId: number | undefined = message.from?.id;
  const text: string = message.text.trim();

  if (text === "/start" || text === "/help") {
    await sendMessage(chatId, HELP);
    return;
  }

  if (!isAllowed(userId)) {
    await sendMessage(
      chatId,
      `⛔ You're not authorized to use this bot. Your Telegram ID is <code>${userId}</code>.`,
    );
    return;
  }

  await sendMessage(chatId, "🪶 Working on it…");

  // 1. Figure out which site + file this request targets.
  const r = await route(text);
  const site = r.understood ? findSite(r.siteKey) : undefined;
  const file = site?.files.find((f) => f.key === r.fileKey);
  if (!r.understood || !site || !file) {
    const q = r.clarification || "I couldn't tell which site/section to edit.";
    await sendMessage(chatId, `❓ ${escapeHtml(q)}`);
    return;
  }

  // 2. Pull the current content from GitHub.
  const token = tokenForSite(site);
  const { content } = await getFile(
    token,
    site.owner,
    site.repo,
    file.path,
    site.baseBranch,
  );

  // 3. Have Claude produce the updated file.
  const edit = await rewrite({
    instruction: text,
    path: file.path,
    currentContent: content,
  });

  // Safety net: never open a PR with broken JSON.
  if (file.path.endsWith(".json")) {
    try {
      JSON.parse(edit.newContent);
    } catch {
      await sendMessage(
        chatId,
        "⚠️ The generated content wasn't valid JSON, so I didn't open a PR. Try rephrasing.",
      );
      return;
    }
  }

  // 4. Open a PR against the base branch.
  const branchName = `quill/${site.key}-${file.key}-${Date.now()}`;
  const title = `content: ${edit.summary}`.slice(0, 72);
  const prNumber = await openPullRequest({
    token,
    owner: site.owner,
    repo: site.repo,
    baseBranch: site.baseBranch,
    path: file.path,
    newContent: edit.newContent,
    branchName,
    title,
    body: `Requested via Quill (Telegram).\n\n${edit.summary}`,
  });

  // 5. Reply with a preview of the changed section + Merge/Discard buttons.
  const preview =
    `✅ <b>PR opened — ${escapeHtml(site.name)}</b>\n` +
    `<i>${escapeHtml(file.path)}</i>\n\n` +
    `<b>Change:</b> ${escapeHtml(edit.summary)}\n\n` +
    `<b>Updated section:</b>\n<pre>${escapeHtml(edit.changedSection)}</pre>\n\n` +
    `<a href="${prUrl(site.owner, site.repo, prNumber)}">Open PR #${prNumber} on GitHub</a>`;

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Merge", callback_data: `m:${site.key}:${prNumber}` },
        { text: "❌ Discard", callback_data: `d:${site.key}:${prNumber}` },
      ],
    ],
  };
  await sendMessage(chatId, preview, keyboard);
}

async function handleCallback(cq: any): Promise<void> {
  const userId: number | undefined = cq.from?.id;
  const chatId: number | undefined = cq.message?.chat?.id;
  const messageId: number | undefined = cq.message?.message_id;
  const data: string = cq.data ?? "";

  if (!isAllowed(userId)) {
    await answerCallbackQuery(cq.id, "Not authorized");
    return;
  }

  const [action, siteKey, prStr] = data.split(":");
  const prNumber = parseInt(prStr, 10);
  const site = findSite(siteKey);
  if (!site || Number.isNaN(prNumber)) {
    await answerCallbackQuery(cq.id, "Unknown action");
    return;
  }

  const token = tokenForSite(site);
  if (action === "m") {
    await mergePullRequest(token, site.owner, site.repo, prNumber);
    await answerCallbackQuery(cq.id, "Merged ✅");
    if (chatId && messageId) {
      await editMessageText(
        chatId,
        messageId,
        `✅ <b>Merged PR #${prNumber}</b> — ${escapeHtml(site.name)}. Deploying now.`,
      );
    }
  } else if (action === "d") {
    await closePullRequest(token, site.owner, site.repo, prNumber);
    await answerCallbackQuery(cq.id, "Discarded ❌");
    if (chatId && messageId) {
      await editMessageText(
        chatId,
        messageId,
        `❌ <b>Discarded PR #${prNumber}</b> — ${escapeHtml(site.name)}.`,
      );
    }
  } else {
    await answerCallbackQuery(cq.id, "Unknown action");
  }
}

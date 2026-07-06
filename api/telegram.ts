import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isKnownUser, canEditSite } from "../lib/auth.js";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  escapeHtml,
  downloadTelegramFile,
  type InlineKeyboard,
  type ReplyKeyboard,
} from "../lib/telegram.js";
import { sites, findSite, tokenForSite, type Site, type ContentFile } from "../lib/sites.js";
import { route, rewrite } from "../lib/claude.js";
import {
  getFile,
  getFileSha,
  getBranchSha,
  createBranch,
  commitFile,
  createPr,
  openPullRequest,
  mergePullRequest,
  closePullRequest,
  prUrl,
} from "../lib/github.js";
import { friendlyError } from "../lib/errors.js";

// Allow up to 60s — the message flow makes two Claude calls plus a few GitHub
// calls. This still returns well within Telegram's webhook timeout.
export const config = { maxDuration: 60 };

const HELP = [
  "<b>Quill</b> — chat-driven content editor for your sites.",
  "",
  "Two ways to edit:",
  "• Tap <b>📋 Edit a section</b> below to pick from a list, or",
  "• Just type what to change, e.g. <i>Change the Weightless description to \"...\"</i>",
  "",
  "Either way, I open a pull request and send you Merge / Discard buttons.",
].join("\n");

// Persistent button menu shown under the message field.
const BTN_EDIT = "📋 Edit a section";
const BTN_SITES = "🌐 My websites";
const BTN_HELP = "❓ Help";

const MAIN_KEYBOARD: ReplyKeyboard = {
  keyboard: [
    [{ text: BTN_EDIT }],
    [{ text: BTN_SITES }, { text: BTN_HELP }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Tap a button or type a change…",
};

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
    } else if (update.message?.photo) {
      await handlePhoto(update.message);
    } else if (update.message?.text) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("quill error:", err);
    const chatId =
      update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    if (chatId) {
      await sendMessage(chatId, friendlyError(err));
    }
  }

  // Always ack so Telegram doesn't retry the update.
  res.status(200).send("ok");
}

async function handleMessage(message: any): Promise<void> {
  const chatId: number = message.chat.id;
  const userId: number | undefined = message.from?.id;
  const text: string = message.text.trim();

  // Greeting / help — also (re)shows the persistent button menu for editors.
  if (text === "/start" || text === "/help" || text === BTN_HELP) {
    if (!isKnownUser(userId, sites)) {
      await sendMessage(
        chatId,
        `👋 Hi! Quill is restricted to approved editors.\nYour Telegram ID is <code>${userId}</code> — send it to an admin to get access.`,
      );
      return;
    }
    await sendMessage(chatId, HELP, MAIN_KEYBOARD);
    return;
  }

  // Refuse strangers up front — before spending any Claude calls.
  if (!isKnownUser(userId, sites)) {
    await sendMessage(
      chatId,
      `⛔ You're not authorized to use this bot. Your Telegram ID is <code>${userId}</code>.`,
    );
    return;
  }

  if (text === "/sections" || text === BTN_EDIT) {
    await showSections(chatId, userId);
    return;
  }

  if (text === "/sites" || text === BTN_SITES) {
    await listMySites(chatId, userId);
    return;
  }

  // If this message is a reply to a "pick a section" prompt, we already know the
  // target — skip Claude routing and edit that section directly. The section is
  // encoded in the prompt text (see showSections / the pick button), so no state
  // storage is needed.
  const repliedText: string | undefined = message.reply_to_message?.text;
  const marker = repliedText?.match(/Section:\s*([\w-]+)\/([\w-]+)/);
  if (marker) {
    const site = findSite(marker[1]);
    const file = site?.files.find((f) => f.key === marker[2]);
    if (site && file) {
      if (!canEditSite(userId, site)) {
        await sendMessage(
          chatId,
          `⛔ You're not authorized to edit <b>${escapeHtml(site.name)}</b>.`,
        );
        return;
      }
      await sendMessage(chatId, "🪶 Working on it…");
      await performEdit(chatId, site, file, text);
      return;
    }
  }

  await sendMessage(chatId, "🪶 Working on it…");

  // Otherwise, let Claude figure out which site + file this targets.
  const r = await route(text);
  const site = r.understood ? findSite(r.siteKey) : undefined;
  const file = site?.files.find((f) => f.key === r.fileKey);
  if (!r.understood || !site || !file) {
    const q = r.clarification || "I couldn't tell which site/section to edit.";
    await sendMessage(
      chatId,
      `❓ ${escapeHtml(q)}\n\nTip: send /sections to pick from a list.`,
    );
    return;
  }

  if (!canEditSite(userId, site)) {
    await sendMessage(
      chatId,
      `⛔ You're not authorized to edit <b>${escapeHtml(site.name)}</b>.`,
    );
    return;
  }

  await performEdit(chatId, site, file, text);
}

// Chunks a flat button list into grid rows.
function grid<T>(items: T[], perRow: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
}

// Step 1 of the picker — the websites this user can edit, as a domain grid.
async function showSections(
  chatId: number,
  userId: number | undefined,
): Promise<void> {
  const editable = sites.filter((s) => canEditSite(userId, s));
  if (editable.length === 0) {
    await sendMessage(chatId, "You don't have permission to edit any sites yet.");
    return;
  }
  const buttons = editable.map((s) => ({
    text: s.label,
    callback_data: `site:${s.key}`,
  }));
  await sendMessage(chatId, "📋 <b>Pick a website</b>", {
    inline_keyboard: grid(buttons, 2),
  });
}

// Step 2 — the sections of a chosen website, as a grid.
async function showSiteSections(chatId: number, site: Site): Promise<void> {
  const buttons = site.files.map((f) => ({
    text: f.key,
    callback_data: `pick:${site.key}:${f.key}`,
  }));
  await sendMessage(
    chatId,
    `✏️ <b>${escapeHtml(site.label)}</b> — pick a section, then reply with your change.`,
    { inline_keyboard: grid(buttons, 2) },
  );
}

// Lists the sites this user can edit and what's editable on each.
async function listMySites(
  chatId: number,
  userId: number | undefined,
): Promise<void> {
  const editable = sites.filter((s) => canEditSite(userId, s));
  if (editable.length === 0) {
    await sendMessage(chatId, "You don't have permission to edit any sites yet.");
    return;
  }
  const lines = ["🌐 <b>Websites you can edit</b>", ""];
  for (const s of editable) {
    lines.push(`<b>${escapeHtml(s.label)}</b> — ${s.files.map((f) => escapeHtml(f.key)).join(", ")}`);
  }
  lines.push("");
  lines.push("Tap 📋 Edit a section to change any of these.");
  await sendMessage(chatId, lines.join("\n"));
}

// Handles a photo the user sent. It must be a reply to a "pick a section"
// prompt (so we know where it belongs); the caption describes the item. Quill
// commits the image into the repo's public/ folder and sets the item's image
// path — all in one PR.
async function handlePhoto(message: any): Promise<void> {
  const chatId: number = message.chat.id;
  const userId: number | undefined = message.from?.id;
  const caption: string = (message.caption ?? "").trim();

  if (!isKnownUser(userId, sites)) {
    await sendMessage(chatId, "⛔ You're not authorized to use this bot.");
    return;
  }

  const repliedText: string | undefined = message.reply_to_message?.text;
  const marker = repliedText?.match(/Section:\s*([\w-]+)\/([\w-]+)/);
  if (!marker) {
    await sendMessage(
      chatId,
      "📷 To add a photo, first tap <b>📋 Edit a section</b>, pick a section, then <b>reply to that prompt with your photo</b> and a caption describing the item (e.g. the event details).",
    );
    return;
  }

  const site = findSite(marker[1]);
  const file = site?.files.find((f) => f.key === marker[2]);
  if (!site || !file) {
    await sendMessage(chatId, "❓ I couldn't match that to a section. Try /sections again.");
    return;
  }
  if (!canEditSite(userId, site)) {
    await sendMessage(chatId, `⛔ You're not authorized to edit <b>${escapeHtml(site.name)}</b>.`);
    return;
  }

  // Largest rendition of the photo.
  const photos = message.photo as { file_id: string }[];
  const fileId = photos[photos.length - 1].file_id;

  await sendMessage(chatId, "🪶 Uploading the image and preparing your change…");
  await performPhotoAdd(chatId, site, file, caption, fileId);
}

async function performPhotoAdd(
  chatId: number,
  site: Site,
  file: ContentFile,
  caption: string,
  fileId: string,
): Promise<void> {
  const token = tokenForSite(site);

  // 1. Download the image from Telegram.
  const { base64, ext } = await downloadTelegramFile(fileId);
  const imgName = `quill-${Date.now()}.${ext}`;
  const repoImagePath = `public/uploads/${imgName}`;
  const publicUrl = `/uploads/${imgName}`; // Next serves public/ at the site root

  // 2. Ask Claude to build the item, pointing its image/photo field at publicUrl.
  const { content } = await getFile(token, site.owner, site.repo, file.path, site.baseBranch);
  const instruction =
    (caption || "Add a new item.") +
    `\n\n(Set the new or edited item's image/photo field to "${publicUrl}".)`;
  const edit = await rewrite({ instruction, path: file.path, currentContent: content });

  if (file.path.endsWith(".json")) {
    try {
      JSON.parse(edit.newContent);
    } catch {
      await sendMessage(
        chatId,
        "⚠️ The generated content wasn't valid JSON, so I didn't open a PR. Try rephrasing the caption.",
      );
      return;
    }
  }

  // 3. Branch, commit the image, commit the JSON, open the PR.
  const branchName = `quill/${site.key}-${file.key}-${Date.now()}`;
  const baseSha = await getBranchSha(token, site.owner, site.repo, site.baseBranch);
  await createBranch(token, site.owner, site.repo, branchName, baseSha);
  await commitFile(token, site.owner, site.repo, branchName, repoImagePath, base64, `Add image ${imgName}`);
  const jsonSha = await getFileSha(token, site.owner, site.repo, file.path, site.baseBranch);
  await commitFile(
    token,
    site.owner,
    site.repo,
    branchName,
    file.path,
    Buffer.from(edit.newContent, "utf-8").toString("base64"),
    `content: ${edit.summary}`.slice(0, 72),
    jsonSha,
  );
  const prNumber = await createPr(
    token,
    site.owner,
    site.repo,
    site.baseBranch,
    branchName,
    `content: ${edit.summary}`.slice(0, 72),
    `Requested via Quill (Telegram) with an uploaded image.\n\n${edit.summary}`,
  );

  const preview =
    `✅ <b>PR opened — ${escapeHtml(site.name)}</b>\n` +
    `<i>${escapeHtml(file.path)}</i> + <i>${escapeHtml(repoImagePath)}</i>\n\n` +
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

// Fetch → rewrite via Claude → open PR → reply with preview + buttons.
async function performEdit(
  chatId: number,
  site: Site,
  file: ContentFile,
  instruction: string,
): Promise<void> {
  const token = tokenForSite(site);
  const { content } = await getFile(
    token,
    site.owner,
    site.repo,
    file.path,
    site.baseBranch,
  );

  const edit = await rewrite({
    instruction,
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
  const parts: string[] = (cq.data ?? "").split(":");
  const action = parts[0];

  const site = findSite(parts[1]);
  if (!site) {
    await answerCallbackQuery(cq.id, "Unknown action");
    return;
  }
  if (!canEditSite(userId, site)) {
    await answerCallbackQuery(cq.id, "Not authorized");
    return;
  }

  // "site" — user chose a website from the grid; show its sections.
  if (action === "site") {
    if (!chatId) {
      await answerCallbackQuery(cq.id);
      return;
    }
    await answerCallbackQuery(cq.id);
    await showSiteSections(chatId, site);
    return;
  }

  // "pick" — user chose a section from the /sections menu. Prompt them to reply
  // with their change; the section is encoded in the prompt so the reply routes
  // straight to it (see handleMessage's reply_to_message handling).
  if (action === "pick") {
    const file = site.files.find((f) => f.key === parts[2]);
    if (!file || !chatId) {
      await answerCallbackQuery(cq.id, "Unknown section");
      return;
    }
    await answerCallbackQuery(cq.id);
    await sendMessage(
      chatId,
      `✍️ Editing <b>${escapeHtml(site.name)}</b> → <i>${escapeHtml(file.description)}</i>\n\n` +
        `Reply to this message with your change.\n\n` +
        `<i>Section: ${site.key}/${file.key}</i>`,
      { force_reply: true, input_field_placeholder: "Describe your change…" },
    );
    return;
  }

  // "m" / "d" — merge or discard a PR.
  const prNumber = parseInt(parts[2], 10);
  if (Number.isNaN(prNumber)) {
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

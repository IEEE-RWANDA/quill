// Thin wrappers over the Telegram Bot API. No dependencies — just fetch.

const api = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

// Escape text so it is safe inside HTML parse_mode messages.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

// Telegram's "force reply" — the user's next message becomes a reply to this
// one, so we can recover context from reply_to_message without storing state.
export interface ForceReply {
  force_reply: true;
  input_field_placeholder?: string;
}

// A persistent button grid that sits under the message field. Tapping a button
// sends its text as a normal message, which the handler matches on.
export interface ReplyKeyboard {
  keyboard: { text: string }[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  input_field_placeholder?: string;
}

export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard | ForceReply | ReplyKeyboard,
): Promise<void> {
  await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  await fetch(api("editMessageText"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await fetch(api("answerCallbackQuery"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

// Sends a photo by URL (best-effort — never throws; a broken URL just no-ops).
export async function sendPhoto(
  chatId: number,
  photoUrl: string,
  caption?: string,
): Promise<void> {
  try {
    await fetch(api("sendPhoto"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption }),
    });
  } catch {
    /* ignore — image preview is best-effort */
  }
}

// Downloads a photo/file the user sent, returning its bytes base64-encoded plus
// a file extension inferred from Telegram's stored path (defaults to jpg).
export async function downloadTelegramFile(
  fileId: string,
): Promise<{ base64: string; ext: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const meta = await fetch(api("getFile") + `?file_id=${encodeURIComponent(fileId)}`).then(
    (r) => r.json(),
  );
  const filePath: string | undefined = meta?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile returned no file_path");
  const bytes = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
  ).then((r) => r.arrayBuffer());
  const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
  return { base64: Buffer.from(bytes).toString("base64"), ext };
}

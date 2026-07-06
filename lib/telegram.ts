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

export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboard | ForceReply,
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

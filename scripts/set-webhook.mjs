// Registers your Vercel URL as the Telegram webhook, with the secret token.
// Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WEBHOOK_URL=... npm run set-webhook

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.WEBHOOK_URL; // e.g. https://quill-xxx.vercel.app/api/telegram
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !url || !secret) {
  console.error(
    "Missing env: set TELEGRAM_BOT_TOKEN, WEBHOOK_URL, and TELEGRAM_WEBHOOK_SECRET.",
  );
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  }),
});

console.log(JSON.stringify(await res.json(), null, 2));

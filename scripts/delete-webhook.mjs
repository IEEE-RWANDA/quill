// Removes the Telegram webhook (useful when debugging locally).
// Usage: TELEGRAM_BOT_TOKEN=... npm run delete-webhook

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing env: set TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
  method: "POST",
});
console.log(JSON.stringify(await res.json(), null, 2));

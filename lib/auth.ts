// Only these Telegram user IDs may drive the bot. Everyone else gets refused.
// Find your numeric ID by messaging @userinfobot on Telegram.
// Set ALLOWED_TELEGRAM_USER_IDS as a comma-separated list, e.g. "123456789,987654321".

const ALLOWED_USER_IDS: number[] = (process.env.ALLOWED_TELEGRAM_USER_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));

export function isAllowed(userId: number | undefined): boolean {
  return userId !== undefined && ALLOWED_USER_IDS.includes(userId);
}

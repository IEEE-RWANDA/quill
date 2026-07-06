// Tiered access control.
//
// - Admins (ADMIN_TELEGRAM_USER_IDS) can edit every site. That's you.
// - Each site may also grant a team of editors via its own env var (named by
//   `editorsEnv` in lib/sites.ts), e.g. the IEEE sites let approved members edit.
// - A site with no `editorsEnv` is admin-only (like the personal portfolio).
//
// Find a numeric Telegram ID by having the person message @userinfobot.

import type { Site } from "./sites.js";

function parseIds(value: string | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

const ADMIN_IDS = parseIds(process.env.ADMIN_TELEGRAM_USER_IDS);

export function isAdmin(userId: number | undefined): boolean {
  return userId !== undefined && ADMIN_IDS.includes(userId);
}

// The editor IDs allowed on a specific site (empty if the site has no editor list).
export function editorsForSite(site: Site): number[] {
  return site.editorsEnv ? parseIds(process.env[site.editorsEnv]) : [];
}

// Can this user edit this specific site? Admins can edit anything.
export function canEditSite(userId: number | undefined, site: Site): boolean {
  if (userId === undefined) return false;
  if (isAdmin(userId)) return true;
  return editorsForSite(site).includes(userId);
}

// Is this user known to the bot at all (admin, or an editor of some site)?
// Used to refuse strangers before spending any Claude calls.
export function isKnownUser(userId: number | undefined, sites: Site[]): boolean {
  if (userId === undefined) return false;
  if (isAdmin(userId)) return true;
  return sites.some((s) => editorsForSite(s).includes(userId));
}

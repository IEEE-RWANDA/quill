// The registry of sites the bot can edit. Each site maps to a GitHub repo and
// one or more content files that live as JSON in that repo. Claude uses the
// `description` fields to route a request to the right site + file, so write
// them clearly.
//
// To add a site: move its editable content into a JSON file in its repo, then
// add an entry here with the repo coordinates and that file's path.

export interface ContentFile {
  key: string; // stable id used internally
  path: string; // path to the JSON file within the repo
  description: string; // what this file holds — Claude reads this to route
}

export interface Site {
  key: string; // short slug — used in Telegram button data, keep it under ~15 chars
  name: string; // human-friendly name shown in chat
  owner: string; // GitHub owner (user or org)
  repo: string; // GitHub repo name
  baseBranch: string; // branch to open PRs against, usually "main"
  // Name of the env var holding the GitHub token for this repo's owner.
  // Fine-grained tokens are scoped to one owner, so personal and org repos
  // use different tokens. Defaults to GITHUB_TOKEN if omitted.
  tokenEnv?: string;
  // Name of the env var holding a comma-separated list of Telegram user IDs
  // allowed to edit this site (in addition to admins). Omit to make the site
  // admin-only — e.g. the personal portfolio.
  editorsEnv?: string;
  files: ContentFile[];
}

// Resolves the GitHub token for a site from its configured env var.
export function tokenForSite(site: Site): string {
  const name = site.tokenEnv ?? "GITHUB_TOKEN";
  const token = process.env[name];
  if (!token) throw new Error(`Missing GitHub token env var: ${name}`);
  return token;
}

export const sites: Site[] = [
  {
    key: "portfolio",
    name: "Personal Portfolio (kipngenokoech.com)",
    owner: "kkipngenokoech", // <-- CHANGE to your GitHub username/org if different
    repo: "kip", // <-- CHANGE to the actual repo name on GitHub
    baseBranch: "main",
    tokenEnv: "GITHUB_TOKEN_PERSONAL", // fine-grained token scoped to your personal account
    files: [
      {
        key: "websites",
        path: "content/websites.json",
        description:
          "The 'Websites I've Vibecoded' gallery. A JSON array of objects, each { name, url, description }.",
      },
    ],
  },

  // --- Add the IEEE sites here once their content is in JSON files. Example: ---
  // {
  //   key: "ieee-rw",
  //   name: "IEEE Rwanda Section",
  //   owner: "IEEE-RWANDA",
  //   repo: "ieee-rwanda",
  //   baseBranch: "main",
  //   tokenEnv: "GITHUB_TOKEN_IEEE", // fine-grained token scoped to the IEEE-RWANDA org
  //   editorsEnv: "IEEE_EDITOR_IDS", // approved team members who can edit IEEE sites
  //   files: [
  //     {
  //       key: "events",
  //       path: "content/events.json",
  //       description:
  //         "Upcoming events. A JSON array of { title, date, venue, description, registerUrl }.",
  //     },
  //     {
  //       key: "team",
  //       path: "content/team.json",
  //       description: "Committee members. A JSON array of { name, role, photoUrl }.",
  //     },
  //   ],
  // },
];

export function findSite(key: string): Site | undefined {
  return sites.find((s) => s.key === key);
}

// Compact view of the registry that Claude sees when routing a request.
export function registrySummary() {
  return sites.map((s) => ({
    siteKey: s.key,
    name: s.name,
    files: s.files.map((f) => ({ fileKey: f.key, description: f.description })),
  }));
}

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
  files: ContentFile[];
}

export const sites: Site[] = [
  {
    key: "portfolio",
    name: "Personal Portfolio (kipngenokoech.com)",
    owner: "kkipngenokoech", // <-- CHANGE to your GitHub username/org if different
    repo: "kip", // <-- CHANGE to the actual repo name on GitHub
    baseBranch: "main",
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
  //   owner: "kkipngenokoech",
  //   repo: "ieee-rwanda",
  //   baseBranch: "main",
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

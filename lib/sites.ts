// The registry of sites the bot can edit. Each site maps to a GitHub repo and
// one or more content files that live as JSON in that repo. Claude uses the
// `description` fields to route a request to the right site + file, so write
// them clearly.
//
// To add a site: move its editable content into a JSON file in its repo, then
// add an entry here with the repo coordinates and that file's path.

// A field in a structured list item, used to build the free (no-LLM) "add" form.
export interface ItemField {
  key: string; // property name in the JSON object
  label: string; // prompt shown to the user
  kind?: "url" | "text"; // "url" gets light validation/normalisation
}

export interface ContentFile {
  key: string; // stable id used internally
  path: string; // path to the JSON file within the repo
  description: string; // what this file holds — Claude reads this to route
  // If set, this file is a JSON array of objects with these fields, so Quill can
  // offer a free, deterministic "add an item" form (no Claude call needed).
  itemFields?: ItemField[];
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

// The IEEE chapter sites (comsoc/aess/mtts/grss) share one template: content in
// src/data/{events,team}.json with the same shapes. This builds their registry
// entry so we don't repeat it four times.
const EVENT_FIELDS: ItemField[] = [
  { key: "title", label: "Title" },
  { key: "date", label: "Date (YYYY-MM-DD)" },
  { key: "location", label: "Location" },
  { key: "description", label: "Description" },
];
const TEAM_FIELDS: ItemField[] = [
  { key: "name", label: "Name" },
  { key: "role", label: "Role" },
  { key: "affiliation", label: "Affiliation" },
];

function chapterSite(key: string, name: string, repo: string): Site {
  return {
    key,
    name,
    owner: "IEEE-RWANDA",
    repo,
    baseBranch: "main",
    tokenEnv: "GITHUB_TOKEN_IEEE",
    editorsEnv: "IEEE_EDITOR_IDS",
    files: [
      {
        key: "events",
        path: "src/data/events.json",
        description:
          "Events. A JSON array of { title, date (ISO, e.g. 2026-08-15), location, description, registrationUrl?, past? }.",
        itemFields: EVENT_FIELDS,
      },
      {
        key: "team",
        path: "src/data/team.json",
        description:
          "Team / committee members. A JSON array of { name, role, affiliation, photo?, linkedin? }.",
        itemFields: TEAM_FIELDS,
      },
    ],
  };
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
        itemFields: [
          { key: "name", label: "Name" },
          { key: "url", label: "URL", kind: "url" },
          { key: "description", label: "Description" },
        ],
      },
      {
        key: "experience",
        path: "content/experience.json",
        description:
          "Work experience entries. A JSON array of { company, title, date, description, tags[], highlight, color }.",
      },
      {
        key: "featured",
        path: "content/featured-projects.json",
        description:
          "Featured projects shown prominently on the homepage. A JSON array of { title, description, tech[], image, github?, external?, docs?, channels?, items? }.",
      },
      {
        key: "projects",
        path: "content/other-projects.json",
        description:
          "The 'other projects' grid. A JSON array of { title, description, tech[], github?, external?, href?, pinned? }.",
      },
      {
        key: "publications",
        path: "content/publications.json",
        description:
          "Papers / publications. A JSON array of { title, authors, venue, year, status, abstract, links[], tags[] }.",
      },
      {
        key: "education",
        path: "content/education.json",
        description:
          "Education entries. A JSON array of { degree, school, location, period, description, courses[] }.",
      },
    ],
  },

  {
    key: "ieee-rw",
    name: "IEEE Rwanda Section",
    owner: "IEEE-RWANDA",
    repo: "ieeerwanda",
    baseBranch: "main",
    tokenEnv: "GITHUB_TOKEN_IEEE", // fine-grained token scoped to the IEEE-RWANDA org
    editorsEnv: "IEEE_EDITOR_IDS", // approved team members who can edit IEEE sites
    files: [
      {
        key: "events",
        path: "content/events.json",
        description: "Events. A JSON array of { title, kind, blurb }.",
        itemFields: [
          { key: "title", label: "Title" },
          { key: "kind", label: "Kind (e.g. Workshop, Hackathon, Forum)" },
          { key: "blurb", label: "Short description" },
        ],
      },
      {
        key: "executive",
        path: "content/executive.json",
        description:
          "Executive committee members. A JSON array of { name, role, photo? }.",
      },
      {
        key: "operations",
        path: "content/operations.json",
        description:
          "Operations & media team members. A JSON array of { name, role, photo? }.",
      },
      {
        key: "chapters",
        path: "content/chapters.json",
        description:
          "Technical society chapters. A JSON array of { name, blurb, url? }.",
      },
      {
        key: "affinity",
        path: "content/affinity-groups.json",
        description:
          "Affinity groups (WIE, YP, SIGHT). A JSON array of { name, blurb, url? }.",
      },
      {
        key: "testimonials",
        path: "content/testimonials.json",
        description: "Member testimonials. A JSON array of { quote, name, role }.",
      },
    ],
  },

  chapterSite("comsoc", "IEEE ComSoc Rwanda", "comsoc"),
  chapterSite("aess", "IEEE AESS Rwanda", "aess"),
  chapterSite("mtts", "IEEE MTT-S Rwanda", "mtts"),
  chapterSite("grss", "IEEE GRSS Rwanda", "grss"),

  // iesrwanda still to add — its content lives in a different layout, and its
  // repo owner needs confirming (personal vs IEEE-RWANDA org).
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

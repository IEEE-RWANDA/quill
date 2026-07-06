# 🪶 Quill

A Telegram bot that edits your websites' content by chat. You type what you want
changed in plain English; Quill uses Claude to turn it into a content edit,
opens a **pull request**, and sends you **Merge / Discard** buttons plus a
preview of the changed section. Merge from your phone → Vercel redeploys the
site. No dashboard, no code editor.

It works across **all your sites** from one bot — each site is one entry in a
registry ([`lib/sites.ts`](lib/sites.ts)) pointing at a GitHub repo and the JSON
files that hold its content.

## How it works

```
You (Telegram)
   │  "Add a vibecoded site: FooBar, https://foo.bar, a demo of X"
   ▼
Quill webhook (Vercel function)
   ├─ auth check (only your Telegram ID)
   ├─ Claude (Haiku 4.5): which site + file?         ← ~1.5¢ per edit
   ├─ fetch that JSON file from GitHub
   ├─ Claude (Haiku 4.5): rewrite the file
   ├─ open a PR on a new branch
   └─ reply: preview of the change + [✅ Merge] [❌ Discard]
        │
        ▼  you tap Merge
   GitHub merges the PR → Vercel redeploys the site
```

Cost is a few cents a month at typical volume — Claude is billed per use and a
content edit is tiny (~5k tokens in, ~2k out). Telegram, GitHub, and Vercel are
free at this scale.

## What content it can edit

Any content you move out of code and into a JSON file. This repo ships with one
wired site — the personal portfolio's "Websites I've Vibecoded" gallery
(`content/websites.json`). Add more files/sites in `lib/sites.ts`.

## Setup

### 1. Create the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts.
2. Copy the **bot token**.
3. Message [@userinfobot](https://t.me/userinfobot) to get your numeric **user ID**.

### 2. Create GitHub token(s)

Fine-grained tokens are scoped to a single **resource owner**, so you make one
per owner your sites live under. Each token needs, under **Repository
permissions**: **Contents: Read and write** + **Pull requests: Read and write**
(and nothing else).

- Personal repos (the portfolio) → token with Resource owner = your account →
  put in `GITHUB_TOKEN_PERSONAL`.
- IEEE-RWANDA repos → token with Resource owner = `IEEE-RWANDA` →
  put in `GITHUB_TOKEN_IEEE`.

Each site in [`lib/sites.ts`](lib/sites.ts) names which token it uses via
`tokenEnv`. If all your repos are under one owner, use a single token and set
`tokenEnv` to it everywhere.

### 3. Configure the site registry

Edit [`lib/sites.ts`](lib/sites.ts). For the bundled portfolio entry, set `owner`
and `repo` to your actual GitHub repo. Add entries for your other sites once
their content lives in JSON files.

### 4. Deploy to Vercel

```bash
npm install
npx vercel            # link/create the project
npx vercel --prod     # deploy — note the URL it prints
```

In the Vercel dashboard (Project → Settings → Environment Variables), set every
var from [`.env.example`](.env.example): `ANTHROPIC_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (invent a long random string),
`ALLOWED_TELEGRAM_USER_IDS`, and your GitHub token(s)
(`GITHUB_TOKEN_PERSONAL`, `GITHUB_TOKEN_IEEE`). Redeploy so they take effect.

### 5. Register the webhook

Point Telegram at your deployed function (`https://<your-app>.vercel.app/api/telegram`):

```bash
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_WEBHOOK_SECRET=your-secret \
WEBHOOK_URL=https://your-app.vercel.app/api/telegram \
npm run set-webhook
```

You should see `{"ok": true, ...}`. Now message your bot: `/help`.

## Using it

Just say what you want:

- *Add a vibecoded site: DataViz Studio, https://dataviz.example, a browser-based chart builder*
- *Change the IEEE Rwanda Section description to "Home of the IEEE Rwanda Section — news, events, and chapters."*
- *Remove the duplicate IEEE IES Rwanda entry that points to iesrwanda.org*

Quill replies with a PR link, a preview of the exact change, and two buttons.
Tap **Merge** to publish, **Discard** to throw it away.

## Adding another site

1. In that site's repo, move the editable content into a JSON file
   (e.g. `content/events.json`).
2. Add a `Site` entry in `lib/sites.ts` with the repo coordinates and a clear
   `description` for each file (Claude uses it to route your requests).
3. Redeploy. That's it — same bot, no new infrastructure.

## Notes & limits

- **One editor.** Only Telegram IDs in `ALLOWED_TELEGRAM_USER_IDS` can use it.
- **Model.** Uses `claude-haiku-4-5` (cheap). Change `MODEL` in
  [`lib/claude.ts`](lib/claude.ts) to `claude-sonnet-5` for tougher edits.
- **Review before merge.** Nothing goes live until you tap Merge — Quill also
  validates JSON before opening the PR, so a bad edit can't produce broken content.
- **Latency.** An edit takes a few seconds (two Claude calls + GitHub). The
  webhook stays well under Telegram's timeout.

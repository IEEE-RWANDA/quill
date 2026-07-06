import Anthropic from "@anthropic-ai/sdk";

// Turns a thrown error into a clear, user-facing chat message. Keeps internal
// detail out of the user's face while telling them (or an admin) what to fix.
export function friendlyError(err: unknown): string {
  // --- Claude (Anthropic) API errors ---
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const msg = (err.message || "").toLowerCase();

    if (
      status === 400 &&
      (msg.includes("credit balance") || msg.includes("billing"))
    ) {
      return "💳 Quill's AI credit has run out, so I can't process edits right now. An admin needs to top up the Anthropic account (console.anthropic.com → Add funds). Your request wasn't lost — just resend it once that's done.";
    }
    if (status === 401) {
      return "🔑 The AI service rejected its API key. An admin needs to check <code>ANTHROPIC_API_KEY</code> in Vercel.";
    }
    if (status === 429) {
      return "⏳ The AI service is busy at the moment. Give it a few seconds and send your request again.";
    }
    if (status && status >= 500) {
      return "🛠️ The AI service is having a hiccup on its end. Please try again shortly.";
    }
    return "🤖 The AI service couldn't process that request. Try rephrasing it.";
  }

  const text = err instanceof Error ? err.message : String(err);

  // --- GitHub errors (github.ts throws "GitHub <METHOD> <path> -> <status>: …") ---
  const gh = text.match(/GitHub .*-> (\d{3})/);
  if (gh) {
    const status = parseInt(gh[1], 10);
    if (status === 401 || status === 403) {
      return "🔒 GitHub refused the change — the token is missing write access to this repo. An admin needs to check the GitHub token's permissions.";
    }
    if (status === 404) {
      return "🔍 I couldn't find that repo or file on GitHub. The site may be misconfigured — an admin should check its entry in the registry.";
    }
    if (status === 422) {
      return "⚠️ GitHub rejected the change — the content may be invalid, or a matching branch already exists. Try again.";
    }
    return "🐙 GitHub had a problem applying the change. An admin can check the Vercel logs.";
  }

  // --- Missing token configuration (tokenForSite) ---
  if (text.includes("Missing GitHub token env var")) {
    return "⚙️ This site's GitHub token isn't set up yet. An admin needs to add it in Vercel before edits here will work.";
  }

  return "⚠️ Something went wrong handling that. An admin can check the Vercel logs for details.";
}

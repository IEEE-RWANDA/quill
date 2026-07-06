// GitHub REST helpers over fetch. Needs a token in GITHUB_TOKEN with
// "Contents" + "Pull requests" read/write on the target repos.

const GH = "https://api.github.com";

async function gh(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "quill-cms-bot",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

const encodePath = (p: string) =>
  p.split("/").map(encodeURIComponent).join("/");

export async function getFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string }> {
  const data = await gh(
    "GET",
    `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

export interface OpenPrOptions {
  owner: string;
  repo: string;
  baseBranch: string;
  path: string;
  newContent: string;
  branchName: string;
  title: string;
  body: string;
}

// Creates a branch off base, commits the new file content to it, and opens a PR.
// Returns the PR number.
export async function openPullRequest(opts: OpenPrOptions): Promise<number> {
  const { owner, repo, baseBranch, path, newContent, branchName, title, body } =
    opts;

  const baseRef = await gh(
    "GET",
    `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`,
  );
  const baseSha: string = baseRef.object.sha;

  await gh("POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  // The current file's blob sha is required to update an existing file.
  let fileSha: string | undefined;
  try {
    const existing = await gh(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(baseBranch)}`,
    );
    fileSha = existing.sha;
  } catch {
    // File does not exist yet — that's fine, we'll create it.
  }

  await gh("PUT", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    message: title,
    content: Buffer.from(newContent, "utf-8").toString("base64"),
    branch: branchName,
    sha: fileSha,
  });

  const pr = await gh("POST", `/repos/${owner}/${repo}/pulls`, {
    title,
    head: branchName,
    base: baseBranch,
    body,
  });
  return pr.number;
}

export async function mergePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const pr = await gh("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
  await gh("PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    merge_method: "squash",
  });
  // Best-effort branch cleanup.
  await gh(
    "DELETE",
    `/repos/${owner}/${repo}/git/refs/heads/${pr.head.ref}`,
  ).catch(() => {});
}

export async function closePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const pr = await gh("GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
  await gh("PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, {
    state: "closed",
  });
  await gh(
    "DELETE",
    `/repos/${owner}/${repo}/git/refs/heads/${pr.head.ref}`,
  ).catch(() => {});
}

export function prUrl(owner: string, repo: string, prNumber: number): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

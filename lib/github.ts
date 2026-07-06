// GitHub REST helpers over fetch. Each call takes the token to use, since
// fine-grained tokens are scoped to one owner (personal vs org). The token
// needs "Contents" + "Pull requests" read/write on the target repo.

const GH = "https://api.github.com";

async function gh(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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

// --- Granular building blocks ---------------------------------------------

export async function getBranchSha(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const ref = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  return ref.object.sha;
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  fromSha: string,
): Promise<void> {
  await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: fromSha,
  });
}

// Reads a text file's content + blob sha at a ref.
export async function getFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string }> {
  const data = await gh(
    token,
    "GET",
    `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  return {
    content: Buffer.from(data.content, "base64").toString("utf-8"),
    sha: data.sha,
  };
}

// Returns the blob sha of a file at a ref, or undefined if it doesn't exist.
export async function getFileSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | undefined> {
  try {
    const data = await gh(
      token,
      "GET",
      `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    );
    return data.sha;
  } catch {
    return undefined;
  }
}

// Commits a file (text or binary) to a branch. `base64Content` is the file's
// bytes base64-encoded; pass the existing blob `sha` when updating a file.
export async function commitFile(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  base64Content: string,
  message: string,
  sha?: string,
): Promise<void> {
  await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    message,
    content: base64Content,
    branch,
    sha,
  });
}

export async function createPr(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string,
  title: string,
  body: string,
): Promise<number> {
  const pr = await gh(token, "POST", `/repos/${owner}/${repo}/pulls`, {
    title,
    head,
    base,
    body,
  });
  return pr.number;
}

// --- Composed convenience: single text-file edit --------------------------

export interface OpenPrOptions {
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
  path: string;
  newContent: string;
  branchName: string;
  title: string;
  body: string;
}

export async function openPullRequest(opts: OpenPrOptions): Promise<number> {
  const { token, owner, repo, baseBranch, path, newContent, branchName, title, body } = opts;
  const baseSha = await getBranchSha(token, owner, repo, baseBranch);
  await createBranch(token, owner, repo, branchName, baseSha);
  const fileSha = await getFileSha(token, owner, repo, path, baseBranch);
  await commitFile(
    token,
    owner,
    repo,
    branchName,
    path,
    Buffer.from(newContent, "utf-8").toString("base64"),
    title,
    fileSha,
  );
  return createPr(token, owner, repo, baseBranch, branchName, title, body);
}

// --- Merge / close --------------------------------------------------------

export async function mergePullRequest(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const pr = await gh(token, "GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
  await gh(token, "PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    merge_method: "squash",
  });
  await gh(
    token,
    "DELETE",
    `/repos/${owner}/${repo}/git/refs/heads/${pr.head.ref}`,
  ).catch(() => {});
}

export async function closePullRequest(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  const pr = await gh(token, "GET", `/repos/${owner}/${repo}/pulls/${prNumber}`);
  await gh(token, "PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, {
    state: "closed",
  });
  await gh(
    token,
    "DELETE",
    `/repos/${owner}/${repo}/git/refs/heads/${pr.head.ref}`,
  ).catch(() => {});
}

export function prUrl(owner: string, repo: string, prNumber: number): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

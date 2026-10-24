/**
 * Minimal GitHub REST client for the deploy console.
 *
 * Calls go straight from the tab to api.github.com (the API allows CORS), so
 * the token never touches the Forge server. Storage is the caller's concern.
 */

const API_ROOT = 'https://api.github.com';

export class GithubRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubRequestError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}

async function request<T>(token: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof (payload as { message: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : `${response.status} ${response.statusText}`;
    throw new GithubRequestError(message, response.status);
  }

  return payload as T;
}

function encodeBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

export interface GithubTarget {
  owner: string;
  repo: string;
  branch: string;
}

export interface GithubViewer {
  login: string;
}

export async function getViewer(token: string): Promise<GithubViewer> {
  const payload = await request<{ login: string }>(token, '/user');
  return { login: payload.login };
}

export interface CreateRepositoryInput {
  token: string;
  name: string;
  description: string;
  private: boolean;
}

export interface CreatedRepository {
  owner: string;
  name: string;
  htmlUrl: string;
  defaultBranch: string;
}

export async function createRepository(input: CreateRepositoryInput): Promise<CreatedRepository> {
  const payload = await request<{
    name: string;
    html_url: string;
    default_branch: string;
    owner: { login: string };
  }>(input.token, '/user/repos', {
    method: 'POST',
    body: {
      name: input.name,
      description: input.description.trim() || undefined,
      private: input.private,
      auto_init: false,
    },
  });

  return {
    owner: payload.owner.login,
    name: payload.name,
    htmlUrl: payload.html_url,
    defaultBranch: payload.default_branch,
  };
}

export interface PushProjectInput extends GithubTarget {
  token: string;
  message: string;
  files: Record<string, string>;
}

export interface PushProjectResult {
  sha: string;
  fileCount: number;
}

/**
 * Mirrors the workspace into a GitHub commit using the Git Data API:
 * blobs → tree → commit → ref. The tree replaces the whole snapshot, so files
 * deleted in Forge are deleted in the repository too.
 */
export async function pushProject(input: PushProjectInput): Promise<PushProjectResult> {
  const { token, owner, repo, branch, message } = input;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const entries = Object.entries(input.files)
    .map(([path, content]) => [path.replace(/^\/+/, ''), content] as const)
    .filter(([path]) => path.length > 0 && !path.startsWith('node_modules/'));

  if (entries.length === 0) {
    throw new Error('The workspace has no files to push.');
  }

  let parentSha: string | null = null;
  try {
    const ref = await request<{ object: { sha: string } }>(
      token,
      `${repoPath}/git/ref/heads/${branch}`
    );
    parentSha = ref.object.sha;
  } catch (error) {
    // An empty repository has no branch yet; the first push creates it.
    if (!(error instanceof GithubRequestError) || error.status !== 404) throw error;
  }

  const treeEntries = await Promise.all(
    entries.map(async ([path, content]) => {
      const blob = await request<{ sha: string }>(token, `${repoPath}/git/blobs`, {
        method: 'POST',
        body: { content: encodeBase64(content), encoding: 'base64' },
      });
      return { path, mode: '100644', type: 'blob', sha: blob.sha };
    })
  );

  const tree = await request<{ sha: string }>(token, `${repoPath}/git/trees`, {
    method: 'POST',
    body: { tree: treeEntries },
  });

  const commit = await request<{ sha: string }>(token, `${repoPath}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
    },
  });

  if (parentSha) {
    await request(token, `${repoPath}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: true },
    });
  } else {
    await request(token, `${repoPath}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  }

  return { sha: commit.sha, fileCount: entries.length };
}

export interface PullProjectInput extends GithubTarget {
  token: string;
}

export interface PullProjectResult {
  files: Record<string, string>;
  fileCount: number;
  skipped: number;
  truncated: boolean;
}

/** Reads every text blob on the branch and returns a path → content map. */
export async function pullProject(input: PullProjectInput): Promise<PullProjectResult> {
  const { token, owner, repo, branch } = input;
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const ref = await request<{ object: { sha: string } }>(
    token,
    `${repoPath}/git/ref/heads/${branch}`
  );

  const tree = await request<{
    truncated: boolean;
    tree: Array<{ path: string; type: string; sha: string }>;
  }>(token, `${repoPath}/git/trees/${ref.object.sha}?recursive=1`);

  const files: Record<string, string> = {};
  let skipped = 0;

  await Promise.all(
    tree.tree
      .filter((node) => node.type === 'blob')
      .map(async (node) => {
        const blob = await request<{ content: string; encoding: string }>(
          token,
          `${repoPath}/git/blobs/${node.sha}`
        );
        if (blob.encoding !== 'base64') {
          skipped += 1;
          return;
        }
        const text = decodeBase64(blob.content);
        // The virtual file system is text-only; skip binary assets.
        if (text.includes('\u0000')) {
          skipped += 1;
          return;
        }
        files[`/${node.path}`] = text;
      })
  );

  return {
    files,
    fileCount: Object.keys(files).length,
    skipped,
    truncated: tree.truncated,
  };
}

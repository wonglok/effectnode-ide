import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createRepository,
  getViewer,
  GithubRequestError,
  pullProject,
  pushProject,
} from '@/lib/github';
import { runtime } from '@/lib/runtime';
import { restartWithFiles } from '@/store/runtime';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';

export type DeployTarget = 'vercel' | 'cloudflare' | 'netlify' | 'github';
export type GithubAction = 'create' | 'pull' | 'push' | 'sync';
export type DeployLogTone = 'info' | 'success' | 'error';

export interface DeployLogEntry {
  id: number;
  at: number;
  tone: DeployLogTone;
  text: string;
}

export interface DeploySettings {
  vercelProject: string;
  cloudflareAccount: string;
  cloudflareProject: string;
  netlifySite: string;
  githubOwner: string;
  githubRepo: string;
  githubDescription: string;
  githubBranch: string;
  githubMessage: string;
  githubPrivate: boolean;
}

const GITHUB_TOKEN_KEY = 'forge.deploy.github-token';

const DEFAULT_SETTINGS: DeploySettings = {
  vercelProject: 'my-company',
  cloudflareAccount: '',
  cloudflareProject: 'my-company',
  netlifySite: '',
  githubOwner: '',
  githubRepo: 'my-company',
  githubDescription: 'Built with Forge',
  githubBranch: 'main',
  githubMessage: 'Update from Forge',
  githubPrivate: true,
};

const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._/-]+$/;

let logSequence = 0;

function readStoredToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(GITHUB_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function assertRepoName(name: string): void {
  if (!name) throw new Error('Enter a repository name.');
  if (!REPO_PATTERN.test(name)) {
    throw new Error('Repository names may only use letters, numbers, dots, hyphens and underscores.');
  }
}

function assertTarget(settings: DeploySettings): {
  owner: string;
  repo: string;
  branch: string;
} {
  const owner = settings.githubOwner.trim();
  const repo = settings.githubRepo.trim();
  const branch = settings.githubBranch.trim() || 'main';

  if (!owner) throw new Error('Enter the GitHub owner (user or organisation).');
  if (!OWNER_PATTERN.test(owner)) {
    throw new Error('GitHub owners may only use letters, numbers and hyphens.');
  }
  assertRepoName(repo);
  if (!BRANCH_PATTERN.test(branch)) {
    throw new Error('Enter a valid branch name (letters, numbers, ".", "_", "-" or "/").');
  }

  return { owner, repo, branch };
}

function describeError(error: unknown): string {
  if (error instanceof GithubRequestError) {
    if (error.status === 401) {
      return 'GitHub rejected the token (401). Check that it is valid and has the repo scope.';
    }
    if (error.status === 403) {
      return `GitHub refused the request (403): ${error.message}`;
    }
    if (error.status === 404) {
      return 'Repository or branch not found. Check the owner, name and branch.';
    }
    if (error.status === 422) {
      return `GitHub could not apply the change (422): ${error.message}`;
    }
    return `GitHub error ${error.status}: ${error.message}`;
  }
  if (error instanceof TypeError) {
    return 'Could not reach api.github.com from this tab.';
  }
  return error instanceof Error ? error.message : String(error);
}

async function applyPulledFiles(files: Record<string, string>): Promise<void> {
  if (Object.keys(files).length === 0) {
    throw new Error('The branch does not contain any text files to pull.');
  }
  useWorkspaceStore.getState().flush();
  await restartWithFiles(files);
  useWorkspaceStore.getState().loadFiles(files);
}

interface DeployState {
  deployOpen: boolean;
  target: DeployTarget;
  githubAction: GithubAction;
  token: string;
  settings: DeploySettings;
  busy: boolean;
  log: DeployLogEntry[];
  lastRepoUrl: string | null;

  setDeployOpen: (open: boolean) => void;
  setTarget: (target: DeployTarget) => void;
  setGithubAction: (action: GithubAction) => void;
  setField: <K extends keyof DeploySettings>(field: K, value: DeploySettings[K]) => void;
  setToken: (token: string) => void;
  appendLog: (tone: DeployLogTone, text: string) => void;
  clearLog: () => void;
  saveTarget: () => void;
  verifyGithub: () => Promise<void>;
  runGithubAction: () => Promise<void>;
}

export const useDeployStore = create<DeployState>()(
  persist(
    (set, get) => ({
      deployOpen: false,
      target: 'vercel',
      githubAction: 'create',
      token: readStoredToken(),
      settings: DEFAULT_SETTINGS,
      busy: false,
      log: [],
      lastRepoUrl: null,

      setDeployOpen: (open) => set({ deployOpen: open }),

      setTarget: (target) => set({ target }),
      setGithubAction: (action) => set({ githubAction: action }),

      setField: (field, value) =>
        set((state) => ({ settings: { ...state.settings, [field]: value } })),

      setToken: (token) => {
        set({ token });
        try {
          if (token) {
            window.sessionStorage.setItem(GITHUB_TOKEN_KEY, token);
          } else {
            window.sessionStorage.removeItem(GITHUB_TOKEN_KEY);
          }
        } catch {
          // Private-mode browsers can refuse sessionStorage; the in-memory
          // token still works for this component tree.
        }
      },

      appendLog: (tone, text) =>
        set((state) => ({
          log: [
            ...state.log.slice(-79),
            { id: ++logSequence, at: Date.now(), tone, text },
          ],
        })),

      clearLog: () => set({ log: [] }),

      saveTarget: () => {
        const target = get().target;
        if (target === 'github') return;
        const labels: Record<Exclude<DeployTarget, 'github'>, string> = {
          vercel: 'Vercel',
          cloudflare: 'Cloudflare Pages',
          netlify: 'Netlify',
        };
        get().appendLog('success', `${labels[target]} target configuration saved.`);
        useUiStore.getState().toast(`${labels[target]} target saved`);
      },

      verifyGithub: async () => {
        const state = get();
        const token = state.token.trim();
        if (!token) {
          state.appendLog('error', 'Add a GitHub token before verifying.');
          return;
        }
        if (state.busy) return;

        set({ busy: true });
        try {
          const viewer = await getViewer(token);
          get().setField('githubOwner', viewer.login);
          get().appendLog('success', `Authenticated as ${viewer.login}.`);
          useUiStore.getState().toast(`GitHub: ${viewer.login}`);
        } catch (error) {
          const message = describeError(error);
          get().appendLog('error', message);
          useUiStore.getState().toast('GitHub check failed', 'error');
        } finally {
          set({ busy: false });
        }
      },

      runGithubAction: async () => {
        const state = get();
        if (state.busy) return;

        const token = state.token.trim();
        if (!token) {
          state.appendLog('error', 'Add a GitHub token before running an action.');
          useUiStore.getState().toast('GitHub token required', 'error');
          return;
        }

        const action = state.githubAction;
        set({ busy: true });

        try {
          if (action === 'create') {
            const repoName = state.settings.githubRepo.trim();
            assertRepoName(repoName);

            state.appendLog('info', `Creating repository ${repoName}…`);
            const created = await createRepository({
              token,
              name: repoName,
              description: state.settings.githubDescription,
              private: state.settings.githubPrivate,
            });

            set((current) => ({
              settings: {
                ...current.settings,
                githubOwner: created.owner,
                githubRepo: created.name,
                githubBranch: current.settings.githubBranch || created.defaultBranch,
              },
              lastRepoUrl: created.htmlUrl,
            }));
            state.appendLog('success', `Created ${created.owner}/${created.name}.`);
            runtime.log('success', `GitHub repository created: ${created.owner}/${created.name}`);
            useUiStore.getState().toast('GitHub repository created');
            return;
          }

          const { owner, repo, branch } = assertTarget(state.settings);

          if (action === 'pull' || action === 'sync') {
            state.appendLog('info', `Pulling ${owner}/${repo} · ${branch}…`);
            const pulled = await pullProject({ token, owner, repo, branch });
            await applyPulledFiles(pulled.files);

            const skipped = pulled.skipped > 0 ? ` · skipped ${pulled.skipped} binary` : '';
            state.appendLog(
              'success',
              `Pulled ${pulled.fileCount} files${skipped} into the workspace.`
            );
            runtime.log('success', `Pulled ${pulled.fileCount} files from ${owner}/${repo}`);

            if (pulled.truncated) {
              state.appendLog(
                'error',
                'GitHub truncated the file tree because the repository is large; the pull is incomplete.'
              );
            }

            if (action === 'pull') {
              useUiStore.getState().toast('Pulled from GitHub');
              return;
            }

            state.appendLog('info', `Pushing ${owner}/${repo} · ${branch}…`);
            const pushed = await pushProject({
              token,
              owner,
              repo,
              branch,
              message: state.settings.githubMessage.trim() || 'Sync from Forge',
              files: pulled.files,
            });
            set({ lastRepoUrl: `https://github.com/${owner}/${repo}` });
            state.appendLog(
              'success',
              `Pushed ${pushed.fileCount} files · ${pushed.sha.slice(0, 7)}. Sync complete.`
            );
            runtime.log('success', `Synced ${owner}/${repo} · ${pushed.sha.slice(0, 7)}`);
            useUiStore.getState().toast('Repository synced');
            return;
          }

          state.appendLog('info', `Pushing the workspace to ${owner}/${repo} · ${branch}…`);
          useWorkspaceStore.getState().flush();
          const files = runtime.snapshot();
          const pushed = await pushProject({
            token,
            owner,
            repo,
            branch,
            message: state.settings.githubMessage.trim() || 'Update from Forge',
            files,
          });

          set({ lastRepoUrl: `https://github.com/${owner}/${repo}` });
          state.appendLog('success', `Pushed ${pushed.fileCount} files · ${pushed.sha.slice(0, 7)}.`);
          runtime.log('success', `Pushed ${pushed.fileCount} files to ${owner}/${repo}`);
          useUiStore.getState().toast('Pushed to GitHub');
        } catch (error) {
          const message = describeError(error);
          state.appendLog('error', message);
          runtime.log('error', `GitHub action failed: ${message}`);
          useUiStore.getState().toast('GitHub action failed', 'error');
        } finally {
          set({ busy: false });
        }
      },
    }),
    {
      name: 'forge.deploy',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);

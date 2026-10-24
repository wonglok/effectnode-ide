import { useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Hexagon,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Triangle,
} from 'lucide-react';
import { formatClockTime } from '@/lib/format';
import {
  useDeployStore,
  type DeployTarget,
  type GithubAction,
} from '@/store/deploy';
import { Modal } from './Dialogs';

type HostingTarget = Exclude<DeployTarget, 'github'>;

const HOSTING_TARGETS: Array<{
  id: HostingTarget;
  label: string;
  hint: string;
  icon: ReactNode;
}> = [
  { id: 'vercel', label: 'Vercel deploy', hint: 'Edge + serverless', icon: <Triangle size={15} /> },
  { id: 'cloudflare', label: 'Cloudflare deploy', hint: 'Pages', icon: <Cloud size={15} /> },
  { id: 'netlify', label: 'Netlify deploy', hint: 'Sites + functions', icon: <Hexagon size={15} /> },
];

const GITHUB_ACTIONS: Array<{
  id: GithubAction;
  label: string;
  icon: ReactNode;
}> = [
  { id: 'create', label: 'Create repo', icon: <Plus size={11} /> },
  { id: 'pull', label: 'Pull', icon: <ArrowDownToLine size={11} /> },
  { id: 'push', label: 'Push', icon: <ArrowUpFromLine size={11} /> },
  { id: 'sync', label: 'Sync · pull → push', icon: <RefreshCw size={11} /> },
];

const HOSTING_META: Record<
  HostingTarget,
  { kicker: string; title: string; copy: string; icon: ReactNode }
> = {
  vercel: {
    kicker: 'Hosting / Vercel',
    title: 'Vercel deploy',
    copy: 'Publish a workspace snapshot to a Vercel project.',
    icon: <Triangle size={16} />,
  },
  cloudflare: {
    kicker: 'Hosting / Cloudflare',
    title: 'Cloudflare Pages',
    copy: 'Publish to a Cloudflare Pages project with a direct-upload target.',
    icon: <Cloud size={16} />,
  },
  netlify: {
    kicker: 'Hosting / Netlify',
    title: 'Netlify deploy',
    copy: 'Publish a site or draft deploy to a Netlify site.',
    icon: <Hexagon size={16} />,
  },
};

const GITHUB_META: Record<
  GithubAction,
  { title: string; copy: string }
> = {
  create: {
    title: 'Create repository',
    copy: 'Create a repository under the account that owns the token.',
  },
  pull: {
    title: 'Pull from GitHub',
    copy: 'Replace the workspace with the text files on a branch.',
  },
  push: {
    title: 'Push to GitHub',
    copy: 'Commit the workspace as a new commit on a branch.',
  },
  sync: {
    title: 'Sync repository',
    copy: 'Pull the branch into the workspace, then push the pulled snapshot back.',
  },
};

function PanelHeader({
  icon,
  kicker,
  title,
  copy,
  status,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  copy: string;
  status: ReactNode;
}) {
  return (
    <header className="deploy-panel-header">
      <div className="deploy-panel-mark">{icon}</div>
      <div className="deploy-panel-heading">
        <div className="deploy-panel-kicker">{kicker}</div>
        <h3 className="deploy-panel-title">{title}</h3>
        <p className="deploy-panel-copy">{copy}</p>
      </div>
      {status}
    </header>
  );
}

function DeployNav() {
  const target = useDeployStore((state) => state.target);
  const githubAction = useDeployStore((state) => state.githubAction);
  const setTarget = useDeployStore((state) => state.setTarget);
  const setGithubAction = useDeployStore((state) => state.setGithubAction);

  return (
    <aside className="deploy-nav" aria-label="Deploy targets">
      <div className="deploy-nav-label">Hosting</div>
      {HOSTING_TARGETS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`deploy-nav-button ${target === item.id ? 'is-active' : ''}`}
          onClick={() => setTarget(item.id)}
          aria-current={target === item.id ? 'page' : undefined}
        >
          <span className="deploy-nav-icon">{item.icon}</span>
          <span className="deploy-nav-text">
            <span>{item.label}</span>
            <span className="deploy-nav-hint">{item.hint}</span>
          </span>
        </button>
      ))}

      <div className="deploy-nav-label">Source control</div>
      <button
        type="button"
        className={`deploy-nav-button ${target === 'github' ? 'is-active' : ''}`}
        onClick={() => setTarget('github')}
        aria-current={target === 'github' ? 'page' : undefined}
      >
        <span className="deploy-nav-icon"><GitBranch size={15} /></span>
        <span className="deploy-nav-text">
          <span>GitHub</span>
          <span className="deploy-nav-hint">Repositories</span>
        </span>
      </button>

      {target === 'github' ? (
        <div className="deploy-subnav" aria-label="GitHub actions">
          {GITHUB_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`deploy-subnav-button ${githubAction === action.id ? 'is-active' : ''}`}
              onClick={() => {
                setTarget('github');
                setGithubAction(action.id);
              }}
            >
              <span className="deploy-subnav-icon">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="deploy-nav-note">
        Tokens stay in this tab. They are never written to the project, an
        archive, or the Nitro server.
      </div>
    </aside>
  );
}

function ActivityLog() {
  const log = useDeployStore((state) => state.log);
  const clearLog = useDeployStore((state) => state.clearLog);

  return (
    <div className="deploy-card deploy-log-card">
      <div className="deploy-card-head">
        <span className="deploy-card-title">Activity</span>
        {log.length > 0 ? (
          <button type="button" className="deploy-link-button" onClick={clearLog}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="deploy-log" role="log" aria-live="polite">
        {log.length === 0 ? (
          <div className="deploy-log-empty">No deploy activity yet.</div>
        ) : (
          [...log].reverse().map((entry) => (
            <div key={entry.id} className={`deploy-log-entry is-${entry.tone}`}>
              <span className="deploy-log-time">{formatClockTime(entry.at)}</span>
              <span className="deploy-log-text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TokenCard() {
  const token = useDeployStore((state) => state.token);
  const busy = useDeployStore((state) => state.busy);
  const setToken = useDeployStore((state) => state.setToken);
  const verifyGithub = useDeployStore((state) => state.verifyGithub);
  const [visible, setVisible] = useState(false);

  return (
    <div className="deploy-card">
      <div className="deploy-card-head">
        <span className="deploy-card-title">Credentials</span>
        <span className={`deploy-status ${token.trim() ? 'is-ready' : 'is-pending'}`}>
          {token.trim() ? 'Token loaded' : 'Not connected'}
        </span>
      </div>
      <label className="field">
        <span className="field-label">Personal access token</span>
        <div className="deploy-token-row">
          <input
            className="field-input"
            type={visible ? 'text' : 'password'}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ghp_… or github_pat_…"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="deploy-icon-button"
            onClick={() => setVisible((value) => !value)}
            title={visible ? 'Hide token' : 'Show token'}
            aria-label={visible ? 'Hide token' : 'Show token'}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void verifyGithub()}
            disabled={!token.trim() || busy}
          >
            {busy ? <Loader2 size={12} className="spin" /> : 'Verify'}
          </button>
        </div>
        <p className="deploy-field-hint">
          Needs the <code>repo</code> scope. Stored in sessionStorage for this tab
          only and sent directly to api.github.com.
        </p>
      </label>
    </div>
  );
}

function HostingPanel({ target }: { target: HostingTarget }) {
  const settings = useDeployStore((state) => state.settings);
  const setField = useDeployStore((state) => state.setField);
  const saveTarget = useDeployStore((state) => state.saveTarget);
  const meta = HOSTING_META[target];

  return (
    <div className="deploy-panel-inner">
      <PanelHeader
        icon={meta.icon}
        kicker={meta.kicker}
        title={meta.title}
        copy={meta.copy}
        status={<span className="deploy-status is-pending">Adapter pending</span>}
      />

      <div className="deploy-card">
        <div className="deploy-card-head">
          <span className="deploy-card-title">Target</span>
          <span className="deploy-field-tag">saved in this browser</span>
        </div>

        {target === 'vercel' ? (
          <div className="deploy-grid single">
            <label className="field">
              <span className="field-label">Project name</span>
              <input
                className="field-input"
                value={settings.vercelProject}
                onChange={(event) => setField('vercelProject', event.target.value)}
                placeholder="my-company"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
        ) : null}

        {target === 'cloudflare' ? (
          <div className="deploy-grid">
            <label className="field">
              <span className="field-label">Account ID</span>
              <input
                className="field-input"
                value={settings.cloudflareAccount}
                onChange={(event) => setField('cloudflareAccount', event.target.value)}
                placeholder="023e105f…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span className="field-label">Pages project</span>
              <input
                className="field-input"
                value={settings.cloudflareProject}
                onChange={(event) => setField('cloudflareProject', event.target.value)}
                placeholder="my-company"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
        ) : null}

        {target === 'netlify' ? (
          <div className="deploy-grid single">
            <label className="field">
              <span className="field-label">Site ID</span>
              <input
                className="field-input"
                value={settings.netlifySite}
                onChange={(event) => setField('netlifySite', event.target.value)}
                placeholder="4f8a1d2c-…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
        ) : null}

        <div className="deploy-actions">
          <button type="button" className="solid-button small" onClick={saveTarget}>
            Save target
          </button>
        </div>
      </div>

      <p className="deploy-note">
        <ShieldCheck size={14} />
        <span>
          <strong>Adapter pending.</strong> This build stores the target
          configuration but does not upload files yet. The GitHub panel is fully
          wired — push the workspace there, then connect that repository in{' '}
          {meta.title.split(' ')[0]}.
        </span>
      </p>

      <ActivityLog />
    </div>
  );
}

function CreateRepoForm() {
  const settings = useDeployStore((state) => state.settings);
  const token = useDeployStore((state) => state.token);
  const busy = useDeployStore((state) => state.busy);
  const setField = useDeployStore((state) => state.setField);
  const runGithubAction = useDeployStore((state) => state.runGithubAction);

  return (
    <div className="deploy-card">
      <div className="deploy-card-head">
        <span className="deploy-card-title">New repository</span>
        <span className="deploy-field-tag">under token owner</span>
      </div>

      <div className="deploy-grid">
        <label className="field">
          <span className="field-label">Repository name</span>
          <input
            className="field-input"
            value={settings.githubRepo}
            onChange={(event) => setField('githubRepo', event.target.value)}
            placeholder="my-company"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <input
            className="field-input"
            value={settings.githubDescription}
            onChange={(event) => setField('githubDescription', event.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="deploy-checkbox">
        <input
          type="checkbox"
          checked={settings.githubPrivate}
          onChange={(event) => setField('githubPrivate', event.target.checked)}
        />
        Private repository
      </label>

      <div className="deploy-actions">
        <button
          type="button"
          className="solid-button small"
          onClick={() => void runGithubAction()}
          disabled={busy || !token.trim() || !settings.githubRepo.trim()}
        >
          {busy ? <Loader2 size={12} className="spin" /> : <Plus size={12} />}
          Create repository
        </button>
        <span className="deploy-actions-note">Requires a verify or action token</span>
      </div>
    </div>
  );
}

function TransferForm({ action }: { action: Exclude<GithubAction, 'create'> }) {
  const settings = useDeployStore((state) => state.settings);
  const token = useDeployStore((state) => state.token);
  const busy = useDeployStore((state) => state.busy);
  const setField = useDeployStore((state) => state.setField);
  const runGithubAction = useDeployStore((state) => state.runGithubAction);

  const label =
    action === 'pull' ? 'Pull from GitHub' : action === 'push' ? 'Push to GitHub' : 'Sync repository';
  const icon =
    action === 'pull' ? <ArrowDownToLine size={12} /> : action === 'push' ? <ArrowUpFromLine size={12} /> : <RefreshCw size={12} />;

  return (
    <div className="deploy-card">
      <div className="deploy-card-head">
        <span className="deploy-card-title">Repository</span>
        <span className="deploy-field-tag">
          {action === 'pull' ? 'remote → workspace' : action === 'push' ? 'workspace → remote' : 'pull then push'}
        </span>
      </div>

      <div className="deploy-grid">
        <label className="field">
          <span className="field-label">Owner</span>
          <input
            className="field-input"
            value={settings.githubOwner}
            onChange={(event) => setField('githubOwner', event.target.value)}
            placeholder="octocat"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="field-label">Repository</span>
          <input
            className="field-input"
            value={settings.githubRepo}
            onChange={(event) => setField('githubRepo', event.target.value)}
            placeholder="my-company"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className={`deploy-grid ${action === 'pull' ? 'single' : ''}`}>
        <label className="field">
          <span className="field-label">Branch</span>
          <input
            className="field-input"
            value={settings.githubBranch}
            onChange={(event) => setField('githubBranch', event.target.value)}
            placeholder="main"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {action !== 'pull' ? (
          <label className="field">
            <span className="field-label">Commit message</span>
            <input
              className="field-input"
              value={settings.githubMessage}
              onChange={(event) => setField('githubMessage', event.target.value)}
              placeholder="Update from Forge"
              autoComplete="off"
            />
          </label>
        ) : null}
      </div>

      <div className="deploy-actions">
        <button
          type="button"
          className="solid-button small"
          onClick={() => void runGithubAction()}
          disabled={
            busy ||
            !token.trim() ||
            !settings.githubOwner.trim() ||
            !settings.githubRepo.trim()
          }
        >
          {busy ? <Loader2 size={12} className="spin" /> : icon}
          {label}
        </button>
      </div>

      <p className="deploy-field-hint">
        {action === 'pull'
          ? 'Pull replaces the workspace with the branch contents.'
          : action === 'push'
            ? 'Push mirrors the workspace into one commit; deleted files are removed from the branch.'
            : 'Sync pulls the branch first, replaces the workspace, then commits that snapshot back.'}
      </p>
    </div>
  );
}

function GithubPanel() {
  const githubAction = useDeployStore((state) => state.githubAction);
  const token = useDeployStore((state) => state.token);
  const busy = useDeployStore((state) => state.busy);
  const lastRepoUrl = useDeployStore((state) => state.lastRepoUrl);
  const meta = GITHUB_META[githubAction];

  return (
    <div className="deploy-panel-inner">
      <PanelHeader
        icon={<GitBranch size={16} />}
        kicker="Source control / GitHub"
        title={meta.title}
        copy={meta.copy}
        status={
          busy ? (
            <span className="deploy-status is-busy">
              <Loader2 size={10} className="spin" /> Working
            </span>
          ) : token.trim() ? (
            <span className="deploy-status is-ready">Token loaded</span>
          ) : (
            <span className="deploy-status is-pending">Not connected</span>
          )
        }
      />

      <TokenCard />
      {githubAction === 'create' ? <CreateRepoForm /> : <TransferForm action={githubAction} />}

      {lastRepoUrl ? (
        <a className="deploy-repo-link" href={lastRepoUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={12} />
          {lastRepoUrl.replace(/^https?:\/\/github\.com\//, '')}
        </a>
      ) : null}

      <ActivityLog />
    </div>
  );
}

function DeployPanel() {
  const target = useDeployStore((state) => state.target);
  return target === 'github' ? <GithubPanel /> : <HostingPanel target={target} />;
}

export function DeployDialog() {
  const deployOpen = useDeployStore((state) => state.deployOpen);
  const setDeployOpen = useDeployStore((state) => state.setDeployOpen);

  if (!deployOpen) return null;

  return (
    <Modal
      title="Deploy"
      subtitle="Ship the workspace to a host or mirror it to a GitHub repository."
      onClose={() => setDeployOpen(false)}
      width={920}
      bodyClassName="deploy-modal-body"
      footer={
        <>
          <span className="deploy-footer-note">
            Tokens stay in this tab · no keys are written to the project or server
          </span>
          <button className="ghost-button" onClick={() => setDeployOpen(false)}>
            Close
          </button>
        </>
      }
    >
      <div className="deploy-shell">
        <DeployNav />
        <section className="deploy-panel">
          <DeployPanel />
        </section>
      </div>
    </Modal>
  );
}

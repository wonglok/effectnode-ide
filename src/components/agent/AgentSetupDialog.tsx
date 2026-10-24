import { CircleAlert, CircleCheck, Server } from 'lucide-react';
import { useAgentStore } from '@/store/agent';
import { Modal } from '../Dialogs';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="agent-setting-row">
      <span className="agent-setting-label">{label}</span>
      <code className="agent-setting-value">{value}</code>
    </div>
  );
}

function HarnessSettings() {
  const harness = useAgentStore((state) => state.harness);
  const statusLoaded = useAgentStore((state) => state.statusLoaded);
  const closeSetup = useAgentStore((state) => state.closeSetup);

  const configured = Boolean(harness?.configured);

  return (
    <Modal
      title="DeepSeek Harness"
      subtitle="The agent runs as a server-side dsh subprocess driven by @deepseek-ai/dsh-sdk-client."
      onClose={closeSetup}
      width={560}
      footer={
        <button className="solid-button small" onClick={closeSetup}>
          Close
        </button>
      }
    >
      {!statusLoaded ? (
        <div className="projects-offline">
          <Server size={13} /> Checking the Nitro server…
        </div>
      ) : configured ? (
        <div className="agent-server-key">
          <CircleCheck size={12} />
          Harness ready. The credential is read on the server and never sent to this tab.
        </div>
      ) : (
        <div className="agent-form-warning">
          <CircleAlert size={12} />
          No credential found. Add <code>DEEPSEEK_API_KEY</code> (or{' '}
          <code>AGENT_API_KEY</code>) to <code>.env.local</code> and restart the dev server.
        </div>
      )}

      <div className="agent-form">
        <Row label="Provider" value={harness?.provider ?? 'deepseek-official'} />
        <Row label="Model" value={harness?.model ?? 'deepseek-v4-flash'} />
        <Row label="Reasoning effort" value={harness?.reasoningEffort ?? 'model default'} />
        <Row label="Max output tokens" value={String(harness?.maxTokens ?? 'model default')} />
        <Row label="Credential source" value={harness?.keySource ?? 'not configured'} />
      </div>

      <p className="agent-privacy">
        Tune the route with <code>DSH_PROVIDER</code>, <code>DSH_MODEL</code>,{' '}
        <code>DSH_REASONING_EFFORT</code>, and <code>DSH_MAX_TOKENS</code>. When{' '}
        <code>DSH_MODEL</code> is unset the harness falls back to{' '}
        <code>AGENT_MODEL</code>, then <code>deepseek-v4-flash</code>. Each turn mirrors
        the virtual project into <code>data/harness-workspaces/</code>; only text files
        inside that workspace are mirrored back.
      </p>
    </Modal>
  );
}

export function AgentSetupDialog() {
  const open = useAgentStore((state) => state.setupOpen);
  if (!open) return null;
  return <HarnessSettings />;
}

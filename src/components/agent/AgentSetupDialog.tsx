import { CircleAlert, CircleCheck, Server, ShieldCheck } from 'lucide-react';
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

function ProxySettings() {
  const status = useAgentStore((state) => state.status);
  const statusLoaded = useAgentStore((state) => state.statusLoaded);
  const closeSetup = useAgentStore((state) => state.closeSetup);
  const configured = Boolean(status?.configured);

  return (
    <Modal
      title="DeepSeek proxy"
      subtitle="The browser agent calls a same-origin REST route with your Forge JWT."
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
          Proxy ready. The DeepSeek key is inserted server-side and never enters this tab.
        </div>
      ) : (
        <div className="agent-form-warning">
          <CircleAlert size={12} />
          No credential found. Add <code>DEEPSEEK_API_KEY</code> (or{' '}
          <code>AGENT_API_KEY</code>) to <code>.env.local</code> and restart the dev server.
        </div>
      )}

      <div className="agent-form">
        <Row label="Provider" value={status?.provider ?? 'deepseek'} />
        <Row label="Model" value={status?.model ?? 'deepseek-flash'} />
        <Row
          label="Proxy URL"
          value={status?.proxyUrl ?? '/api/deepseek/chat/completions'}
        />
        <Row label="Proxy auth" value="Forge JWT · Authorization: Bearer …" />
        <Row label="Credential source" value={status?.keySource ?? 'not configured'} />
        <Row label="Project files" value="OPFS · sandbox/<ide>/projects/<project>" />
      </div>

      <p className="agent-privacy">
        <ShieldCheck size={11} /> The proxy rejects requests without the Forge JWT issued by the
        unlock gate. Only the proxy holds the DeepSeek key. Configure the route with{' '}
        <code>DEEPSEEK_MODEL</code> and <code>DEEPSEEK_BASE_URL</code>;{' '}
        <code>AGENT_MODEL</code> remains the fallback.
      </p>
    </Modal>
  );
}

export function AgentSetupDialog() {
  const open = useAgentStore((state) => state.setupOpen);
  if (!open) return null;
  return <ProxySettings />;
}

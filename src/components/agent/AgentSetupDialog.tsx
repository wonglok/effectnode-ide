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
  const engine = useAgentStore((state) => state.engine);
  const closeSetup = useAgentStore((state) => state.closeSetup);
  const configured =
    engine === 'claude'
      ? Boolean(status?.claude?.configured)
      : engine === 'pi'
        ? Boolean(status?.pi?.configured)
        : Boolean(status?.configured);
  const provider =
    engine === 'claude'
      ? 'anthropic'
      : engine === 'pi'
        ? status?.pi?.provider ?? 'pi'
        : status?.provider ?? 'deepseek';
  const model =
    engine === 'claude'
      ? status?.claude?.model ?? 'deepseek-flash[1m]'
      : engine === 'pi'
        ? status?.pi?.model ?? 'deepseek-flash[1m]'
        : status?.model ?? 'deepseek-flash';
  const proxyUrl =
    engine === 'claude'
      ? status?.claude?.proxyUrl ?? '/api/anthropic/v1/messages'
      : engine === 'pi'
        ? status?.pi?.proxyUrl ?? '/api/anthropic/v1/messages'
        : status?.proxyUrl ?? '/api/deepseek/chat/completions';

  return (
    <Modal
      title="Agent proxy"
      subtitle="Every browser harness calls a same-origin REST route with your Forge JWT."
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
        <Row label="Engine" value={engine} />
        <Row label="Provider" value={provider} />
        <Row label="Model" value={model} />
        <Row label="Proxy URL" value={proxyUrl} />
        {engine === 'pi' ? (
          <>
            <Row label="Harness" value={status?.pi?.harness ?? 'pi-agent-core'} />
            <Row
              label="Thinking"
              value={status?.pi?.thinkingLevel ?? 'medium'}
            />
          </>
        ) : null}
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

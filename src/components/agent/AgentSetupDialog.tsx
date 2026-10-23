import { useRef, useState } from 'react';
import { CircleAlert, Eye, EyeOff, KeyRound, Server } from 'lucide-react';
import {
  AGENT_PRESETS,
  isLocalAgentUrl,
  type AgentPreset,
} from '@/lib/agent-config';
import { useAgentStore } from '@/store/agent';
import { useProjectStore } from '@/store/projects';
import { Modal } from '../Dialogs';

function validateBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a valid URL, e.g. https://api.openai.com/v1';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && isLocalAgentUrl(value)) return null;
  return 'Use HTTPS. Plain HTTP is only allowed for localhost.';
}

function SetupForm() {
  const config = useAgentStore((state) => state.config);
  const hasServerKey = useAgentStore((state) => state.hasServerKey);
  const setConfig = useAgentStore((state) => state.setConfig);
  const closeSetup = useAgentStore((state) => state.closeSetup);
  const serverOnline = useProjectStore((state) => state.serverOnline);

  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [showKey, setShowKey] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  const urlError = baseUrl.trim() ? validateBaseUrl(baseUrl.trim()) : null;
  const local = isLocalAgentUrl(baseUrl.trim());
  const missingKey = !apiKey.trim() && !hasServerKey && !local;
  const canSave = Boolean(baseUrl.trim() && model.trim() && !urlError);

  const applyPreset = (preset: AgentPreset) => {
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    if (preset.requiresKey) {
      window.setTimeout(() => keyRef.current?.focus(), 30);
    }
  };

  const submit = () => {
    if (!canSave) return;
    setConfig({ baseUrl, model, apiKey });
  };

  return (
    <Modal
      title="Connect the agent"
      subtitle="Forge Agent uses any OpenAI-compatible chat completions API."
      onClose={closeSetup}
      width={560}
      footer={
        <>
          <button className="ghost-button" onClick={closeSetup}>
            Cancel
          </button>
          <button className="solid-button small" onClick={submit} disabled={!canSave}>
            Save & connect
          </button>
        </>
      }
    >
      {serverOnline === false ? (
        <div className="projects-offline">
          <CircleAlert size={13} /> The agent proxy needs the Nitro server. Start the app with{' '}
          <code>npm run dev</code>.
        </div>
      ) : null}

      <div className="agent-presets">
        {AGENT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`agent-preset ${baseUrl === preset.baseUrl ? 'is-active' : ''}`}
            onClick={() => applyPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="agent-form">
        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            className="field-input"
            id="agent-base-url"
            name="agent-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            autoComplete="off"
          />
          {urlError ? <span className="field-error">{urlError}</span> : null}
        </label>

        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="field-input"
            id="agent-model"
            name="agent-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gpt-4o-mini"
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">
            <KeyRound size={11} /> API key {local ? <em>(not needed for localhost)</em> : null}
          </span>
          <div className="agent-key-row">
            <input
              ref={keyRef}
              className="field-input"
              id="agent-api-key"
              name="agent-api-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasServerKey ? 'Using the server key — leave blank' : 'sk-…'}
              spellCheck={false}
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            <button className="icon-button" onClick={() => setShowKey((value) => !value)} title={showKey ? 'Hide key' : 'Show key'}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
      </div>

      {hasServerKey ? (
        <div className="agent-server-key">
          <Server size={12} />
          A server-side key is configured (<code>AGENT_API_KEY</code>). Leave the field blank to use it.
        </div>
      ) : null}

      {missingKey ? (
        <div className="agent-form-warning">
          <CircleAlert size={12} /> Add an API key (or set <code>AGENT_API_KEY</code> on the server) to send messages.
        </div>
      ) : null}

      <p className="agent-privacy">
        The key is held in <code>sessionStorage</code> for this tab only. Requests go to your local
        Nitro server, which forwards them to the provider. Nothing is written to disk.
      </p>
    </Modal>
  );
}

export function AgentSetupDialog() {
  const open = useAgentStore((state) => state.setupOpen);
  if (!open) return null;
  return <SetupForm />;
}

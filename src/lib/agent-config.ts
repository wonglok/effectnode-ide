export interface AgentConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AgentPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  requiresKey: boolean;
  keyHint?: string;
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    requiresKey: true,
    keyHint: "sk-…",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    requiresKey: true,
    keyHint: "sk-…",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    requiresKey: true,
    keyHint: "sk-or-…",
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    requiresKey: false,
    keyHint: "not required",
  },
];

export const EMPTY_AGENT_CONFIG: AgentConfig = {
  baseUrl: "",
  model: "",
  apiKey: "",
};

export const AGENT_BASE_URL_KEY = "forge.agent.baseUrl";
export const AGENT_MODEL_KEY = "forge.agent.model";
export const AGENT_SECRET_KEY = "forge.agent.key";

export function isLocalAgentUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]" ||
        url.hostname === "0.0.0.0")
    );
  } catch {
    return false;
  }
}

/** Base URL + model are safe to remember; the key lives only in this tab. */
export function loadAgentConfig(): AgentConfig {
  try {
    return {
      baseUrl: localStorage.getItem(AGENT_BASE_URL_KEY) ?? "",
      model: localStorage.getItem(AGENT_MODEL_KEY) ?? "",
      apiKey: sessionStorage.getItem(AGENT_SECRET_KEY) ?? "",
    };
  } catch {
    return { ...EMPTY_AGENT_CONFIG };
  }
}

export function persistAgentConfig(config: AgentConfig): void {
  try {
    if (config.baseUrl)
      localStorage.setItem(AGENT_BASE_URL_KEY, config.baseUrl);
    else localStorage.removeItem(AGENT_BASE_URL_KEY);

    if (config.model) localStorage.setItem(AGENT_MODEL_KEY, config.model);
    else localStorage.removeItem(AGENT_MODEL_KEY);

    if (config.apiKey) sessionStorage.setItem(AGENT_SECRET_KEY, config.apiKey);
    else sessionStorage.removeItem(AGENT_SECRET_KEY);
  } catch {
    // Storage can be unavailable in private modes; the in-memory config still works.
  }
}

export function agentIsConfigured(
  config: AgentConfig,
  hasServerKey: boolean,
): boolean {
  if (!config.baseUrl.trim() || !config.model.trim()) return false;
  return (
    Boolean(config.apiKey.trim()) ||
    hasServerKey ||
    isLocalAgentUrl(config.baseUrl)
  );
}

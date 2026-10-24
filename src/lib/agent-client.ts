import type { AgentStatusResponse } from '../../shared/types';
import { authHeaders, handleUnauthorized } from './auth-token';

async function errorFromResponse(response: Response): Promise<Error> {
  let message = `Agent status request failed (${response.status})`;
  try {
    const text = await response.text();
    try {
      const data = JSON.parse(text) as {
        message?: string;
        statusMessage?: string;
        error?: { message?: string };
      };
      message = data.message || data.error?.message || data.statusMessage || message;
    } catch {
      if (text && text.length < 500) message = text;
    }
  } catch {
    // Keep the generic message.
  }
  return new Error(message);
}

export async function fetchAgentStatus(): Promise<AgentStatusResponse> {
  const response = await fetch('/api/agent/status', {
    headers: { Accept: 'application/json', ...authHeaders() },
  });
  handleUnauthorized(response);
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as AgentStatusResponse;
}

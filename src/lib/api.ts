import type {
  AuthStatusResponse,
  DeleteResponse,
  HealthResponse,
  ProjectListResponse,
  ProjectMeta,
  ProjectSnapshot,
  SaveProjectPayload,
} from '../../shared/types';
import {
  authHeaders,
  handleUnauthorized,
  writeAuthToken,
} from './auth-token';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...init.headers,
    },
  });

  handleUnauthorized(response);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { message?: string; statusMessage?: string };
      message = data.message || data.statusMessage || message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const authApi = {
  status: () => request<AuthStatusResponse>('/auth'),

  unlock: async (password: string): Promise<AuthStatusResponse> => {
    const status = await request<AuthStatusResponse>('/auth', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (status.token) writeAuthToken(status.token);
    return status;
  },
};

export const projectApi = {
  health: () => request<HealthResponse>('/health'),

  list: async (): Promise<ProjectMeta[]> => {
    const data = await request<ProjectListResponse>('/projects');
    return data.projects;
  },

  get: (id: string) => request<ProjectSnapshot>(`/projects/${encodeURIComponent(id)}`),

  save: (payload: SaveProjectPayload) =>
    request<ProjectMeta>('/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  remove: (id: string) =>
    request<DeleteResponse>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

import { create } from 'zustand';
import { authApi } from '@/lib/api';
import { clearAuthToken, readAuthToken } from '@/lib/auth-token';

export type AuthPhase = 'checking' | 'locked' | 'unlocked' | 'offline';

interface AuthState {
  phase: AuthPhase;
  /** Whether the server has a password gate configured. */
  required: boolean | null;
  submitting: boolean;
  error: string | null;
  check: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  logout: () => void;
}

/**
 * Server-backed UI gate. The server issues a no-expiry JWT after a correct
 * password; this browser keeps it in localStorage and sends it with every REST
 * request, so the token is shared across tabs on the same origin.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  phase: 'checking',
  required: null,
  submitting: false,
  error: null,

  check: async () => {
    set({ phase: 'checking', error: null });
    const token = readAuthToken();
    try {
      const status = await authApi.status();
      if (status.required && !status.unlocked) {
        if (token) clearAuthToken();
        set({ phase: 'locked', required: status.required });
        return;
      }
      if (!status.required && token) clearAuthToken();
      set({ phase: 'unlocked', required: status.required });
    } catch (error) {
      set({
        phase: 'offline',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  unlock: async (password) => {
    set({ submitting: true, error: null });
    try {
      const status = await authApi.unlock(password);
      const rejected = status.required && !status.unlocked;
      if (rejected) clearAuthToken();
      set({
        submitting: false,
        required: status.required,
        phase: rejected ? 'locked' : 'unlocked',
        error: rejected ? status.message ?? 'Incorrect password' : null,
      });
    } catch (error) {
      set({
        submitting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /** Drop the JWT and return to the unlock gate (files stay in OPFS). */
  logout: () => {
    clearAuthToken();
    set((state) => ({
      phase: state.required === false ? 'unlocked' : 'locked',
      submitting: false,
      error: null,
    }));
    // Re-check so a server without a gate does not stay stuck on the lock UI.
    void get().check();
  },
}));

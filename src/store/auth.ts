import { create } from 'zustand';
import { authApi } from '@/lib/api';

export type AuthPhase = 'checking' | 'locked' | 'unlocked' | 'offline';

interface AuthState {
  phase: AuthPhase;
  submitting: boolean;
  error: string | null;
  check: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
}

/** Server-backed UI gate; the lock cookie is HttpOnly and shared across tabs. */
export const useAuthStore = create<AuthState>((set) => ({
  phase: 'checking',
  submitting: false,
  error: null,

  check: async () => {
    set({ phase: 'checking', error: null });
    try {
      const status = await authApi.status();
      set({ phase: status.required && !status.unlocked ? 'locked' : 'unlocked' });
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
      set({
        submitting: false,
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
}));

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-token';
import { useAuthStore } from '@/store/auth';

/**
 * Keeps the IDE unmounted until the server accepts the stored JWT. The password
 * is exchanged for a no-expiry token after a successful unlock.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const phase = useAuthStore((state) => state.phase);
  const submitting = useAuthStore((state) => state.submitting);
  const error = useAuthStore((state) => state.error);
  const unlock = useAuthStore((state) => state.unlock);
  const check = useAuthStore((state) => state.check);
  const [password, setPassword] = useState('');

  useEffect(() => {
    void useAuthStore.getState().check();
  }, []);

  // A 401 from any REST call clears the token; re-check so the gate returns.
  useEffect(() => {
    const onAuthChanged = () => {
      void useAuthStore.getState().check();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  if (phase === 'unlocked') return <>{children}</>;

  const checking = phase === 'checking';
  const offline = phase === 'offline';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (checking || submitting || !password) return;
    void unlock(password);
  };

  return (
    <div className="unlock-screen">
      <div className="unlock-grid" aria-hidden="true" />
      <main className="unlock-card" aria-labelledby="unlock-title">
        <div className="brand unlock-brand">
          <span className="brand-forge">F</span>
          <span className="brand-name">Forge</span>
        </div>

        <div className="unlock-icon" aria-hidden="true">
          <LockKeyhole size={18} />
        </div>
        <h1 id="unlock-title" className="unlock-title">
          This workspace is locked
        </h1>
        <p className="unlock-copy">
          {offline
            ? 'The Forge server could not be reached, so the workspace cannot be unlocked yet.'
            : 'Enter the access password to open the editor, agent, and preview.'}
        </p>

        <form className="unlock-form" onSubmit={onSubmit}>
          <label className="unlock-label" htmlFor="unlock-password">
            Password
          </label>
          <div className="unlock-row">
            <input
              id="unlock-password"
              className="field-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={checking ? 'Checking access…' : 'Enter password'}
              disabled={checking || submitting}
              aria-invalid={error ? true : undefined}
            />
            <button
              className="solid-button unlock-submit"
              type="submit"
              disabled={checking || submitting || !password}
            >
              {submitting ? <Loader2 size={13} className="spin" /> : null}
              {submitting ? 'Unlocking' : 'Unlock'}
            </button>
          </div>

          {error ? (
            <p className="unlock-error" role="alert">
              {error}
            </p>
          ) : null}

          {checking ? (
            <p className="unlock-hint">
              <Loader2 size={11} className="spin" /> Checking access…
            </p>
          ) : offline ? (
            <button
              className="unlock-retry"
              type="button"
              onClick={() => void check()}
            >
              Retry connection
            </button>
          ) : (
            <p className="unlock-hint">The password is set with FORGE_PASSWORD on the server.</p>
          )}
        </form>
      </main>
    </div>
  );
}

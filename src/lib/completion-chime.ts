/**
 * Completion feedback for the agent workbench. The audio context is unlocked
 * while the user is submitting a task, then a short three-note chime can play
 * when the run finishes — including when the work took long enough that the
 * user has switched to another tab.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (context && context.state !== 'closed') return context;

  const Constructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;

  try {
    context = new Constructor();
  } catch {
    return null;
  }
  return context;
}

/** Call from a user gesture so the browser allows the completion cue later. */
export function primeCompletionAudio(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

/** Play the three-note task-complete chime. */
export function playCompletionChime(): void {
  const ctx = getContext();
  if (!ctx) return;

  const ring = () => {
    const startAt = ctx.currentTime + 0.03;
    for (let index = 0; index < 3; index += 1) {
      const start = startAt + index * 0.24;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, start);
      oscillator.frequency.exponentialRampToValueAtTime(1318.5, start + 0.05);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    }
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(ring).catch(() => {});
    return;
  }
  ring();
}

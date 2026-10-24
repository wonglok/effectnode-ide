import { useEffect, useRef, useState } from 'react';
import { SECTION_COUNT } from '../sections/registry.ts';
import { useScrollerStore } from '../store/useScrollerStore.ts';

/** Keep the splash up at least this long so a fast boot does not flash. */
const MIN_VISIBLE_MS = 700;
/** Fade-out length; the component unmounts once it finishes. */
const FADE_MS = 760;

export function SplashScreen() {
  const bootPhase = useScrollerStore((state) => state.bootPhase);
  const preloadProgress = useScrollerStore((state) => state.preloadProgress);

  const mountedAt = useRef(0);
  const [canDismiss, setCanDismiss] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    mountedAt.current = window.performance.now();
  }, []);

  useEffect(() => {
    if (bootPhase !== 'ready') return;
    const remaining = Math.max(
      0,
      MIN_VISIBLE_MS - (window.performance.now() - mountedAt.current)
    );
    const timer = window.setTimeout(() => setCanDismiss(true), remaining);
    return () => window.clearTimeout(timer);
  }, [bootPhase]);

  useEffect(() => {
    if (!canDismiss) return;
    const timer = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [canDismiss]);

  if (!mounted) return null;

  const ready = bootPhase === 'ready';
  const progress = ready ? 1 : preloadProgress;
  const percent = Math.round(progress * 100);
  const status = ready ? 'Ready to scroll' : 'Preparing scenes';

  return (
    <div className="ef-splash" data-done={canDismiss} role="status" aria-live="polite">
      <div className="ef-splash-inner">
        <div className="ef-splash-brand">
          <span className="ef-splash-mark" />
          <span>MY COMPANY</span>
        </div>

        <div className="ef-splash-status">
          <span>{status}</span>
          <span className="ef-splash-percent">{percent}%</span>
        </div>

        <div
          className="ef-splash-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className="ef-splash-readouts">
          <span>
            Chapters <b>{String(SECTION_COUNT).padStart(2, '0')}</b>
          </span>
          <span>
            Renderer <b>WebGPU</b>
          </span>
        </div>
      </div>
    </div>
  );
}

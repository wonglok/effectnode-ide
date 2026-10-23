import { create } from 'zustand';
import { SECTION_COUNT } from '../sections/registry.ts';
import { audioEngine } from '../lib/audio-engine.ts';
import {
  CHAPTER_SPAN,
  PHASE_HOLD,
  getChapterAnchor,
  getChapterBlend,
} from '../lib/scroll-phases.ts';

export type BootPhase = 'loading' | 'ready';

/** The fixed element that owns wheel and touch gestures instead of <html>. */
export const SCROLL_ROOT_ID = 'ef-scroll-root';

function resolveScrollRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(SCROLL_ROOT_ID);
}

const maxScrollProgress = () =>
  getChapterAnchor(SECTION_COUNT - 1) + PHASE_HOLD;

const clampProgress = (value: number) =>
  Math.min(maxScrollProgress(), Math.max(0, value));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

type ScrollerState = {
  /** Continuous scroll position in phase units. */
  scrollProgress: number;
  activeIndex: number;
  fromIndex: number;
  toIndex: number;
  /** 0..1 blend between fromIndex and toIndex during a handoff. */
  transitionProgress: number;
  isTransitioning: boolean;
  bootPhase: BootPhase;
  /** 0..1 while the canvas warms up. */
  preloadProgress: number;
  soundFx: boolean;
  music: boolean;
  setScroll: (progress: number) => void;
  setBootPhase: (phase: BootPhase) => void;
  setPreloadProgress: (progress: number) => void;
  goTo: (index: number) => void;
  /** Snap directly to a chapter, used when the router restores a URL. */
  jumpTo: (index: number) => void;
  previewTransition: (index: number) => void;
  setSoundFx: (enabled: boolean) => void;
  setMusic: (enabled: boolean) => void;
};

type ScrollMotion = 'idle' | 'spring' | 'coast' | 'preview';

type ScrollEngine = {
  scrollPixel: number;
  scrollTargetPixel: number;
  scrollVelocity: number;
  pixelsPerSection: number;
  scrollFrame: number;
  scrollFrameTime: number;
  scrollMotion: ScrollMotion;
  scrollRoot: HTMLElement | null;
  previewStartPixel: number;
  previewEndPixel: number;
  previewStartTime: number;
};

const createScrollEngine = (): ScrollEngine => ({
  scrollPixel: 0,
  scrollTargetPixel: 0,
  scrollVelocity: 0,
  pixelsPerSection: 1,
  scrollFrame: 0,
  scrollFrameTime: 0,
  scrollMotion: 'idle',
  scrollRoot: null,
  previewStartPixel: 0,
  previewEndPixel: 0,
  previewStartTime: 0,
});

/**
 * Keep the engine on the browser global. Hot reload can evaluate this module
 * twice; a fresh engine would leave the live listeners driving the old copy.
 */
const engine: ScrollEngine =
  typeof window === 'undefined'
    ? createScrollEngine()
    : ((window as unknown as { __easyFancyScroll?: ScrollEngine })
        .__easyFancyScroll ??= createScrollEngine());

const SCROLL_STIFFNESS = 30;
const SCROLL_DAMPING = 11;
const SCROLL_FRICTION = 4;
const WHEEL_INERTIA = 4;
const WHEEL_GAIN = 0.35;
const WHEEL_LINE_HEIGHT = 16;
const MAX_SCROLL_VELOCITY = 3200;
const COAST_REST_SPEED = 8;
const TOUCH_IDLE_MS = 120;
const SECTION_SCROLL_HEIGHTS = 2;
const PREVIEW_LEAD_MS = 240;
const PREVIEW_DURATION_MS = 2200;

function measureSectionPixels() {
  const height =
    engine.scrollRoot?.clientHeight ||
    (typeof window !== 'undefined' ? window.innerHeight : 0);
  return Math.max(height, 1) * SECTION_SCROLL_HEIGHTS;
}

const clampScrollPixel = (value: number) =>
  Math.min(maxScrollProgress() * engine.pixelsPerSection, Math.max(0, value));

const clampVelocity = (value: number) =>
  Math.min(MAX_SCROLL_VELOCITY, Math.max(-MAX_SCROLL_VELOCITY, value));

function publishScroll() {
  useScrollerStore
    .getState()
    .setScroll(engine.scrollPixel / engine.pixelsPerSection);
}

function integrateVelocity(dt: number) {
  const next = clampScrollPixel(
    engine.scrollPixel + engine.scrollVelocity * dt
  );
  if (next === engine.scrollPixel) engine.scrollVelocity = 0;
  engine.scrollPixel = next;
}

function scrollLoop(now: number) {
  engine.scrollFrame = window.requestAnimationFrame(scrollLoop);
  const dt = Math.min(Math.max((now - engine.scrollFrameTime) / 1000, 0.001), 0.05);
  engine.scrollFrameTime = now;

  if (engine.scrollMotion === 'preview') {
    const progress = Math.min(
      1,
      Math.max(
        0,
        (now - engine.previewStartTime - PREVIEW_LEAD_MS) / PREVIEW_DURATION_MS
      )
    );
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    engine.scrollPixel =
      engine.previewStartPixel +
      (engine.previewEndPixel - engine.previewStartPixel) * eased;
    engine.scrollTargetPixel = engine.scrollPixel;
    engine.scrollVelocity = 0;
    if (progress >= 1) engine.scrollMotion = 'idle';
    publishScroll();
    return;
  }

  if (engine.scrollMotion === 'coast') {
    engine.scrollVelocity *= Math.exp(-SCROLL_FRICTION * dt);
    integrateVelocity(dt);
    engine.scrollTargetPixel = engine.scrollPixel;

    if (Math.abs(engine.scrollVelocity) < COAST_REST_SPEED) {
      engine.scrollVelocity = 0;
      engine.scrollMotion = 'idle';
      publishScroll();
      return;
    }

    publishScroll();
    return;
  }

  if (engine.scrollMotion !== 'spring') return;

  const displacement = engine.scrollTargetPixel - engine.scrollPixel;
  engine.scrollVelocity +=
    (displacement * SCROLL_STIFFNESS -
      engine.scrollVelocity * SCROLL_DAMPING) *
    dt;
  integrateVelocity(dt);

  const restDistance = 0.0004 * engine.pixelsPerSection;
  const restSpeed = 0.002 * engine.pixelsPerSection;
  if (
    Math.abs(engine.scrollTargetPixel - engine.scrollPixel) < restDistance &&
    Math.abs(engine.scrollVelocity) < restSpeed
  ) {
    engine.scrollPixel = engine.scrollTargetPixel;
    engine.scrollVelocity = 0;
    engine.scrollMotion = 'idle';
    publishScroll();
    return;
  }

  publishScroll();
}

function startScrollLoop() {
  if (engine.scrollFrame || typeof window === 'undefined') return;
  engine.scrollFrameTime = window.performance.now();
  engine.scrollFrame = window.requestAnimationFrame(scrollLoop);
}

export function scrollVirtualTo(progress: number) {
  if (typeof window === 'undefined') return;
  if (engine.pixelsPerSection <= 1) {
    engine.pixelsPerSection = measureSectionPixels();
  }

  engine.scrollTargetPixel = clampProgress(progress) * engine.pixelsPerSection;
  engine.scrollVelocity = 0;
  engine.scrollMotion = 'spring';
  startScrollLoop();
}

function playTransitionPreview(fromIndex: number) {
  if (typeof window === 'undefined') return;
  if (
    !Number.isInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex >= SECTION_COUNT - 1
  ) {
    return;
  }
  if (engine.pixelsPerSection <= 1) {
    engine.pixelsPerSection = measureSectionPixels();
  }

  const start = getChapterAnchor(fromIndex) + PHASE_HOLD;
  const end = getChapterAnchor(fromIndex + 1);

  engine.scrollPixel = clampScrollPixel(start * engine.pixelsPerSection);
  engine.scrollTargetPixel = engine.scrollPixel;
  engine.scrollVelocity = 0;
  engine.previewStartPixel = engine.scrollPixel;
  engine.previewEndPixel = clampScrollPixel(end * engine.pixelsPerSection);
  engine.previewStartTime = window.performance.now();
  engine.scrollMotion = 'preview';
  publishScroll();
  startScrollLoop();
}

function createScrollerStore() {
  return create<ScrollerState>((set) => ({
    scrollProgress: 0,
    activeIndex: 0,
    fromIndex: 0,
    toIndex: 0,
    transitionProgress: 0,
    isTransitioning: false,
    bootPhase: 'loading',
    preloadProgress: 0,
    soundFx: true,
    music: false,

    setScroll: (rawProgress) => {
      const scrollProgress = clampProgress(rawProgress);
      const lower = Math.min(
        Math.floor(scrollProgress / CHAPTER_SPAN),
        SECTION_COUNT - 1
      );
      const toIndex = Math.min(lower + 1, SECTION_COUNT - 1);
      const blend = getChapterBlend(scrollProgress);
      const isTransitioning = blend > 0.002 && blend < 0.998;
      const activeIndex = blend < 0.5 ? lower : toIndex;

      if (!isTransitioning) {
        set({
          scrollProgress,
          activeIndex,
          fromIndex: activeIndex,
          toIndex: activeIndex,
          transitionProgress: 0,
          isTransitioning: false,
        });
        return;
      }

      set({
        scrollProgress,
        activeIndex,
        fromIndex: lower,
        toIndex,
        transitionProgress: blend,
        isTransitioning: true,
      });
    },

    setBootPhase: (bootPhase) => set({ bootPhase }),
    setPreloadProgress: (preloadProgress) =>
      set({ preloadProgress: clamp01(preloadProgress) }),

    goTo: (index) => {
      audioEngine.playUiClick();
      scrollVirtualTo(getChapterAnchor(Math.max(0, Math.min(SECTION_COUNT - 1, index))));
    },

    jumpTo: (index) => {
      const safe = Math.max(0, Math.min(SECTION_COUNT - 1, Math.round(index)));
      if (engine.pixelsPerSection <= 1) {
        engine.pixelsPerSection = measureSectionPixels();
      }
      const progress = getChapterAnchor(safe);
      engine.scrollPixel = clampScrollPixel(progress * engine.pixelsPerSection);
      engine.scrollTargetPixel = engine.scrollPixel;
      engine.scrollVelocity = 0;
      engine.scrollMotion = 'idle';
      publishScroll();
    },

    previewTransition: (index) => {
      audioEngine.playUiClick();
      playTransitionPreview(index);
    },

    setSoundFx: (soundFx) => {
      set({ soundFx });
      audioEngine.setSoundFx(soundFx);
    },

    setMusic: (music) => {
      set({ music });
      audioEngine.setMusic(music);
    },
  }));
}

type ScrollerStore = ReturnType<typeof createScrollerStore>;

export const useScrollerStore: ScrollerStore =
  typeof window === 'undefined'
    ? createScrollerStore()
    : ((window as unknown as { __easyFancyStore?: ScrollerStore })
        .__easyFancyStore ??= createScrollerStore());

/**
 * Turns wheel and touch gestures into virtual scroll. Native scrolling stays
 * off so the canvas scenes receive a continuous, eased position.
 */
export function trackPageScroll() {
  const root = resolveScrollRoot();
  if (!root) return () => {};

  engine.scrollRoot = root;
  engine.pixelsPerSection = measureSectionPixels();

  const progress = clampProgress(useScrollerStore.getState().scrollProgress);
  engine.scrollPixel = progress * engine.pixelsPerSection;
  engine.scrollTargetPixel = engine.scrollPixel;
  engine.scrollVelocity = 0;
  engine.scrollMotion = 'idle';

  const onResize = () => {
    const next = measureSectionPixels();
    if (next === engine.pixelsPerSection) return;

    const currentProgress = engine.scrollPixel / engine.pixelsPerSection;
    const targetProgress = engine.scrollTargetPixel / engine.pixelsPerSection;
    engine.pixelsPerSection = next;
    engine.scrollPixel = clampScrollPixel(currentProgress * next);
    engine.scrollTargetPixel = clampScrollPixel(targetProgress * next);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const pixels =
      event.deltaY *
      (event.deltaMode === 1
        ? WHEEL_LINE_HEIGHT
        : event.deltaMode === 2
          ? root.clientHeight
          : 1);

    engine.scrollVelocity = clampVelocity(
      engine.scrollVelocity + (pixels / WHEEL_GAIN) * WHEEL_INERTIA
    );
    engine.scrollMotion = 'coast';
    startScrollLoop();
  };

  let touchY: number | null = null;
  let touchTime = 0;
  let touchVelocity = 0;

  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    touchTime = performance.now();
    touchVelocity = 0;
    engine.scrollVelocity = 0;
    engine.scrollMotion = 'idle';
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touchY === null || event.touches.length !== 1) return;
    event.preventDefault();

    const now = performance.now();
    const y = event.touches[0].clientY;
    const delta = touchY - y;
    const dt = Math.max(now - touchTime, 1) / 1000;

    const previous = engine.scrollPixel;
    const next = clampScrollPixel(previous + delta);
    engine.scrollPixel = next;
    engine.scrollTargetPixel = next;
    touchY = y;

    if (next === previous && delta !== 0) {
      touchVelocity = 0;
    } else {
      touchVelocity = touchVelocity * 0.5 + (delta / dt) * 0.3;
    }
    touchTime = now;
    engine.scrollVelocity = 0;
    engine.scrollMotion = 'idle';
    publishScroll();
  };

  const onTouchEnd = () => {
    if (touchY === null) return;
    const paused = performance.now() - touchTime > TOUCH_IDLE_MS;
    touchY = null;
    if (!paused && Math.abs(touchVelocity) > COAST_REST_SPEED) {
      engine.scrollVelocity = clampVelocity(touchVelocity);
      engine.scrollMotion = 'coast';
    }
    touchVelocity = 0;
  };

  const onTouchCancel = () => {
    touchY = null;
    touchVelocity = 0;
    engine.scrollVelocity = 0;
    engine.scrollMotion = 'idle';
  };

  startScrollLoop();

  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize, { passive: true });
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('touchend', onTouchEnd, { passive: true });
  root.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return () => {
    if (engine.scrollFrame) window.cancelAnimationFrame(engine.scrollFrame);
    engine.scrollFrame = 0;
    if (engine.scrollRoot === root) engine.scrollRoot = null;
    root.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('touchend', onTouchEnd);
    root.removeEventListener('touchcancel', onTouchCancel);
  };
}

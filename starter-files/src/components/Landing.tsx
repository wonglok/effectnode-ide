import { useEffect, useRef, type CSSProperties } from "react";
import { SECTION_COUNT, SECTIONS } from "../sections/registry.ts";
import {
  SCROLL_ROOT_ID,
  trackPageScroll,
  useScrollerStore,
} from "../store/useScrollerStore.ts";
import { audioEngine } from "../lib/audio-engine.ts";
import { PHASE_HOLD, getChapterAnchor } from "../lib/scroll-phases.ts";
import { SceneStage } from "./SceneStage.tsx";
import { SplashScreen } from "./SplashScreen.tsx";

/** Progress line under the header; subscribes without re-rendering the page. */
function ScrollLine() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const maxProgress = getChapterAnchor(SECTION_COUNT - 1) + PHASE_HOLD;
    const apply = (progress: number) => {
      if (!ref.current) return;
      ref.current.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / maxProgress))})`;
    };

    apply(useScrollerStore.getState().scrollProgress);
    return useScrollerStore.subscribe((state) => apply(state.scrollProgress));
  }, []);

  return (
    <div className="ef-scroll-line" aria-hidden="true">
      <span ref={ref} />
    </div>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="ef-speaker" d="M4 9.1h3.6L12.5 5v14l-4.9-4.1H4V9.1Z" />
      {on ? (
        <g className="ef-sound-waves">
          <path d="M16.1 8.6a4.9 4.9 0 0 1 0 6.8" />
          <path d="M18.8 5.9a8.8 8.8 0 0 1 0 12.2" />
        </g>
      ) : (
        <g className="ef-sound-muted">
          <path d="m16.2 9.2 5.1 5.6" />
          <path d="m21.3 9.2-5.1 5.6" />
        </g>
      )}
    </svg>
  );
}

function Header() {
  const activeIndex = useScrollerStore((state) => state.activeIndex);
  const music = useScrollerStore((state) => state.music);
  const setMusic = useScrollerStore((state) => state.setMusic);
  const goTo = useScrollerStore((state) => state.goTo);
  const section = SECTIONS[activeIndex] ?? SECTIONS[0];

  return (
    <header className="ef-header">
      <button
        className="ef-brand"
        onClick={() => goTo(0)}
        aria-label="MY COMPANY — back to the beginning"
      >
        <span className="ef-brand-mark" />
        <span>MY COMPANY</span>
      </button>

      <div className="ef-header-right">
        <button
          type="button"
          className="ef-sound"
          data-on={music}
          onClick={() => setMusic(!music)}
          aria-label={
            music ? "Mute background music" : "Unmute background music"
          }
          aria-pressed={music}
          title={music ? "Mute music" : "Unmute music"}
        >
          <SoundIcon on={music} />
        </button>

        <button
          className="ef-talk"
          type="button"
          onClick={() => goTo(SECTION_COUNT - 1)}
          title="Jump to the last chapter"
        >
          Start a project
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div
        className="ef-header-accent"
        style={{ background: section.accent }}
        aria-hidden="true"
      />
    </header>
  );
}

function SceneHud() {
  const activeIndex = useScrollerStore((state) => state.activeIndex);
  const goTo = useScrollerStore((state) => state.goTo);

  return (
    <nav className="ef-hud" aria-label="Scene switcher">
      {SECTIONS.map((section) => {
        const active = activeIndex === section.index;
        return (
          <button
            key={section.id}
            type="button"
            className="ef-hud-button"
            data-active={active}
            style={{ "--accent": section.accent } as CSSProperties}
            onClick={() => goTo(section.index, { slow: true })}
            aria-label={`Go to scene ${section.index + 1}, ${section.name}`}
            aria-current={active ? "true" : undefined}
            title={section.name}
          >
            {String(section.index + 1).padStart(2, "0")}
          </button>
        );
      })}
    </nav>
  );
}

function ScrollCue() {
  const scrollProgress = useScrollerStore((state) => state.scrollProgress);
  const bootPhase = useScrollerStore((state) => state.bootPhase);
  const hidden = bootPhase !== "ready" || scrollProgress > 0.16;

  return (
    <div className="ef-cue" data-hidden={hidden} aria-hidden="true">
      <span>Scroll to explore</span>
      <i>
        <b />
        <b />
        <b />
      </i>
    </div>
  );
}

function Footer() {
  const activeIndex = useScrollerStore((state) => state.activeIndex);
  const section = SECTIONS[activeIndex] ?? SECTIONS[0];

  return (
    <footer className="ef-footer">
      <span className="ef-footer-chapter">
        <i style={{ background: section.accent }} />
        {section.chapter} — {section.name}
      </span>
      <span className="ef-footer-hint">Scroll / drag to steer</span>
    </footer>
  );
}

export function Landing() {
  useEffect(() => trackPageScroll(), []);

  // An embedding host can drive the story with postMessage.
  useEffect(() => {
    const navigate = (event: MessageEvent) => {
      const data = event.data as {
        source?: unknown;
        type?: unknown;
        index?: unknown;
        from?: unknown;
      } | null;
      if (!data || data.source !== "my-company") return;

      if (data.type === "scroll-to-scene") {
        const index = Number(data.index);
        if (!Number.isInteger(index) || index < 0 || index >= SECTION_COUNT)
          return;
        useScrollerStore.getState().goTo(index);
        return;
      }

      if (data.type === "play-transition") {
        const from = Number(data.from);
        if (!Number.isInteger(from) || from < 0 || from >= SECTION_COUNT - 1)
          return;
        useScrollerStore.getState().previewTransition(from);
      }
    };

    window.addEventListener("message", navigate);
    return () => window.removeEventListener("message", navigate);
  }, []);

  // Browsers unlock audio on the first gesture.
  useEffect(() => {
    const startAudio = () => {
      const { soundFx, music } = useScrollerStore.getState();
      void audioEngine
        .start({ soundFx, music })
        .catch((error) => console.warn("Audio unavailable:", error));
    };
    window.addEventListener("pointerdown", startAudio, { once: true });
    return () => window.removeEventListener("pointerdown", startAudio);
  }, []);

  return (
    <main className="ef-page">
      <div className="ef-scroller" id={SCROLL_ROOT_ID}>
        <SceneStage />
        <div className="ef-grain" aria-hidden="true" />
        <ScrollLine />
        <Header />
        <SceneHud />
        <ScrollCue />
        <Footer />
      </div>
      <SplashScreen />
    </main>
  );
}

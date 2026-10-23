/**
 * Every scene runs through three phases as the page scrolls:
 *
 *   enter    the previous chapter's exit blend brings the scene in
 *   animate  the scene is held fully visible (the hero pose)
 *   exit     the blend hands the viewport to the next scene
 *
 * Chapter i is anchored at `i * CHAPTER_SPAN`. It holds for PHASE_HOLD, then
 * crossfades to the next chapter over PHASE_BLEND. The last chapter never
 * reaches its exit blend.
 */
export const PHASE_HOLD = 0.5;
export const PHASE_BLEND = 1;
export const CHAPTER_SPAN = PHASE_HOLD + PHASE_BLEND;
export const SCENE_SPAN = PHASE_BLEND * 2 + PHASE_HOLD;

/** Scroll position where a chapter's animate phase starts. */
export function getChapterAnchor(index: number) {
  return index * CHAPTER_SPAN;
}

export type SectionPhaseName = 'enter' | 'animate' | 'exit';

export type SectionPhaseState = {
  phase: SectionPhaseName;
  /** Progress through the current phase, 0..1. */
  progress: number;
  /** Progress through the scene's whole enter → animate → exit life. */
  sceneProgress: number;
  /** How much of this scene the composite should show, 0..1. */
  activity: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function getSectionPhaseAt(
  index: number,
  scrollProgress: number
): SectionPhaseState {
  const relative = scrollProgress - getChapterAnchor(index);
  const sceneProgress = clamp01((relative + PHASE_BLEND) / SCENE_SPAN);

  if (relative < 0) {
    const progress = clamp01((relative + PHASE_BLEND) / PHASE_BLEND);
    return { phase: 'enter', progress, sceneProgress, activity: progress };
  }

  if (relative <= PHASE_HOLD) {
    return {
      phase: 'animate',
      progress: clamp01(relative / PHASE_HOLD),
      sceneProgress,
      activity: 1,
    };
  }

  const progress = clamp01((relative - PHASE_HOLD) / PHASE_BLEND);
  return { phase: 'exit', progress, sceneProgress, activity: 1 - progress };
}

/** Crossfade amount for the chapter interval that contains scrollProgress. */
export function getChapterBlend(scrollProgress: number) {
  const anchor = Math.floor(scrollProgress / CHAPTER_SPAN) * CHAPTER_SPAN;
  return clamp01((scrollProgress - anchor - PHASE_HOLD) / PHASE_BLEND);
}

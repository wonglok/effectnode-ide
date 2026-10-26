/**
 * Chapter handoffs. Each transition owns its TSL graph; the compositor picks
 * one per chapter pair and supplies the two pass textures, progress, accent,
 * and the shared finish pass.
 */
import { crossZoomTransition } from "./cross-zoom.ts";
import { liquidTransition } from "./liquid.ts";
import { pageCurlTransition } from "./page-curl.ts";
import type { Transition } from "./types.ts";

/** Pairs with a signature handoff; everything else uses the liquid wipe. */
const PAIR_TRANSITIONS: Record<string, Transition> = {
  "3-4": pageCurlTransition,
  "4-5": crossZoomTransition,
};

export function transitionForPair(
  fromIndex: number,
  toIndex: number,
): Transition {
  const pair = `${Math.min(fromIndex, toIndex)}-${Math.max(fromIndex, toIndex)}`;
  return PAIR_TRANSITIONS[pair] ?? liquidTransition;
}

export type { TextureNode, Transition, TransitionContext } from "./types.ts";

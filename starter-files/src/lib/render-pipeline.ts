/**
 * Scene compositor, adapted from 3d render pipeline.
 *
 * Each chapter renders through its own PassNode. The output graph references
 * only the active pass — or the two passes taking part in a handoff — so a
 * transition costs exactly two scene renders. The handoff itself is a TSL
 * shader from `src/transitions`, driven by scroll progress, followed by a
 * shared vignette and film-grain finish.
 */
import * as THREE from "three/webgpu";
import {
  RenderPipeline,
  type Node,
  type PassNode,
  type WebGPURenderer,
} from "three/webgpu";
import {
  interleavedGradientNoise,
  length,
  oneMinus,
  screenCoordinate,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import { SECTIONS } from "../sections/registry.ts";
import {
  transitionForPair,
  type TextureNode,
} from "../transitions/index.ts";

/** Smoothstep easing so both ends of a handoff start and finish gently. */
function easeInOut(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export type PipelineState = {
  fromIndex: number;
  toIndex: number;
  isTransitioning: boolean;
  progress: number;
};

export class SectionRenderPipeline {
  private readonly pipeline: RenderPipeline;
  private readonly passes: PassNode[];
  private readonly uniforms = {
    progress: uniform(0),
    accent: uniform(new THREE.Color(SECTIONS[0].accent)),
    time: uniform(0),
  };
  private readonly toColor = new THREE.Color();
  private activeKey = "";

  constructor(renderer: WebGPURenderer, passes: PassNode[]) {
    this.passes = passes;
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = true;
    this.buildOutput(0, 0, false);
  }

  update(state: PipelineState, elapsed: number) {
    const progress = easeInOut(state.progress);
    this.uniforms.progress.value = progress;
    this.uniforms.time.value = elapsed;

    const fromMeta = SECTIONS[state.fromIndex] ?? SECTIONS[0];
    const toMeta = SECTIONS[state.toIndex] ?? fromMeta;
    const p = state.isTransitioning ? progress : 1;
    this.uniforms.accent.value
      .set(fromMeta.accent)
      .lerp(this.toColor.set(toMeta.accent), p);

    const key = `${state.fromIndex}:${state.toIndex}:${state.isTransitioning}`;
    if (key !== this.activeKey) {
      this.buildOutput(state.fromIndex, state.toIndex, state.isTransitioning);
      this.activeKey = key;
    }
  }

  render() {
    this.pipeline.render();
  }

  /** Compiles one frame of every handoff while the splash is still up. */
  prewarm() {
    const first = this.passes[0];
    if (!first) return;

    for (let index = 0; index < this.passes.length - 1; index += 1) {
      const from = this.passes[index] ?? first;
      const to = this.passes[index + 1] ?? from;
      this.pipeline.outputNode = this.transitionNode(
        from.getTextureNode(),
        to.getTextureNode(),
        index,
        index + 1,
      );
      this.pipeline.needsUpdate = true;
      this.pipeline.render();
    }

    this.buildOutput(0, 0, false);
    this.pipeline.render();
    this.activeKey = "";
  }

  dispose() {
    this.pipeline.dispose();
  }

  private buildOutput(
    fromIndex: number,
    toIndex: number,
    isTransitioning: boolean,
  ) {
    const fromPass = this.passes[fromIndex] ?? this.passes[0];
    if (!fromPass) return;
    const toPass = this.passes[toIndex] ?? fromPass;
    const fromTexture = fromPass.getTextureNode();
    const toTexture = toPass.getTextureNode();

    const base = isTransitioning
      ? this.transitionNode(fromTexture, toTexture, fromIndex, toIndex)
      : this.finishNode(fromTexture.sample(screenUV));

    this.pipeline.outputNode = base;
    this.pipeline.needsUpdate = true;
  }

  /** Picks and builds the handoff shader for the pair of chapters. */
  private transitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode,
    fromIndex: number,
    toIndex: number,
  ) {
    const transition = transitionForPair(fromIndex, toIndex);
    return transition({
      fromTexture,
      toTexture,
      progress: this.uniforms.progress,
      accent: this.uniforms.accent,
      finish: (input) => this.finishNode(input),
    });
  }

  /** Shared vignette and animated film grain. */
  private finishNode(input: Node<"vec4">) {
    const uv = screenUV;
    const vignette = oneMinus(smoothstep(0.32, 0.86, length(uv.sub(0.5))))
      .mul(0.18)
      .add(0.82);

    const grain = interleavedGradientNoise(
      screenCoordinate.add(
        vec2(this.uniforms.time.mul(47), this.uniforms.time.mul(91)),
      ),
    )
      .sub(0.5)
      .mul(0.018);

    const rgb = input.rgb.mul(vignette).add(grain);
    return vec4(rgb, 1);
  }
}

/**
 * Scene compositor, adapted from Easy Fancy's render pipeline.
 *
 * Each chapter renders through its own PassNode. The output graph references
 * only the active pass — or the two passes taking part in a handoff — so a
 * transition costs exactly two scene renders. The handoff itself is a TSL
 * shader (liquid glass, column melt, or cross zoom) driven by scroll progress,
 * followed by a shared vignette and film-grain finish.
 */
import * as THREE from 'three/webgpu';
import {
  RenderPipeline,
  type Node,
  type PassNode,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  color,
  cos,
  dot,
  float,
  floor,
  fract,
  interleavedGradientNoise,
  length,
  max,
  mix,
  mod,
  mx_fractal_noise_float_2d,
  oneMinus,
  pow,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { SECTIONS } from '../sections/registry.ts';

const TRANSITION_WIDTH = 0.24;

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

type TextureNode = ReturnType<PassNode['getTextureNode']>;

export class SectionRenderPipeline {
  private readonly pipeline: RenderPipeline;
  private readonly passes: PassNode[];
  private readonly uniforms = {
    progress: uniform(0),
    accent: uniform(new THREE.Color(SECTIONS[0].accent)),
    time: uniform(0),
  };
  private readonly toColor = new THREE.Color();
  private activeKey = '';

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
        index + 1
      );
      this.pipeline.needsUpdate = true;
      this.pipeline.render();
    }

    this.buildOutput(0, 0, false);
    this.pipeline.render();
    this.activeKey = '';
  }

  dispose() {
    this.pipeline.dispose();
  }

  private buildOutput(
    fromIndex: number,
    toIndex: number,
    isTransitioning: boolean
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

  /** Picks a handoff shader for the pair of chapters taking part. */
  private transitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode,
    fromIndex: number,
    toIndex: number
  ) {
    const pair = `${Math.min(fromIndex, toIndex)}-${Math.max(fromIndex, toIndex)}`;
    if (pair === '2-3') {
      return this.crossZoomTransitionNode(fromTexture, toTexture);
    }
    if (pair === '1-2') {
      return this.meltTransitionNode(fromTexture, toTexture);
    }
    return this.liquidTransitionNode(fromTexture, toTexture);
  }

  /**
   * Doom-style column melt: the outgoing frame runs down the screen in
   * vertical bars while the incoming scene is uncovered from the top.
   */
  private meltTransitionNode(fromTexture: TextureNode, toTexture: TextureNode) {
    const BARS = 30;
    const AMPLITUDE: number = 2;
    const NOISE: number = 0.1;
    const FREQUENCY: number = 0.5;
    const DRIP_SCALE: number = 0.5;

    const progress = this.uniforms.progress;
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<'vec2'>) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<'vec2'>) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    const num = floor(uv.x.mul(BARS));
    const rand = fract(
      mod(num.mul(67123.313), 12)
        .mul(sin(num.mul(10.3)))
        .mul(cos(num))
    );

    const fn = num.mul(FREQUENCY * 0.1 * BARS);
    const wave = cos(fn.mul(0.5))
      .mul(cos(fn.mul(0.13)))
      .mul(sin(fn.add(10).mul(0.3)))
      .div(2)
      .add(0.5);

    const drip = sin(num.div(BARS - 1).mul(Math.PI)).mul(DRIP_SCALE);
    const waved = NOISE === 0 ? wave : mix(wave, rand, NOISE);
    const shape = DRIP_SCALE === 0 ? waved : waved.add(drip);
    const phase = progress.mul(shape.mul(AMPLITUDE).add(1));

    const fromColor = sampleFrom(vec2(uv.x, uv.y.add(phase)));
    const toColor = sampleTo(uv);

    return this.finishNode(
      vec4(select(phase.add(uv.y).lessThan(1), fromColor, toColor), 1)
    );
  }

  /**
   * Cross zoom: both frames dissolve through a zoom blur that punches in and
   * settles while its centre drifts across the screen.
   */
  private crossZoomTransitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode
  ) {
    const STRENGTH = 0.4;
    const SAMPLES = 40;

    const progress = this.uniforms.progress;
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<'vec2'>) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<'vec2'>) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    const center = vec2(progress.mul(0.5).add(0.25), 0.5);

    const time = progress.mul(2);
    const easeIn = pow(float(2), time.sub(1).mul(10)).mul(0.5);
    const easeOut = pow(float(2), time.sub(1).mul(-10)).mul(-0.5).add(1);
    const eased = select(time.lessThan(1), easeIn, easeOut);
    const dissolve = select(
      progress.lessThanEqual(0),
      float(0),
      select(progress.greaterThanEqual(1), float(1), eased)
    );

    const blurStrength = oneMinus(cos(progress.mul(2 * Math.PI))).mul(
      STRENGTH * 0.5
    );

    const offset = fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));
    const toCenter = center.sub(uv);

    let sum: Node<'vec3'> = vec3(0);
    let total: Node<'float'> = float(0);
    for (let tap = 0; tap <= SAMPLES; tap += 1) {
      const percent = offset.add(tap).div(SAMPLES);
      const weight = percent.sub(percent.mul(percent)).mul(4);
      const sampleUv = uv.add(toCenter.mul(percent).mul(blurStrength));
      const faded = mix(sampleFrom(sampleUv), sampleTo(sampleUv), dissolve);
      sum = sum.add(faded.mul(weight));
      total = total.add(weight);
    }

    return this.finishNode(vec4(sum.div(total), 1));
  }

  /**
   * Liquid-glass wipe: a noisy edge travels upward with refraction at the
   * seam, a thin chromatic split, and a light leak tinted by both accents.
   */
  private liquidTransitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode
  ) {
    const uv = screenUV;
    const aspect = screenSize.x.div(screenSize.y);
    const noise = mx_fractal_noise_float_2d(
      uv.mul(vec2(aspect, 1)).mul(3.1),
      3,
      2.0,
      0.5,
      1.0
    )
      .mul(0.5)
      .add(0.5);

    const vertical = oneMinus(uv.y);
    const front = this.uniforms.progress.mul(2.1).sub(0.55);
    const warped = vertical.add(noise.sub(0.5).mul(0.46));
    const wipe = oneMinus(smoothstep(0, TRANSITION_WIDTH, warped.sub(front)));

    const seam = smoothstep(0, 0.12, wipe).mul(
      smoothstep(0, 0.12, oneMinus(wipe))
    );
    const ripple = smoothstep(0, 0.9, seam);
    const wobble = mix(float(-1), float(1), noise).mul(ripple);

    const distortion = vec2(
      wobble.mul(0.026),
      seam.mul(noise.sub(0.5)).mul(0.052)
    );
    const sampleUv = uv.add(distortion);
    const chroma = vec2(seam.mul(0.008).add(0.0007), 0);

    const fromRed = fromTexture.sample(sampleUv.add(chroma)).r;
    const fromGreen = fromTexture.sample(sampleUv).g;
    const fromBlue = fromTexture.sample(sampleUv.sub(chroma)).b;
    const toRed = toTexture.sample(sampleUv.add(chroma)).r;
    const toGreen = toTexture.sample(sampleUv).g;
    const toBlue = toTexture.sample(sampleUv.sub(chroma)).b;

    const fromColor = vec3(fromRed, fromGreen, fromBlue);
    const toColor = vec3(toRed, toGreen, toBlue);
    const blended = mix(fromColor, toColor, wipe);

    const lightLeak = max(float(0), oneMinus(vertical.mul(1.2).add(0.1)))
      .mul(seam)
      .mul(0.16);
    const tinted = blended.add(color(this.uniforms.accent).mul(lightLeak));

    return this.finishNode(vec4(tinted, 1));
  }

  /** Shared vignette and animated film grain. */
  private finishNode(input: Node<'vec4'>) {
    const uv = screenUV;
    const vignette = oneMinus(smoothstep(0.32, 0.86, length(uv.sub(0.5))))
      .mul(0.18)
      .add(0.82);

    const grain = interleavedGradientNoise(
      screenCoordinate.add(
        vec2(this.uniforms.time.mul(47), this.uniforms.time.mul(91))
      )
    )
      .sub(0.5)
      .mul(0.018);

    const rgb = input.rgb.mul(vignette).add(grain);
    return vec4(rgb, 1);
  }
}

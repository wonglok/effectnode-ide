/**
 * Scene compositor, adapted from 3d render pipeline.
 *
 * Each chapter renders through its own PassNode. The output graph references
 * only the active pass — or the two passes taking part in a handoff — so a
 * transition costs exactly two scene renders. The handoff itself is a TSL
 * shader (liquid glass, column melt, or cross zoom) driven by scroll progress,
 * followed by a shared vignette and film-grain finish.
 */
import * as THREE from "three/webgpu";
import {
  RenderPipeline,
  type Node,
  type PassNode,
  type WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  acos,
  and,
  clamp,
  color,
  cos,
  dot,
  float,
  fract,
  interleavedGradientNoise,
  length,
  max,
  min,
  mix,
  mod,
  mx_fractal_noise_float_2d,
  oneMinus,
  or,
  pow,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { SECTIONS } from "../sections/registry.ts";

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

type TextureNode = ReturnType<PassNode["getTextureNode"]>;

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

  /** Picks a handoff shader for the pair of chapters taking part. */
  private transitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode,
    fromIndex: number,
    toIndex: number,
  ) {
    const pair = `${Math.min(fromIndex, toIndex)}-${Math.max(fromIndex, toIndex)}`;
    if (pair === "2-3") {
      return this.crossZoomTransitionNode(fromTexture, toTexture);
    }
    if (pair === "1-2") {
      return this.pageCurlTransitionNode(fromTexture, toTexture);
    }
    return this.liquidTransitionNode(fromTexture, toTexture);
  }

  /**
   * Page curl, ported from Hewlett-Packard's WebVFX reference (adapted by
   * Sergey Kosarevsky), BSD 3-Clause. The outgoing frame becomes a paper sheet
   * wrapped around a cylinder; it rolls away and shadows the incoming scene.
   */
  private pageCurlTransitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode,
  ) {
    const PI = Math.PI;
    const MIN_AMOUNT = -0.16;
    const MAX_AMOUNT = 1.5;
    const CYLINDER_RADIUS = 1 / PI / 2;
    const SCALE = 512;
    const SHARPNESS = 3;
    const ANGLE = (100 * PI) / 180;

    // The reference bakes a 100° page edge into two fixed matrices. GLSL
    // mat3s are column-major, so each product expands to these two rows.
    const ROT_C = Math.cos(-ANGLE);
    const ROT_S = Math.sin(-ANGLE);
    const BACK_C = Math.cos(ANGLE);
    const BACK_S = Math.sin(ANGLE);

    const progress = this.uniforms.progress;
    const amount = progress.mul(MAX_AMOUNT - MIN_AMOUNT).add(MIN_AMOUNT);
    const cylinderAngle = amount.mul(2 * PI);

    // Work in the reference's bottom-left UV space, then flip back to the
    // render-target's top-left origin when sampling.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    const rotate = (v: Node<"vec3">) =>
      vec3(
        v.x.mul(ROT_C).sub(v.y.mul(ROT_S)).sub(0.801),
        v.x.mul(ROT_S).add(v.y.mul(ROT_C)).add(0.89),
        v.z,
      );
    const rotateBack = (v: Node<"vec3">) =>
      vec3(
        v.x.mul(BACK_C).sub(v.y.mul(BACK_S)).add(0.985),
        v.x.mul(BACK_S).add(v.y.mul(BACK_C)).add(0.985),
        v.z,
      );

    /** Maps a point on the cylinder back onto the page. */
    const hitPoint = (hitAngle: Node<"float">, point: Node<"vec3">) =>
      rotateBack(vec3(point.x, hitAngle.div(2 * PI), point.z));

    const isOutside = (point: Node<"vec3">) =>
      or(
        or(point.x.lessThan(0), point.y.lessThan(0)),
        or(point.x.greaterThan(1), point.y.greaterThan(1)),
      );

    const antiAlias = (
      color1: Node<"vec3">,
      color2: Node<"vec3">,
      distance: Node<"float">,
    ) => {
      const d = distance.mul(SCALE);
      // Clamping the base keeps pow() out of NaN territory for the branches
      // the reference discards; at d > 2 the blend already returns color1.
      const dd = pow(max(oneMinus(d.div(2)), 0), SHARPNESS);
      const blended = color2.sub(color1).mul(dd).add(color1);
      return select(
        d.lessThan(0),
        color2,
        select(d.greaterThan(2), color1, blended),
      );
    };

    const distanceToEdge = (point: Node<"vec3">) => {
      const baseDx = abs(
        select(point.x.greaterThan(0.5), oneMinus(point.x), point.x),
      );
      const baseDy = abs(
        select(point.y.greaterThan(0.5), oneMinus(point.y), point.y),
      );
      let dx = select(point.x.lessThan(0), point.x.negate(), baseDx);
      dx = select(point.x.greaterThan(1), point.x.sub(1), dx);
      let dy = select(point.y.lessThan(0), point.y.negate(), baseDy);
      dy = select(point.y.greaterThan(1), point.y.sub(1), dy);

      const bothOut = and(
        or(point.x.lessThan(0), point.x.greaterThan(1)),
        or(point.y.lessThan(0), point.y.greaterThan(1)),
      );
      return select(bothOut, sqrt(dx.mul(dx).add(dy.mul(dy))), min(dx, dy));
    };

    /** What shows through the gap where the curled sheet has lifted. */
    const seeThrough = (yc: Node<"float">) => {
      const hitAngle = float(PI).sub(
        acos(clamp(yc.div(CYLINDER_RADIUS), -1, 1)).sub(cylinderAngle),
      );
      const point = hitPoint(hitAngle, rotate(vec3(uv.x, uv.y, 1)));
      const edge = antiAlias(
        sampleFrom(point.xy),
        vec3(0),
        distanceToEdge(point),
      );
      return select(
        and(yc.lessThanEqual(0), isOutside(point)),
        sampleTo(uv),
        select(yc.greaterThan(0), sampleFrom(uv), edge),
      );
    };

    /**
     * Composites a plain black shadow over the scene: alpha 1 is fully black
     * at the fold and alpha 0 leaves the incoming frame untouched. Keeping the
     * shadow as an opacity ramp avoids per-channel subtraction, which can
     * brighten or shift colours into an inverted-looking rim.
     */
    const applyShadow = (colorValue: Node<"vec3">, alpha: Node<"float">) =>
      colorValue.mul(oneMinus(clamp(alpha, 0, 1)));

    const seeThroughWithShadow = (yc: Node<"float">, point: Node<"vec3">) => {
      const base = oneMinus(distanceToEdge(point).mul(30)).div(3);
      return applyShadow(seeThrough(yc), base.mul(amount));
    };

    /** The paper's reverse side: a desaturated back-lit grey. */
    const backside = (yc: Node<"float">, point: Node<"vec3">) => {
      const paper = sampleFrom(point.xy);
      const gray = paper.r.add(paper.b).add(paper.g).div(15);
      const lift = pow(
        max(float(0), oneMinus(abs(yc.div(CYLINDER_RADIUS)))),
        0.2,
      )
        .div(2)
        .add(0.5)
        .mul(0.8);
      return vec3(gray.add(lift));
    };

    /** Everything past the curl, seen from behind the sheet. */
    const behindSurface = (ycIn: Node<"float">, pointIn: Node<"vec3">) => {
      // Flip to the other half of the cylinder.
      const yc = float(-2 * CYLINDER_RADIUS).sub(ycIn);
      const hitAngle = acos(clamp(yc.div(CYLINDER_RADIUS), -1, 1))
        .add(cylinderAngle)
        .sub(PI);
      const point = hitPoint(hitAngle, pointIn);

      const dx = point.x.sub(0.5);
      const dy = point.y.sub(0.5);
      const nyc = yc.negate().div(CYLINDER_RADIUS);
      const innerShadow = oneMinus(sqrt(dx.mul(dx).add(dy.mul(dy))).div(0.71))
        .mul(nyc.mul(nyc).mul(nyc))
        .mul(0.5);
      const inside = and(
        and(point.x.greaterThanEqual(0), point.y.greaterThanEqual(0)),
        and(point.x.lessThanEqual(1), point.y.lessThanEqual(1)),
      );
      const useInner = and(
        and(yc.lessThan(0), inside),
        or(hitAngle.lessThan(PI), amount.greaterThan(0.5)),
      );
      const shadow = select(useInner, innerShadow, float(0));

      // A black-to-transparent radial shadow under the curled sheet.
      return applyShadow(sampleTo(uv), shadow);
    };

    const rotated = rotate(vec3(uv.x, uv.y, 1));
    const yc = rotated.y.sub(amount);
    const hitAngle = acos(clamp(yc.div(CYLINDER_RADIUS), -1, 1))
      .add(cylinderAngle)
      .sub(PI);
    const hitAngleMod = mod(hitAngle, 2 * PI);
    const seeThroughEarly = or(
      and(hitAngleMod.greaterThan(PI), amount.lessThan(0.5)),
      and(hitAngleMod.greaterThan(PI / 2), amount.lessThan(0)),
    );

    const hit = hitPoint(hitAngle, rotated);
    const otherColor = select(yc.lessThan(0), vec3(0), sampleFrom(uv));
    const curled = antiAlias(
      backside(yc, hit),
      otherColor,
      float(CYLINDER_RADIUS).sub(abs(yc)),
    );
    const edge = antiAlias(
      curled,
      seeThroughWithShadow(yc, hit),
      distanceToEdge(hit),
    );
    const middle = select(
      seeThroughEarly,
      seeThrough(yc),
      select(isOutside(hit), seeThroughWithShadow(yc, hit), edge),
    );

    const rgb = select(
      yc.lessThan(-CYLINDER_RADIUS),
      behindSurface(yc, rotated),
      select(yc.greaterThan(CYLINDER_RADIUS), sampleFrom(uv), middle),
    );

    return this.finishNode(vec4(rgb, 1));
  }

  /**
   * Cross zoom: both frames dissolve through a zoom blur that punches in and
   * settles while its centre drifts across the screen.
   */
  private crossZoomTransitionNode(
    fromTexture: TextureNode,
    toTexture: TextureNode,
  ) {
    const STRENGTH = 0.4;
    const SAMPLES = 40;

    const progress = this.uniforms.progress;
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    const center = vec2(progress.mul(0.5).add(0.25), 0.5);

    const time = progress.mul(2);
    const easeIn = pow(float(2), time.sub(1).mul(10)).mul(0.5);
    const easeOut = pow(float(2), time.sub(1).mul(-10)).mul(-0.5).add(1);
    const eased = select(time.lessThan(1), easeIn, easeOut);
    const dissolve = select(
      progress.lessThanEqual(0),
      float(0),
      select(progress.greaterThanEqual(1), float(1), eased),
    );

    const blurStrength = oneMinus(cos(progress.mul(2 * Math.PI))).mul(
      STRENGTH * 0.5,
    );

    const offset = fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));
    const toCenter = center.sub(uv);

    let sum: Node<"vec3"> = vec3(0);
    let total: Node<"float"> = float(0);
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
    toTexture: TextureNode,
  ) {
    const uv = screenUV;
    const aspect = screenSize.x.div(screenSize.y);
    const noise = mx_fractal_noise_float_2d(
      uv.mul(vec2(aspect, 1)).mul(3.1),
      3,
      2.0,
      0.5,
      1.0,
    )
      .mul(0.5)
      .add(0.5);

    const vertical = oneMinus(uv.y);
    const front = this.uniforms.progress.mul(2.1).sub(0.55);
    const warped = vertical.add(noise.sub(0.5).mul(0.46));
    const wipe = oneMinus(smoothstep(0, TRANSITION_WIDTH, warped.sub(front)));

    const seam = smoothstep(0, 0.12, wipe).mul(
      smoothstep(0, 0.12, oneMinus(wipe)),
    );
    const ripple = smoothstep(0, 0.9, seam);
    const wobble = mix(float(-1), float(1), noise).mul(ripple);

    const distortion = vec2(
      wobble.mul(0.026),
      seam.mul(noise.sub(0.5)).mul(0.052),
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

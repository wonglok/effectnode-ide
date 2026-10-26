/**
 * Page curl, ported from Hewlett-Packard's WebVFX reference (adapted by
 * Sergey Kosarevsky), BSD 3-Clause. The outgoing frame becomes a paper sheet
 * wrapped around a cylinder; it rolls away and shadows the incoming scene.
 */
import type { Node } from "three/webgpu";
import {
  abs,
  acos,
  and,
  clamp,
  cos,
  float,
  max,
  min,
  mod,
  oneMinus,
  or,
  pow,
  screenUV,
  select,
  sin,
  sqrt,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Transition } from "./types.ts";

export const pageCurlTransition: Transition = ({
  fromTexture,
  toTexture,
  progress,
  finish,
}) => {
  const PI = Math.PI;
  const MIN_AMOUNT = -0.16;
  const MAX_AMOUNT = 1.5;
  const CYLINDER_RADIUS = 1 / PI / 2;
  const SCALE = 512;
  const SHARPNESS = 3;
  const ANGLE = (100 * PI) / 180;

  // The reference bakes a 100° page edge into two fixed matrices. GLSL mat3s
  // are column-major, so each product expands to these two rows.
  const ROT_C = Math.cos(-ANGLE);
  const ROT_S = Math.sin(-ANGLE);
  const BACK_C = Math.cos(ANGLE);
  const BACK_S = Math.sin(ANGLE);

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

  return finish(vec4(rgb, 1));
};

/**
 * Cross zoom: both frames dissolve through a zoom blur that punches in and
 * settles while its centre drifts across the screen.
 */
import type { Node } from "three/webgpu";
import {
  cos,
  dot,
  float,
  fract,
  mix,
  oneMinus,
  pow,
  screenUV,
  select,
  sin,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Transition } from "./types.ts";

const STRENGTH = 0.4;
const SAMPLES = 40;

export const crossZoomTransition: Transition = ({
  fromTexture,
  toTexture,
  progress,
  finish,
}) => {
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

  return finish(vec4(sum.div(total), 1));
};

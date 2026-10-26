/**
 * Liquid-glass wipe: a noisy edge travels upward with refraction at the seam,
 * a thin chromatic split, and a light leak tinted by both chapter accents.
 */
import {
  color,
  float,
  max,
  mix,
  mx_fractal_noise_float_2d,
  oneMinus,
  screenSize,
  screenUV,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Transition } from "./types.ts";

const TRANSITION_WIDTH = 0.24;

export const liquidTransition: Transition = ({
  fromTexture,
  toTexture,
  progress,
  accent,
  finish,
}) => {
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
  const front = progress.mul(2.1).sub(0.55);
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
  const tinted = blended.add(color(accent).mul(lightLeak));

  return finish(vec4(tinted, 1));
};

/**
 * Chapter registry. Every section is a single page in the vertical story:
 * one accent, one surface, one line of copy, and one canvas scene.
 */
export type SectionMeta = {
  id: string;
  index: number;
  chapter: string;
  name: string;
  /** Two lines separated by \n. The second line is set in the accent. */
  title: string;
  accent: string;
  surface: string;
  eyebrow: string;
  body: string;
  meta: string;
};

export const SECTIONS: SectionMeta[] = [
  {
    id: 'kinetic',
    index: 0,
    chapter: '01',
    name: 'Kinetic',
    title: 'Motion,\nnot video.',
    accent: '#c5e6ff',
    surface: '#021019',
    eyebrow: 'Kinetic type',
    body:
      'A chorus of glyphs and light that answers the pointer, the scroll, and the room. Every frame is drawn live — there is no footage here.',
    meta: 'Realtime / WebGPU / TSL',
  },
  {
    id: 'flow-shield',
    index: 1,
    chapter: '02',
    name: 'Flow Shield',
    title: 'Force,\nnot field.',
    accent: '#26aeff',
    surface: '#0e0d0c',
    eyebrow: 'Flow field',
    body:
      'Force lines bend around a single silhouette. Scroll to steer the current; the shield is never quite the same twice.',
    meta: 'Flow field / Pointer aware / Zero textures',
  },
  {
    id: 'live-env',
    index: 2,
    chapter: '03',
    name: 'Live Env',
    title: 'Built\nin light.',
    accent: '#c7a6ff',
    surface: '#0b0713',
    eyebrow: 'Live environment',
    body:
      'A city drawn in perspective and light. The vanishing point follows your hand, and the horizon never stops breathing.',
    meta: 'Wireframe / Infinite grid / Light only',
  },
  {
    id: 'alpha6',
    index: 3,
    chapter: '04',
    name: 'Alpha 6',
    title: 'Glass,\nnot pixels.',
    accent: '#4aa8ff',
    surface: '#04101f',
    eyebrow: 'Glass study',
    body:
      'Shards of glass built from gradients and geometry. Move to refract the light; stop to let it settle.',
    meta: 'Shards / Refraction / No textures',
  },
];

export const SECTION_COUNT = SECTIONS.length;

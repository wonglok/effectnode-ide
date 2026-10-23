/**
 * Chapter registry. Every section is one scene in the vertical story: a name,
 * a chapter label, an accent and a background surface.
 */
export type SectionMeta = {
  id: string;
  index: number;
  chapter: string;
  name: string;
  accent: string;
  surface: string;
};

export const SECTIONS: SectionMeta[] = [
  {
    id: 'kinetic',
    index: 0,
    chapter: '01',
    name: 'Kinetic',
    accent: '#c5e6ff',
    surface: '#021019',
  },
  {
    id: 'flow-shield',
    index: 1,
    chapter: '02',
    name: 'Flow Shield',
    accent: '#26aeff',
    surface: '#0e0d0c',
  },
  {
    id: 'live-env',
    index: 2,
    chapter: '03',
    name: 'Live Env',
    accent: '#c7a6ff',
    surface: '#0b0713',
  },
  {
    id: 'alpha6',
    index: 3,
    chapter: '04',
    name: 'Alpha 6',
    accent: '#4aa8ff',
    surface: '#04101f',
  },
];

export const SECTION_COUNT = SECTIONS.length;

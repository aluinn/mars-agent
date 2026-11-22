/** Semantic classes shared by the world (ground truth), the detector and the habitability scorer. */
export const C = {
  None: 0,
  Regolith: 1,
  Basalt: 2,
  Olivine: 3,
  Carbonate: 4,
  LayeredDelta: 5,
  ClayRich: 6,
  SandRipples: 7,
  Boulder: 8,
  Cobble: 9,
  Channel: 10,
  Crater: 11,
  HazardSteep: 12,
  HazardSand: 13,
} as const;

export type ClassId = (typeof C)[keyof typeof C];

export interface ClassInfo {
  id: ClassId;
  name: string;
  /** Typical sRGB albedo used for terrain texture and rocks of this lithology. */
  albedo: [number, number, number];
  hazard: boolean;
}

export const CLASS_INFO: ClassInfo[] = [
  { id: C.None, name: 'none', albedo: [0, 0, 0], hazard: false },
  { id: C.Regolith, name: 'regolith', albedo: [168, 118, 78], hazard: false },
  { id: C.Basalt, name: 'basalt', albedo: [92, 80, 72], hazard: false },
  { id: C.Olivine, name: 'olivine-rich rock', albedo: [150, 140, 92], hazard: false },
  { id: C.Carbonate, name: 'carbonate-bearing rock', albedo: [196, 176, 160], hazard: false },
  { id: C.LayeredDelta, name: 'layered delta sediment', albedo: [190, 150, 110], hazard: false },
  { id: C.ClayRich, name: 'clay-rich outcrop', albedo: [140, 92, 84], hazard: false },
  { id: C.SandRipples, name: 'sand ripples/dunes', albedo: [196, 146, 96], hazard: false },
  { id: C.Boulder, name: 'boulder', albedo: [84, 72, 66], hazard: false },
  { id: C.Cobble, name: 'cobbles', albedo: [96, 82, 72], hazard: false },
  { id: C.Channel, name: 'possible dried channel', albedo: [128, 96, 72], hazard: false },
  { id: C.Crater, name: 'crater', albedo: [140, 104, 76], hazard: false },
  { id: C.HazardSteep, name: 'hazard: steep slope', albedo: [120, 98, 82], hazard: true },
  { id: C.HazardSand, name: 'hazard: loose sand', albedo: [205, 156, 104], hazard: true },
];

export const className = (id: number): string => CLASS_INFO[id]?.name ?? 'unknown';

/**
 * How Stack et al. (2020) BEDROCK map units are turned into detection classes.
 * `real` = the unit name itself says what it is (layered delta sediment).
 * `assumed` = the mineral association is NOT given by the map: it is our approximation and is
 * labelled "approximate, derived from published unit maps". Replace with CRISM-based mineral
 * maps (Horgan et al. 2020) for real per-pixel mineralogy.
 */
export const BEDROCK_CLASS: Record<string, { cls: ClassId; basis: 'real' | 'assumed' }> = {
  'Delta thinly layered': { cls: C.LayeredDelta, basis: 'real' },
  'Delta thickly layered': { cls: C.LayeredDelta, basis: 'real' },
  'Delta truncated curvilinear layered': { cls: C.LayeredDelta, basis: 'real' },
  'Delta layered rough': { cls: C.ClayRich, basis: 'assumed' },
  'Delta blocky': { cls: C.ClayRich, basis: 'assumed' },
  'Crater floor fractured 1': { cls: C.Olivine, basis: 'assumed' },
  'Crater floor fractured 2': { cls: C.Basalt, basis: 'assumed' },
  'Crater floor fractured rough': { cls: C.Basalt, basis: 'assumed' },
  'Margin fractured': { cls: C.Carbonate, basis: 'assumed' },
  'Crater rim blocky': { cls: C.Carbonate, basis: 'assumed' },
  'Crater rim breccia': { cls: C.Carbonate, basis: 'assumed' },
  'Crater rim layered': { cls: C.Carbonate, basis: 'assumed' },
  'Crater rim rough': { cls: C.Carbonate, basis: 'assumed' },
  'Neretva Vallis layered': { cls: C.LayeredDelta, basis: 'real' },
  'Nili Planum fractured': { cls: C.Basalt, basis: 'assumed' },
};

/** SURFACE map units that hide or replace bedrock. */
export const SURFACE_CLASS: Record<string, ClassId | 'bedrock'> = {
  'Aeolian bedforms, large': C.HazardSand,
  'Aeolian bedforms, small': C.SandRipples,
  Talus: C.Regolith,
  'Moderate Cover Us': C.Regolith,
  'Undifferentiated smooth': C.Regolith,
  'Minor Cover Us': 'bedrock',
  None: 'bedrock',
};

/** Relative rock abundance by surface unit (qualitative: talus and blocky ground are rockier, sand is not). */
export const ROCK_DENSITY: Record<string, number> = { Talus: 3, 'Aeolian bedforms, large': 0.25, 'Aeolian bedforms, small': 0.4, 'Undifferentiated smooth': 0.7 };

import { C, type ClassId } from '../world/classes';

/**
 * How each detected class bears on habitability. Weights are in [0, 1] and are OUR assumptions, chosen from the general
 * astrobiology rationale in `why`; they are not measured quantities. The assessment uses ONLY classes the detector reported.
 */
export interface EvidenceRule {
  /** Contribution to each positive component. */
  water?: number;
  energy?: number;
  shelter?: number;
  /** Contribution to negative components. */
  perchlorate?: number;
  /** Detected hazard that makes the ground unstable to work on. */
  unstable?: number;
  label: string;
  why: string;
  /** True when this class only exists in the world through an assumed mineral mapping (see DATA_SOURCES.md). */
  assumedMapping?: boolean;
  speculative?: boolean;
}

export const RULES: Partial<Record<ClassId, EvidenceRule>> = {
  [C.ClayRich]: {
    water: 1,
    energy: 0.3,
    label: 'Clay-rich outcrop',
    why: 'Fe/Mg clays form when rock reacts with liquid water, and they can hold redox-active iron.',
    assumedMapping: true,
  },
  [C.Carbonate]: {
    water: 1,
    label: 'Carbonate-bearing rock',
    why: 'Carbonates precipitate from water and record the chemistry of past fluids.',
    assumedMapping: true,
  },
  [C.LayeredDelta]: {
    water: 0.9,
    label: 'Layered delta sediment',
    why: 'Fine layered sediment of the kind laid down where a river met a lake points to sustained liquid water.',
  },
  [C.Channel]: {
    water: 0.5,
    label: 'Possible dried channel',
    why: 'A linear drainage feature can mark flowing water. Here it is only present-day drainage inferred from the terrain model, so it is weak and speculative.',
    speculative: true,
  },
  [C.Olivine]: {
    energy: 0.7,
    label: 'Olivine-rich rock',
    why: 'Olivine reacting with water releases hydrogen, a possible chemical energy source for microbes.',
    assumedMapping: true,
  },
  [C.Basalt]: {
    energy: 0.35,
    label: 'Basalt',
    why: 'Iron-bearing basalt can drive redox reactions, a weaker energy source than olivine.',
    assumedMapping: true,
  },
  [C.Crater]: {
    shelter: 0.6,
    label: 'Crater',
    why: 'Crater walls and floors can shield from some radiation and UV; the benefit is limited at this scale.',
  },
  [C.Boulder]: { shelter: 0.2, label: 'Boulder', why: 'The lee side of a boulder offers a little shelter from UV.' },
  [C.Cobble]: { shelter: 0.05, label: 'Cobbles', why: 'Cobbles give almost no shelter.' },
  [C.Regolith]: { perchlorate: 0.5, label: 'Loose regolith', why: 'Fine regolith and dust is where perchlorates (toxic to many organisms) have been found elsewhere on Mars.' },
  [C.SandRipples]: { perchlorate: 0.4, unstable: 0.4, label: 'Sand ripples/dunes', why: 'Mobile sand is dry and unstable, and is a perchlorate-bearing fine fraction.' },
  [C.HazardSand]: { perchlorate: 0.5, unstable: 0.6, label: 'Loose sand', why: 'Loose sand is mobile, dry and a traction hazard.' },
  [C.HazardSteep]: { unstable: 1, label: 'Steep slope', why: 'Steep ground is unstable to drive on and to sample.' },
};

/** Classes that count as habitability-relevant findings in the evidence log (positive evidence only). */
export const POSITIVE_CLASSES: ClassId[] = [C.ClayRich, C.Carbonate, C.LayeredDelta, C.Channel, C.Olivine, C.Basalt, C.Crater];

/** Weights of the positive components in the cell score (sum < 1 so a score of 1 is unreachable). */
export const WEIGHTS = { water: 0.55, energy: 0.25, shelter: 0.1 } as const;

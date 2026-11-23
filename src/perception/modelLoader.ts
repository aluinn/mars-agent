import type { DetectorModel } from './detector';

/** Load the trained terrain model. Returns null when it has not been generated yet (the detector then finds rocks only). */
export async function loadDetectorModel(url = '/data/detector_model.json'): Promise<DetectorModel | null> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return (await r.json()) as DetectorModel;
  } catch {
    return null;
  }
}

/** Per-class detector precision measured on held-out frames (docs/perception_eval.json copy), used to discount evidence. */
export async function loadReliability(url = '/data/perception_eval.json'): Promise<Record<number, number>> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return {};
    const j = (await r.json()) as { classes: { cls: number; precision: number | null }[] };
    const out: Record<number, number> = {};
    for (const c of j.classes) if (c.precision !== null) out[c.cls] = c.precision;
    return out;
  } catch {
    return {};
  }
}

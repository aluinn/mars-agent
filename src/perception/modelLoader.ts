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

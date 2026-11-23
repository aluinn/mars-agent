/** Distinct, bright debug colours per class (for the ground-truth view and detection boxes; not the in-world appearance). */
export const CLASS_COLOURS: Record<number, [number, number, number]> = {
  1: [200, 160, 110], 2: [120, 120, 170], 3: [190, 200, 60], 4: [255, 190, 210], 5: [240, 120, 60], 6: [170, 100, 210],
  7: [250, 230, 150], 8: [60, 200, 220], 9: [60, 140, 255], 10: [70, 130, 230], 11: [220, 80, 80], 12: [255, 40, 40], 13: [255, 130, 0],
};
export const classRgb = (c: number): string => {
  const v = CLASS_COLOURS[c] ?? [255, 255, 255];
  return `rgb(${v[0]},${v[1]},${v[2]})`;
};
/** Short labels so boxes stay readable. */
export const SHORT_NAME: Record<number, string> = {
  1: 'regolith', 2: 'basalt', 3: 'olivine', 4: 'carbonate', 5: 'layered delta', 6: 'clay-rich', 7: 'ripples/dunes', 8: 'boulder', 9: 'cobble',
  10: 'channel?', 11: 'crater', 12: 'steep slope', 13: 'loose sand',
};

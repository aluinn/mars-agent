import type { AgentFrame, TruthFrame } from '../perception/types';

export type EyeView = 'rgb' | 'depth' | 'truth';

/** Distinct debug colours per class for the ground-truth view (not the in-world appearance). */
const TRUTH_COLOURS: Record<number, [number, number, number]> = {
  1: [200, 160, 110], 2: [70, 70, 90], 3: [190, 200, 60], 4: [255, 190, 210], 5: [240, 120, 60], 6: [160, 90, 200],
  7: [250, 230, 150], 8: [60, 200, 220], 9: [60, 140, 255], 10: [40, 90, 200], 11: [200, 60, 60], 12: [255, 0, 0], 13: [255, 120, 0],
};

export class EyePanel {
  private ctx: CanvasRenderingContext2D;
  private view: EyeView = 'rgb';
  private agentFrame: AgentFrame | null = null;
  private truth: TruthFrame | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private info: HTMLElement,
    tabs: HTMLElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    tabs.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.view = b.dataset.view as EyeView;
        this.draw();
      }),
    );
  }

  setFrames(a: AgentFrame, t: TruthFrame): void {
    this.agentFrame = a;
    this.truth = t;
    document.getElementById('eyeEmpty')?.setAttribute('hidden', '');
    this.draw();
  }

  private draw(): void {
    const f = this.agentFrame;
    if (!f) return;
    const { width: w, height: h } = f.meta;
    const img = this.ctx.createImageData(w, h);
    if (this.view === 'rgb') img.data.set(f.rgba);
    else if (this.view === 'depth') {
      // Near = bright, log scale to 500 m. Black = no return (sky / out of range).
      for (let i = 0; i < w * h; i++) {
        const d = f.depthM[i]!;
        const v = Number.isFinite(d) ? 255 * (1 - Math.min(1, Math.log(1 + d) / Math.log(501))) : 0;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v * 0.9;
        img.data[i * 4 + 2] = v * 0.8;
        img.data[i * 4 + 3] = 255;
      }
    } else if (this.truth) {
      const cache = new Map<number, [number, number, number]>();
      for (let i = 0; i < w * h; i++) {
        const id = this.truth.ids[i]!;
        let c = cache.get(id);
        if (!c) {
          const o = this.truth.lookup(id);
          c = o ? (TRUTH_COLOURS[o.cls] ?? [255, 255, 255]) : [0, 0, 0];
          cache.set(id, c);
        }
        img.data[i * 4] = c[0];
        img.data[i * 4 + 1] = c[1];
        img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    const m = f.meta;
    const names = this.view === 'truth' ? ' · ground truth (evaluation only)' : '';
    this.info.textContent = `sol ${m.sol} · pan ${m.panDeg.toFixed(0)}° · sun ${m.sunElevationDeg.toFixed(0)}° · τ ${m.tau.toFixed(1)} · ${m.reason}${names}`;
  }
}


import type { Detection, DetectionResult } from '../perception/detector';
import type { FrameScore } from '../perception/scoring';
import type { AgentFrame, TruthFrame } from '../perception/types';
import { CLASS_COLOURS, SHORT_NAME, classRgb } from './palette';

export type EyeView = 'rgb' | 'depth' | 'truth';

export class EyePanel {
  private ctx: CanvasRenderingContext2D;
  private ov: CanvasRenderingContext2D;
  private view: EyeView = 'rgb';
  private showDet = true;
  private compare = false;
  private agentFrame: AgentFrame | null = null;
  private truth: TruthFrame | null = null;
  private res: DetectionResult | null = null;
  private score: FrameScore | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private info: HTMLElement,
    tabs: HTMLElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const overlay = document.getElementById('eyeOverlay') as HTMLCanvasElement;
    this.ov = overlay.getContext('2d')!;
    tabs.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.view = b.dataset.view as EyeView;
        this.draw();
      }),
    );
    const det = document.getElementById('togDet') as HTMLButtonElement;
    const cmp = document.getElementById('togCmp') as HTMLButtonElement;
    det.addEventListener('click', () => {
      this.showDet = !this.showDet;
      det.classList.toggle('on', this.showDet);
      this.draw();
    });
    cmp.addEventListener('click', () => {
      this.compare = !this.compare;
      cmp.classList.toggle('on', this.compare);
      this.draw();
    });
  }

  setFrames(a: AgentFrame, t: TruthFrame, res: DetectionResult | null, score: FrameScore | null): void {
    this.agentFrame = a;
    this.truth = t;
    this.res = res;
    this.score = score;
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
          c = o ? (CLASS_COLOURS[o.cls] ?? [255, 255, 255]) : [0, 0, 0];
          cache.set(id, c);
        }
        img.data[i * 4] = c[0];
        img.data[i * 4 + 1] = c[1];
        img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    this.drawOverlay(w, h);
    const m = f.meta;
    let extra = '';
    if (this.res) {
      if (this.compare && this.score) {
        let tp = 0, fp = 0;
        for (const o of this.score.outcome.values()) { if (o === 'tp') tp++; else if (o === 'fp') fp++; }
        const missed = this.score.truthRegions.filter((r) => !r.hit).length;
        extra = ` · ${tp} correct · ${fp} wrong · ${missed} missed`;
      } else extra = ` · ${this.res.detections.length} detections · ${this.res.ms.toFixed(0)} ms`;
    }
    this.info.textContent = `sol ${m.sol} · pan ${m.panDeg.toFixed(0)}° · sun ${m.sunElevationDeg.toFixed(0)}° · τ ${m.tau.toFixed(1)}${extra}`;
  }

  private drawOverlay(w: number, h: number): void {
    const o = this.ov;
    o.clearRect(0, 0, w, h);
    if (!this.res || !this.showDet) return;
    o.lineWidth = 2;
    o.font = '600 13px ui-monospace, Menlo, monospace';
    o.textBaseline = 'top';
    const label = (d: Detection, colour: string) => {
      const t = `${SHORT_NAME[d.cls] ?? d.name} ${(d.confidence * 100).toFixed(0)}%`;
      const tw = o.measureText(t).width + 8;
      const x = Math.min(d.bbox.x0, w - tw);
      const y = Math.max(0, d.bbox.y0 - 16);
      o.fillStyle = 'rgba(8,10,14,0.82)';
      o.fillRect(x, y, tw, 16);
      o.fillStyle = colour;
      o.fillText(t, x + 4, y + 2);
    };
    // terrain regions first (large, thin), objects on top
    const dets = [...this.res.detections].sort((a, b) => (a.kind === 'terrain' ? 0 : 1) - (b.kind === 'terrain' ? 0 : 1));
    for (const d of dets) {
      const outcome = this.compare ? this.score?.outcome.get(d.id) : undefined;
      const colour = this.compare ? (outcome === 'tp' ? '#4ade80' : outcome === 'fp' ? '#f87171' : '#9aa4b2') : classRgb(d.cls);
      o.strokeStyle = colour;
      o.setLineDash(d.kind === 'terrain' ? [] : []);
      o.globalAlpha = d.kind === 'terrain' ? 0.75 : 1;
      o.strokeRect(d.bbox.x0 + 1, d.bbox.y0 + 1, d.bbox.x1 - d.bbox.x0 - 2, d.bbox.y1 - d.bbox.y0 - 2);
      o.globalAlpha = 1;
      if (d.kind === 'object' || d.areaPx > 6000) label(d, colour);
    }
    if (this.compare && this.score) {
      o.setLineDash([6, 4]);
      o.strokeStyle = '#fbbf24';
      for (const r of this.score.truthRegions) {
        if (r.hit) continue;
        o.strokeRect(r.bbox.x0 + 1, r.bbox.y0 + 1, r.bbox.x1 - r.bbox.x0 - 2, r.bbox.y1 - r.bbox.y0 - 2);
        const t = `missed: ${SHORT_NAME[r.cls] ?? r.cls}`;
        o.fillStyle = 'rgba(8,10,14,0.82)';
        o.fillRect(r.bbox.x0, r.bbox.y1 - 16, o.measureText(t).width + 8, 16);
        o.fillStyle = '#fbbf24';
        o.fillText(t, r.bbox.x0 + 4, r.bbox.y1 - 14);
      }
      o.setLineDash([]);
    }
  }
}

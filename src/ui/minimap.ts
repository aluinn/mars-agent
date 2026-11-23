import type { PathPoint } from '../nav/astar';
import type { KnownMap } from '../agent/knownMap';
import { EXPLORE_CELLS } from '../agent/knownMap';
import type { World } from '../world/world';

/** Top-down map: real orthoimage (or hillshade) as the orbital basemap, with what the rover has explored lit up. */
export class MiniMap {
  private ctx: CanvasRenderingContext2D;
  private bright: HTMLCanvasElement;
  private dim: HTMLCanvasElement;
  private mask = document.createElement('canvas');
  private tmp: HTMLCanvasElement;
  private lastExplored = -1;
  private heatCanvas = document.createElement('canvas');
  private heatKey = '';
  showHeat = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private known: KnownMap,
  ) {
    const W = canvas.width;
    this.ctx = canvas.getContext('2d')!;
    this.bright = this.makeBase(W);
    this.dim = document.createElement('canvas');
    this.dim.width = this.dim.height = W;
    const d = this.dim.getContext('2d')!;
    d.drawImage(this.bright, 0, 0);
    d.fillStyle = 'rgba(6,8,12,0.5)';
    d.fillRect(0, 0, W, W);
    this.mask.width = this.mask.height = EXPLORE_CELLS;
    this.tmp = document.createElement('canvas');
    this.tmp.width = this.tmp.height = W;
  }

  private makeBase(W: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const x = c.getContext('2d')!;
    const img = x.createImageData(W, W);
    const { hm, ortho } = this.world;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const hx = Math.floor((i / W) * (hm.size - 1));
        const hz = Math.floor((j / W) * (hm.size - 1));
        const dx = (hm.data[hz * hm.size + Math.min(hm.size - 1, hx + 2)]! - hm.data[hz * hm.size + Math.max(0, hx - 2)]!) / (4 * hm.cell);
        const dz = (hm.data[Math.min(hm.size - 1, hz + 2) * hm.size + hx]! - hm.data[Math.max(0, hz - 2) * hm.size + hx]!) / (4 * hm.cell);
        let v = 0.55 + (dx * 0.6 - dz * 0.6) * 0.9; // light from the north-west
        if (ortho) {
          const o = ortho.data[Math.floor((j / W) * ortho.size) * ortho.size + Math.floor((i / W) * ortho.size)]! / 255;
          v = 0.25 + o * 0.9 + (v - 0.55) * 0.35;
        }
        v = Math.min(1, Math.max(0, v));
        const k = (j * W + i) * 4;
        img.data[k] = 230 * v + 16;
        img.data[k + 1] = 178 * v + 12;
        img.data[k + 2] = 130 * v + 8;
        img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  /** Draw the habitability heatmap: one coloured cell per map cell with evidence (alpha rises with the score). */
  private drawHeat(ctx: CanvasRenderingContext2D, W: number, heat: Float32Array, n: number, key: string): void {
    if (key !== this.heatKey) {
      this.heatKey = key;
      this.heatCanvas.width = this.heatCanvas.height = n;
      const x = this.heatCanvas.getContext('2d')!;
      const id = x.createImageData(n, n);
      const ramp = [[42, 27, 77], [138, 47, 122], [232, 96, 60], [255, 217, 61]];
      for (let k = 0; k < heat.length; k++) {
        const v = heat[k]!;
        if (v < 0) continue;
        const t = Math.min(1, v / 0.15) * 3;
        const i = Math.min(2, Math.floor(t)), f = t - i;
        for (let c = 0; c < 3; c++) id.data[k * 4 + c] = ramp[i]![c]! * (1 - f) + ramp[i + 1]![c]! * f;
        id.data[k * 4 + 3] = 90 + 130 * Math.min(1, v / 0.15);
      }
      x.putImageData(id, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.heatCanvas, 0, 0, W, W);
  }

  draw(rover: { x: number; z: number; heading: number }, path: PathPoint[], goal: PathPoint | null, heat?: { cells: Float32Array; n: number; key: string }): void {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const half = this.world.hm.sizeMetres / 2;
    const px = (x: number) => ((x + half) / (half * 2)) * W;
    const e = this.known.exploredFraction();
    if (e !== this.lastExplored) {
      this.lastExplored = e;
      const m = this.mask.getContext('2d')!;
      const id = m.createImageData(EXPLORE_CELLS, EXPLORE_CELLS);
      for (let k = 0; k < this.known.explored.length; k++) {
        id.data[k * 4 + 3] = this.known.explored[k]! ? 255 : 0;
      }
      m.putImageData(id, 0, 0);
    }
    ctx.drawImage(this.dim, 0, 0);
    const t = this.tmp.getContext('2d')!;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, W, W);
    t.drawImage(this.bright, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.imageSmoothingEnabled = true;
    t.drawImage(this.mask, 0, 0, W, W);
    ctx.drawImage(this.tmp, 0, 0);
    if (this.showHeat && heat) this.drawHeat(ctx, W, heat.cells, heat.n, heat.key);

    if (path.length > 0) {
      ctx.strokeStyle = '#5cc8ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(px(rover.x), px(rover.z));
      for (const p of path) ctx.lineTo(px(p.x), px(p.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (goal) {
      ctx.strokeStyle = '#5cc8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px(goal.x), px(goal.z), 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // rover marker: triangle pointing along the heading (x = east, z = south = canvas down)
    ctx.save();
    ctx.translate(px(rover.x), px(rover.z));
    ctx.rotate(Math.PI - rover.heading);
    ctx.fillStyle = '#ff8a3d';
    ctx.strokeStyle = '#0b0e12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    // scale bar (500 m) and north arrow
    const bar = (500 / (half * 2)) * W;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(14, W - 18, bar, 3);
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.fillText('500 m', 14, W - 24);
    ctx.fillText('N ↑', W - 36, 20);
  }
}

import { CLASS_INFO } from '../world/classes';
import type { Metrics } from '../perception/scoring';
import { SHORT_NAME, classRgb } from './palette';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);

/** Per-class precision/recall table plus a confidence-vs-accuracy strip, fed by the evaluator. */
export class PerceptionPanel {
  private body = $('percRows');
  private foot = $('percFoot');
  private strip = $('percStrip');
  private last = 0;

  constructor(
    private m: Metrics,
    modelLoaded: boolean,
  ) {
    const btn = $('percBtn');
    const card = $('percCard');
    btn.addEventListener('click', () => {
      const on = card.hasAttribute('hidden');
      card.toggleAttribute('hidden', !on);
      btn.classList.toggle('on', on);
    });
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.key === 'p' || e.key === 'P')) btn.click();
    });
    if (!modelLoaded) $('percNote').textContent = 'No trained terrain model found: only rocks are detected. Run the training script.';
    this.render();
  }

  update(): void {
    const now = performance.now();
    if (now - this.last < 500) return;
    this.last = now;
    this.render();
  }

  private render(): void {
    const { m } = this;
    const rows: string[] = [];
    for (const info of CLASS_INFO) {
      const t = m.perClass.get(info.id);
      if (!t || info.id === 0) continue;
      rows.push(
        `<div class="pr"><span class="nm"><i style="background:${classRgb(info.id)}"></i>${SHORT_NAME[info.id] ?? info.name}</span>` +
          `<span class="v">${pct(m.precision(info.id))}</span><span class="v">${pct(m.recall(info.id))}</span>` +
          `<span class="d">${t.tp}/${t.tp + t.fp}</span><span class="d">${t.hit}/${t.total}</span></div>`,
      );
    }
    this.body.innerHTML = rows.length ? rows.join('') : '<div class="dim small" style="grid-column:1/-1;padding:8px 0">No images scored yet. Capture a frame or let the rover run.</div>';
    this.foot.textContent = `${m.frames} frames · ${m.detections} detections · ${m.meanMs.toFixed(0)} ms/frame detector`;
    this.strip.innerHTML = m.bins
      .map((b, i) => {
        const acc = b.n >= 3 ? b.tp / b.n : null;
        return `<div class="bn" title="confidence ${i * 10}–${i * 10 + 10}%: ${acc === null ? 'too few' : (acc * 100).toFixed(0) + '% correct'} (n=${b.n})"><i style="height:${acc === null ? 0 : Math.round(acc * 100)}%"></i></div>`;
      })
      .join('');
  }
}

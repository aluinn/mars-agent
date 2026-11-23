import type { HabitabilityMap, VerdictLevel } from '../habitability/model';
import { formatLocalTime } from '../sim/environment';
import { SHORT_NAME } from './palette';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const LEVEL_COLOUR: Record<VerdictLevel, string> = { none: '#8b97a7', insufficient: '#8b97a7', weak: '#fbbf24', moderate: '#ff8a3d', strong: '#4ade80' };

/** Verdict, per-finding reasoning, negative factors and the evidence log. Re-renders only when new evidence arrives. */
export class HabitabilityPanel {
  private last = -1;
  private lastT = 0;
  constructor(
    private hab: HabitabilityMap,
    private getEnv: () => { tau: number; hours: number },
  ) {
    const btn = $('habBtn');
    const card = $('habCard');
    btn.addEventListener('click', () => {
      const on = card.hasAttribute('hidden');
      card.toggleAttribute('hidden', !on);
      btn.classList.toggle('on', on);
      this.last = -1;
    });
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.key === 'h' || e.key === 'H')) btn.click();
    });
    this.render();
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastT < 800) return;
    this.lastT = now;
    if (this.hab.version !== this.last) this.render();
  }

  private render(): void {
    this.last = this.hab.version;
    const { tau, hours } = this.getEnv();
    const v = this.hab.verdict(tau, hours);
    const head = $('habHead');
    head.textContent = v.headline;
    head.style.color = LEVEL_COLOUR[v.level];
    $('habScore').textContent = `${(v.score * 100).toFixed(0)}`;
    $('habSummary').textContent = v.summary;
    $('habCaveat').textContent = v.caveat;
    $('habNeg').innerHTML = v.negatives.map((n) => `<div class="neg" title="${esc(n.note)}"><span>${esc(n.name)}</span><b>${esc(n.value)}</b></div>`).join('');
    $('habFindings').innerHTML =
      v.findings
        .filter((f) => f.strength > 0.002 || f.sightings > 1)
        .slice(0, 5)
        .map(
          (f) =>
            `<div class="find"><div class="fh"><b>${esc(f.label)}</b>${f.kind === 'negative' ? ' <span class="against">counts against</span>' : ''}<span class="dim small">${f.sightings.toFixed(1)} sightings · mean ${(f.meanConfidence * 100).toFixed(0)}%${f.precision !== null ? ` · detector precision ${(f.precision * 100).toFixed(0)}%` : ''}</span></div>` +
            `<div class="dim small">${esc(f.why)}${f.assumedMapping ? ' <em>(mineral mapping assumed)</em>' : ''}${f.speculative ? ' <em>(speculative)</em>' : ''}</div></div>`,
        )
        .join('') || '<div class="dim small">No findings yet.</div>';
    $('habLog').innerHTML =
      this.hab.log
        .slice(-7)
        .reverse()
        .map((l) => `<li><span class="dim">sol ${l.sol} · ${formatLocalTime(((l.t / 88775.244) % 1) * 24)}</span> <b>${esc(SHORT_NAME[l.cls] ?? l.label)}</b> ${(l.confidence * 100).toFixed(0)}% <span class="dim">near (${l.at.x.toFixed(0)}, ${l.at.z.toFixed(0)})</span></li>`)
        .join('') || '<li class="dim">Nothing logged yet.</li>';
  }
}

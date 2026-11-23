import type { EarthImagePayload } from '../earth/submit';
import type { LinkItem } from '../earth/link';
import { SOL_SECONDS } from '../sim/constants';
import { formatLocalTime, sunAt } from '../sim/environment';
import type { Simulation } from '../sim/simulation';
import { SHORT_NAME, classRgb } from './palette';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const mins = (s: number) => (s >= 90 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(0)} s`);
const kb = (bits: number) => `${(bits / 8192).toFixed(1)} KB`;

/** Mission Control: what Earth has received, what is waiting to be sent, the link state, and a timeline of the sol. */
export class EarthPanel {
  private bitmaps = new Map<number, ImageBitmap>();
  private selected: number | null = null;
  private seenReceived = 0;
  private lastT = 0;
  private lastCount = -1;

  constructor(private sim: Simulation) {
    const btn = $('earthBtn');
    const card = $('earthCard');
    btn.addEventListener('click', () => {
      const on = card.hasAttribute('hidden');
      card.toggleAttribute('hidden', !on);
      btn.classList.toggle('on', on);
      if (on) {
        this.seenReceived = sim.earth.received.length;
        this.lastCount = -1;
      }
      this.badge();
    });
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.key === 'e' || e.key === 'E')) btn.click();
    });
    const slider = $<HTMLInputElement>('ltSlider');
    const setComp = () => {
      sim.earth.compression = Math.round(Math.pow(10, Number(slider.value)));
      $('ltVal').textContent = `${sim.earth.compression}×`;
    };
    slider.addEventListener('input', setComp);
    setComp();
    sim.earth.onReceive = (it) => {
      void this.prepare(it);
      this.badge();
    };
  }

  private async prepare(it: LinkItem): Promise<void> {
    if (it.kind !== 'image') return;
    const p = it.payload as EarthImagePayload;
    try {
      this.bitmaps.set(it.id, await createImageBitmap(p.blob));
    } catch {
      /* no bitmap: the thumbnail stays blank */
    }
    this.lastCount = -1; // force a redraw
    if (this.selected === null) this.selected = it.id;
  }

  private badge(): void {
    const n = this.sim.earth.received.length - this.seenReceived;
    const b = $('earthBadge');
    const open = !$('earthCard').hasAttribute('hidden');
    b.textContent = n > 0 && !open ? String(n) : '';
    b.toggleAttribute('hidden', !(n > 0 && !open));
  }

  update(): void {
    const now = performance.now();
    if (now - this.lastT < 400) return;
    this.lastT = now;
    this.badge();
    if ($('earthCard').hasAttribute('hidden')) return;
    this.stats();
    this.queue();
    this.timeline();
    const n = this.sim.earth.received.length;
    if (n !== this.lastCount) {
      this.lastCount = n;
      this.feed();
      this.detail();
      this.notes();
    }
  }

  private stats(): void {
    const { earth, clock } = this.sim;
    const t = clock.t;
    const lt = earth.lightTimeNow(t);
    const open = earth.passOpen(t, clock.startLocalHours);
    const next = earth.secondsToNextPass(t, clock.startLocalHours);
    const chips: [string, string][] = [
      ['Light time', earth.compression > 1 ? `${mins(lt)} → ${mins(lt / earth.compression)}` : mins(lt)],
      ['Relay pass', open ? (earth.transmitting ? 'OPEN · sending' : 'OPEN') : `in ${mins(next)}`],
      ['Rate', `${(earth.cfg.rateBps / 1000).toFixed(1)} kb/s`],
      ['Queued', `${earth.queue.length} · ${(earth.queuedBits / 8e6).toFixed(2)} MB`],
      ['In flight', String(earth.inflight.length)],
      ['At Earth', `${earth.received.length} (${earth.dropped.length} dropped)`],
    ];
    $('earthStats').innerHTML = chips.map(([k, v]) => `<div class="es"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    $('earthClock').textContent = `rover clock → Earth sees it ${mins(lt / earth.compression)} later`;
  }

  private queue(): void {
    const { earth, clock } = this.sim;
    const rows = [...earth.queue]
      .sort((a, b) => earth.priority(b, clock.t) - earth.priority(a, clock.t))
      .slice(0, 6)
      .map((q) => {
        const p = earth.priority(q, clock.t);
        const pct = Math.min(100, (p / 1.5) * 100);
        const sending = q.status === 'sending' ? ` · ${((q.bitsSent / q.sizeBits) * 100).toFixed(0)}%` : '';
        return `<div class="qr"><span class="k ${q.kind}${q.severity ? ' ' + q.severity : ''}">${q.kind === 'note' ? q.severity : 'img'}</span><span class="qt">${esc(q.title)}</span><span class="qb"><i style="width:${pct.toFixed(0)}%"></i></span><span class="qs">${kb(q.sizeBits)}${sending}</span></div>`;
      });
    $('earthQueue').innerHTML = rows.join('') || '<div class="dim small">Queue empty.</div>';
  }

  private feed(): void {
    const items = this.sim.earth.received.filter((i) => i.kind === 'image').slice(-18).reverse();
    const root = $('earthFeed');
    root.replaceChildren();
    for (const it of items) {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 120;
      c.className = 'thumb' + (this.selected === it.id ? ' sel' : '');
      this.draw(c, it, false);
      c.addEventListener('click', () => {
        this.selected = it.id;
        this.lastCount = -1;
        this.update();
      });
      root.appendChild(c);
    }
    if (!items.length) root.innerHTML = '<div class="dim small empty">Nothing has reached Earth yet. Images are sent during the relay passes, highest science value first, then travel one light-time.</div>';
  }

  private draw(c: HTMLCanvasElement, it: LinkItem, labels: boolean): void {
    const ctx = c.getContext('2d')!;
    const p = it.payload as EarthImagePayload;
    const bm = this.bitmaps.get(it.id);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, c.width, c.height);
    if (bm) ctx.drawImage(bm, 0, 0, c.width, c.height);
    const sx = c.width / p.meta.width, sy = c.height / p.meta.height;
    ctx.lineWidth = labels ? 2 : 1;
    ctx.font = '600 12px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (const d of p.detections) {
      if (d.kind === 'terrain' && !labels) continue; // thumbnails: objects only, to stay readable
      ctx.strokeStyle = classRgb(d.cls);
      ctx.globalAlpha = d.kind === 'terrain' ? 0.7 : 1;
      ctx.strokeRect(d.bbox.x0 * sx + 0.5, d.bbox.y0 * sy + 0.5, (d.bbox.x1 - d.bbox.x0) * sx, (d.bbox.y1 - d.bbox.y0) * sy);
      ctx.globalAlpha = 1;
      if (labels && (d.kind === 'object' || d.confidence >= 0.25)) {
        const t = `${SHORT_NAME[d.cls] ?? d.name} ${(d.confidence * 100).toFixed(0)}%`;
        ctx.fillStyle = 'rgba(8,10,14,.85)';
        ctx.fillRect(d.bbox.x0 * sx, Math.max(0, d.bbox.y0 * sy - 15), ctx.measureText(t).width + 8, 15);
        ctx.fillStyle = classRgb(d.cls);
        ctx.fillText(t, d.bbox.x0 * sx + 4, Math.max(0, d.bbox.y0 * sy - 14));
      }
    }
    if (!labels) {
      ctx.fillStyle = 'rgba(8,10,14,.75)';
      ctx.fillRect(0, c.height - 15, c.width, 15);
      ctx.fillStyle = '#c9d2dd';
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.fillText(`sol ${p.meta.sol} ${formatLocalTime(p.meta.localHours)} · ${p.detections.length} det`, 5, c.height - 13);
    }
  }

  private detail(): void {
    const it = this.sim.earth.received.find((r) => r.id === this.selected);
    const canvas = $('earthDetail') as HTMLCanvasElement;
    const info = $('earthDetailInfo');
    if (!it) {
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      info.textContent = 'Select an image to see the rover’s annotations.';
      return;
    }
    const p = it.payload as EarthImagePayload;
    this.draw(canvas, it, true);
    const top = [...p.detections].sort((a, b) => b.confidence - a.confidence).slice(0, 4).map((d) => `${SHORT_NAME[d.cls] ?? d.name} ${(d.confidence * 100).toFixed(0)}%`);
    info.innerHTML = `<b>${esc(it.title)}</b><br><span class="dim">${kb(it.sizeBits)} · science value ${(it.value * 100).toFixed(0)}% · sent after ${mins(((it.sentT ?? 0) - it.createdT))} in queue · light time ${mins(it.delayS ?? 0)} · ${esc(p.meta.reason)}</span><br><span class="dim">Rover’s detections: ${top.length ? esc(top.join(', ')) : 'none above threshold'}</span>`;
  }

  private notes(): void {
    const items = this.sim.earth.received.filter((i) => i.kind === 'note').slice(-6).reverse();
    $('earthNotes').innerHTML =
      items
        .map((n) => {
          const t = n.payload as { text: string; severity: string };
          return `<li><span class="k note ${t.severity}">${t.severity}</span> <span>${esc(t.text)}</span> <span class="dim small">sol ${n.createdSol}</span></li>`;
        })
        .join('') || '<li class="dim small">No notes received yet.</li>';
  }

  /** Current sol on a 24 h axis: daylight, relay passes, and what was queued / sent / received when. */
  private timeline(): void {
    const c = $('timelineCanvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const { clock, earth } = this.sim;
    const sol = clock.sol;
    const total = (t: number) => (clock.startLocalHours / 24) * SOL_SECONDS + t;
    const solStartT = (sol - 1) * SOL_SECONDS - (clock.startLocalHours / 24) * SOL_SECONDS;
    const x = (hours: number) => 10 + (hours / 24) * (W - 20);
    ctx.clearRect(0, 0, W, H);
    // daylight
    for (let i = 0; i < 96; i++) {
      const h = i / 4;
      const el = sunAt(h).elevation;
      ctx.fillStyle = el > 0 ? `rgba(255,200,120,${0.1 + 0.25 * Math.sin(el)})` : 'rgba(40,60,100,.25)';
      ctx.fillRect(x(h), 14, x(h + 0.25) - x(h) + 1, 30);
    }
    // relay passes
    const passH = (earth.cfg.passSeconds / SOL_SECONDS) * 24;
    ctx.fillStyle = 'rgba(92,200,255,.9)';
    for (const s of earth.cfg.passStartHours) ctx.fillRect(x(s), 8, Math.max(3, x(s + passH) - x(s)), 6);
    // events
    const hoursOf = (t: number) => ((total(t) % SOL_SECONDS) / SOL_SECONDS) * 24;
    const inSol = (t: number) => t >= solStartT && t < solStartT + SOL_SECONDS;
    for (const e of earth.events) {
      if (!inSol(e.t)) continue;
      const hx = x(hoursOf(e.t));
      if (e.type === 'queued') { ctx.fillStyle = 'rgba(200,210,225,.55)'; ctx.fillRect(hx, 46, 1.5, 8); }
      else if (e.type === 'sent') { ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(hx, 62, 3, 0, 6.3); ctx.fill(); }
      else if (e.type === 'received') { ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(hx, 76, 3, 0, 6.3); ctx.fill(); }
    }
    // now cursor
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    const nx = x(clock.localHours);
    ctx.beginPath(); ctx.moveTo(nx, 4); ctx.lineTo(nx, H - 14); ctx.stroke();
    // axis
    ctx.fillStyle = '#8b97a7';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (let h = 0; h <= 24; h += 4) ctx.fillText(String(h).padStart(2, '0'), x(h) - 6, H - 3);
    ctx.fillText('queued', 12, 53); ctx.fillText('sent', 12, 66); ctx.fillText('at Earth', 12, 80);
    $('timelineTitle').textContent = `Sol ${sol} timeline (local solar time)`;
  }
}

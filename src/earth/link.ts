import { SOL_SECONDS } from '../sim/constants';
import { lightTimeSeconds } from './lightTime';

export type ItemKind = 'image' | 'note';
export type Severity = 'safety' | 'science' | 'info';
export type ItemStatus = 'queued' | 'sending' | 'inflight' | 'received' | 'dropped';

export interface LinkItem<P = unknown> {
  id: number;
  kind: ItemKind;
  /** Short label for lists. */
  title: string;
  createdT: number;
  createdSol: number;
  sizeBits: number;
  /** 0-1 science (images) or urgency (notes); higher is sent first. */
  value: number;
  severity?: Severity;
  payload: P;
  status: ItemStatus;
  bitsSent: number;
  /** Sim time the last bit left the rover, and when it reaches Earth. */
  sentT?: number;
  arriveT?: number;
  /** One-way delay applied (seconds, after any speed-up). */
  delayS?: number;
}

export interface LinkConfig {
  /** Relay passes: local solar time (Mars hours) each begins, and how long each lasts. */
  passStartHours: number[];
  passSeconds: number;
  /** Effective data rate during a pass, bits per second. ASSUMED and deliberately small (our measured JPEGs are only ~17 KB) so a pass carries about ten images and the queue has to ration. */
  rateBps: number;
  /** Items beyond this many queued are dropped, lowest priority first. */
  maxQueued: number;
  /** Priority gain per sol spent waiting, so old items are not starved forever. */
  agingPerSol: number;
}

export const DEFAULT_LINK: LinkConfig = { passStartHours: [4, 16], passSeconds: 540, rateBps: 2500, maxQueued: 60, agingPerSol: 0.04 };

export interface LinkEvent {
  t: number;
  type: 'queued' | 'dropped' | 'sent' | 'received' | 'pass-start' | 'pass-end';
  itemId?: number;
  text: string;
}

/**
 * Limited-bandwidth downlink with a priority queue and a light-time delay. Pure simulation: no DOM, no GPU.
 * Rover side: items queue, and during a relay pass the highest-priority item is transmitted at `rateBps`.
 * Earth side: a transmitted item arrives one light-time later (divided by `compression`, a demo speed-up).
 */
export class EarthLink {
  readonly queue: LinkItem[] = [];
  readonly inflight: LinkItem[] = [];
  readonly received: LinkItem[] = [];
  readonly dropped: LinkItem[] = [];
  readonly events: LinkEvent[] = [];
  /** Demo speed-up for the delay: 1 = real light time, 60 = one minute becomes one second. */
  compression = 1;
  bitsSentTotal = 0;
  private nextId = 1;
  private current: LinkItem | null = null;
  private wasOpen = false;
  /** Called when an item reaches Earth (the UI uses it for badges). */
  onReceive: ((it: LinkItem) => void) | null = null;
  /** Called when the last bit of an item leaves the rover (used to update novelty). */
  onSent: ((it: LinkItem) => void) | null = null;

  constructor(
    readonly cfg: LinkConfig = DEFAULT_LINK,
    private lightTime: (t: number) => number = lightTimeSeconds,
  ) {}

  /** Real one-way light time now, seconds. */
  lightTimeNow(t: number): number {
    return this.lightTime(t);
  }
  /** Delay actually applied now (after the speed-up). */
  delayNow(t: number): number {
    return this.lightTime(t) / this.compression;
  }

  private solOf = (t: number, startHours = 8): number => Math.floor(((startHours / 24) * SOL_SECONDS + t) / SOL_SECONDS) + 1;

  private push(e: LinkEvent): void {
    this.events.push(e);
    if (this.events.length > 600) this.events.splice(0, 200);
  }

  /** Is a relay pass open at sim time `t`? `startHours` = local solar hours at mission start. */
  passOpen(t: number, startHours = 8): boolean {
    const local = ((((startHours / 24) * SOL_SECONDS + t) % SOL_SECONDS) / SOL_SECONDS) * 24; // Mars hours 0-24
    const passHours = (this.cfg.passSeconds / SOL_SECONDS) * 24;
    return this.cfg.passStartHours.some((s) => local >= s && local < s + passHours);
  }

  /** Seconds until the next pass opens (0 if open now). */
  secondsToNextPass(t: number, startHours = 8): number {
    if (this.passOpen(t, startHours)) return 0;
    const solStart = (startHours / 24) * SOL_SECONDS + t;
    const local = (solStart % SOL_SECONDS) / SOL_SECONDS * 24;
    let best = Infinity;
    for (const s of this.cfg.passStartHours) {
      const dh = s > local ? s - local : s + 24 - local;
      best = Math.min(best, (dh / 24) * SOL_SECONDS);
    }
    return best;
  }

  priority(it: LinkItem, t: number): number {
    const waitedSols = Math.max(0, (t - it.createdT) / SOL_SECONDS);
    const base = it.kind === 'note' ? (it.severity === 'safety' ? 1.5 : it.severity === 'science' ? 0.7 : 0.25) : it.value;
    return base + this.cfg.agingPerSol * waitedSols;
  }

  enqueue(it: Omit<LinkItem, 'id' | 'status' | 'bitsSent' | 'createdSol'>, t: number): LinkItem {
    const item: LinkItem = { ...it, id: this.nextId++, status: 'queued', bitsSent: 0, createdSol: this.solOf(t) };
    this.queue.push(item);
    this.push({ t, type: 'queued', itemId: item.id, text: `queued ${item.title}` });
    while (this.queue.filter((q) => q !== this.current).length > this.cfg.maxQueued) {
      let worst: LinkItem | null = null;
      for (const q of this.queue) if (q !== this.current && (!worst || this.priority(q, t) < this.priority(worst, t))) worst = q;
      if (!worst) break;
      this.queue.splice(this.queue.indexOf(worst), 1);
      worst.status = 'dropped';
      this.dropped.push(worst);
      if (this.dropped.length > 100) this.dropped.shift();
      this.push({ t, type: 'dropped', itemId: worst.id, text: `dropped ${worst.title} (queue full)` });
    }
    return item;
  }

  /** Advance the link by `dt` seconds ending at sim time `t`. */
  step(t: number, dt: number, startHours = 8): void {
    const open = this.passOpen(t, startHours);
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      this.push({ t, type: open ? 'pass-start' : 'pass-end', text: open ? 'relay pass began' : 'relay pass ended' });
    }
    if (open) {
      let budget = this.cfg.rateBps * dt;
      while (budget > 0) {
        if (!this.current) {
          let best: LinkItem | null = null;
          for (const q of this.queue) if (!best || this.priority(q, t) > this.priority(best, t)) best = q;
          if (!best) break;
          this.current = best;
          best.status = 'sending';
        }
        const it = this.current;
        const need = it.sizeBits - it.bitsSent;
        const use = Math.min(need, budget);
        it.bitsSent += use;
        this.bitsSentTotal += use;
        budget -= use;
        if (it.bitsSent >= it.sizeBits - 1e-9) {
          this.queue.splice(this.queue.indexOf(it), 1);
          it.status = 'inflight';
          it.sentT = t;
          it.delayS = this.delayNow(t);
          it.arriveT = t + it.delayS;
          this.inflight.push(it);
          this.push({ t, type: 'sent', itemId: it.id, text: `sent ${it.title}` });
          this.current = null;
          this.onSent?.(it);
        }
      }
    }
    // deliveries
    for (let i = this.inflight.length - 1; i >= 0; i--) {
      const it = this.inflight[i]!;
      if (it.arriveT! <= t) {
        this.inflight.splice(i, 1);
        it.status = 'received';
        this.received.push(it);
        if (this.received.length > 200) this.received.shift();
        this.push({ t: it.arriveT!, type: 'received', itemId: it.id, text: `Earth received ${it.title}` });
        this.onReceive?.(it);
      }
    }
  }

  get transmitting(): boolean {
    return this.current !== null && this.wasOpen;
  }
  get queuedBits(): number {
    return this.queue.reduce((s, q) => s + (q.sizeBits - q.bitsSent), 0);
  }
}

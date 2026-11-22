import { SOL_SECONDS } from './constants';

/** Mission clock in real Mars seconds. Sol 1 starts at local midnight. */
export class SimClock {
  /** Seconds since mission start. */
  t = 0;
  constructor(readonly startLocalHours = 8) {}

  private get total(): number {
    return (this.startLocalHours / 24) * SOL_SECONDS + this.t;
  }
  get sol(): number {
    return Math.floor(this.total / SOL_SECONDS) + 1;
  }
  /** Local mean solar time in Mars hours, 0-24. */
  get localHours(): number {
    return ((this.total % SOL_SECONDS) / SOL_SECONDS) * 24;
  }
  /** Jump to a local time within the current sol. */
  setLocalHours(h: number): void {
    const solStart = Math.floor(this.total / SOL_SECONDS) * SOL_SECONDS;
    this.t = solStart + (h / 24) * SOL_SECONDS - (this.startLocalHours / 24) * SOL_SECONDS;
  }
}

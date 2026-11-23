import type { Simulation } from '../sim/simulation';
import { formatLocalTime } from '../sim/environment';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Status card + activity feed. Built once in the HTML; update() only touches text and styles. */
export class Hud {
  private el = {
    pill: $('modePill'),
    pct: $('battPct'),
    wh: $('battWh'),
    bar: $('battBar'),
    solar: $('stSolar'),
    load: $('stLoad'),
    speed: $('stSpeed'),
    odo: $('stOdo'),
    expl: $('stExpl'),
    replan: $('stReplan'),
    planner: $('plannerName'),
    log: $('logList'),
    logCount: $('logCount'),
    sol: $('solChip'),
    lmst: $('lmstChip'),
    sun: $('sunChip'),
    tau: $('tauChip'),
  };
  private logLen = -1;

  constructor(private sim: Simulation) {
    this.el.planner.textContent = `planner · ${sim.agent.plannerName}`;
  }

  update(sunDeg: number): void {
    const { sim, el } = this;
    const a = sim.agent;
    const soc = sim.battery.soc;
    el.pill.textContent = a.mode.toUpperCase();
    el.pill.dataset.mode = a.mode;
    el.pct.textContent = `${(soc * 100).toFixed(0)}%`;
    el.wh.textContent = `${sim.battery.wh.toFixed(0)} / ${sim.battery.params.batteryCapacityWh} Wh`;
    el.bar.style.width = `${(soc * 100).toFixed(1)}%`;
    el.bar.style.background = soc > 0.5 ? 'var(--ok)' : soc > 0.28 ? 'var(--warn)' : 'var(--bad)';
    el.solar.textContent = `${a.powerW.generated.toFixed(0)} W`;
    el.load.textContent = `${a.powerW.consumed.toFixed(0)} W`;
    el.speed.textContent = `${sim.rover.speed.toFixed(2)} m/s`;
    el.odo.textContent = `${sim.rover.odometerM.toFixed(0)} m`;
    el.expl.textContent = `${(a.known.exploredFraction() * 100).toFixed(1)}%`;
    el.replan.textContent = String(a.replans);
    el.sol.textContent = `Sol ${sim.clock.sol}`;
    el.lmst.textContent = formatLocalTime(sim.clock.localHours);
    el.sun.textContent = `sun ${sunDeg.toFixed(0)}°`;
    el.tau.textContent = `τ ${sim.tau.toFixed(2)}`;
    if (a.log.length !== this.logLen) {
      this.logLen = a.log.length;
      el.logCount.textContent = `${a.log.length} events`;
      el.log.replaceChildren(
        ...a.log
          .slice(-5)
          .reverse()
          .map((l) => {
            const li = document.createElement('li');
            const chip = document.createElement('span');
            chip.className = 'chip2';
            chip.dataset.s = l.stage;
            chip.textContent = l.stage;
            const msg = document.createElement('span');
            msg.className = 'msg';
            msg.textContent = l.text;
            const t = document.createElement('span');
            t.className = 't';
            t.textContent = `sol ${l.sol} · ${formatLocalTime(l.localHours)}`;
            li.append(chip, msg, t);
            return li;
          }),
      );
    }
  }
}

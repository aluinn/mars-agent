import type { Simulation } from '../sim/simulation';
import { formatLocalTime } from '../sim/environment';

/** Text readout of the rover's state. Updated a few times a second, not every frame. */
export class Hud {
  constructor(
    private el: HTMLElement,
    private sim: Simulation,
  ) {}

  update(sunDeg: number): void {
    const { sim } = this;
    const a = sim.agent;
    const soc = sim.battery.soc;
    const logs = a.log
      .slice(-7)
      .reverse()
      .map((l) => `<div>sol ${l.sol} ${formatLocalTime(l.localHours)} [${l.stage}] ${escapeHtml(l.text)}</div>`)
      .join('');
    this.el.innerHTML = `
      <h3>ROVER STATUS · planner ${escapeHtml(a.plannerName)}</h3>
      <div class="row"><span>Sol ${sim.clock.sol} · ${formatLocalTime(sim.clock.localHours)} LMST</span><span class="mode">${a.mode.toUpperCase()}</span></div>
      <div class="row"><span>Battery ${sim.battery.wh.toFixed(0)} Wh (${(soc * 100).toFixed(0)}%)</span><span>sun ${sunDeg.toFixed(1)}°</span></div>
      <div class="bar"><i style="width:${(soc * 100).toFixed(1)}%"></i></div>
      <div class="row"><span>Solar ${a.powerW.generated.toFixed(0)} W</span><span>Load ${a.powerW.consumed.toFixed(0)} W</span></div>
      <div class="row"><span>Odometer ${sim.rover.odometerM.toFixed(0)} m</span><span>Speed ${sim.rover.speed.toFixed(3)} m/s</span></div>
      <div class="row"><span>Explored ${(a.known.exploredFraction() * 100).toFixed(1)}%</span><span>Replans ${a.replans}</span></div>
      <div class="log">${logs}</div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

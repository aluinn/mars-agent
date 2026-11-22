import type { Heightmap } from '../terrain/heightmap';
import type { PathPoint } from '../nav/astar';
import { ROVER_MAX_SPEED } from './constants';

/** Rover kinematics: follows a polyline at a slope-derated speed. */
export class Rover {
  x: number;
  z: number;
  heading = 0; // radians, atan2(dx, dz) in the x/z plane
  speed = 0;
  climbRate = 0;
  odometerM = 0;
  path: PathPoint[] = [];
  private seg = 0;

  constructor(
    private hm: Heightmap,
    x: number,
    z: number,
  ) {
    this.x = x;
    this.z = z;
  }

  get y(): number {
    return this.hm.heightAt(this.x, this.z);
  }
  get driving(): boolean {
    return this.seg < this.path.length;
  }
  /** Remaining waypoints ahead (including the current target). */
  get remaining(): PathPoint[] {
    return this.path.slice(this.seg);
  }

  setPath(points: PathPoint[]): void {
    this.path = points.slice(1);
    this.seg = 0;
    if (!this.driving) this.speed = 0;
  }
  stop(): void {
    this.path = [];
    this.seg = 0;
    this.speed = 0;
    this.climbRate = 0;
  }

  /** Slope-derated speed: full speed on flat ground, half at 20 degrees. */
  speedFor(slopeDeg: number): number {
    return ROVER_MAX_SPEED * (1 - 0.5 * Math.min(1, slopeDeg / 20));
  }

  step(dt: number): void {
    if (!this.driving) {
      this.speed = 0;
      this.climbRate = 0;
      return;
    }
    const y0 = this.y;
    this.speed = this.speedFor(this.hm.slopeAt(this.x, this.z));
    let budget = this.speed * dt;
    const startOdo = this.odometerM;
    while (budget > 0 && this.driving) {
      const tgt = this.path[this.seg]!;
      const dx = tgt.x - this.x;
      const dz = tgt.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) {
        this.seg++;
        continue;
      }
      this.heading = Math.atan2(dx, dz);
      const mv = Math.min(budget, d);
      this.x += (dx / d) * mv;
      this.z += (dz / d) * mv;
      this.odometerM += mv;
      budget -= mv;
      if (mv >= d - 1e-9) this.seg++;
    }
    this.climbRate = dt > 0 ? (this.y - y0) / dt : 0;
    if (this.odometerM === startOdo) this.speed = 0;
    if (!this.driving) this.speed = 0;
  }
}

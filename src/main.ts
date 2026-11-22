import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadHeightmap } from './terrain/heightmap';
import { buildTerrainMesh } from './terrain/terrainMesh';
import { SceneEnv } from './render/sceneEnv';
import { RoverView } from './render/roverMesh';
import { PathLine, buildRocks } from './render/worldView';
import { Simulation } from './sim/simulation';
import { formatLocalTime } from './sim/environment';
import { Hud } from './ui/hud';

async function main() {
  const view = document.getElementById('view') as HTMLDivElement;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const env = new SceneEnv(scene);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 30000);

  const hm = await loadHeightmap();
  const sim = new Simulation(hm);
  scene.add(buildTerrainMesh(hm), buildRocks(hm, sim.rocks));
  const roverView = new RoverView(hm);
  const pathLine = new PathLine(hm);
  scene.add(roverView.group, pathLine.line);

  camera.position.set(sim.rover.x - 250, 420, sim.rover.z + 700);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(sim.rover.x, 60, sim.rover.z);
  controls.update();

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const timeSlider = $<HTMLInputElement>('timeSlider');
  const tauSlider = $<HTMLInputElement>('tauSlider');
  const playBtn = $<HTMLButtonElement>('playBtn');
  const speedSel = $<HTMLSelectElement>('speedSel');
  const camSel = $<HTMLSelectElement>('camSel');
  const readout = $('envReadout');
  const clockEl = $('clock');
  const hud = new Hud($('hud'), sim);

  sim.tau = Number(tauSlider.value);
  tauSlider.addEventListener('input', () => (sim.tau = Number(tauSlider.value)));
  timeSlider.addEventListener('input', () => sim.clock.setLocalHours(Number(timeSlider.value)));
  playBtn.addEventListener('click', () => {
    sim.paused = !sim.paused;
    playBtn.textContent = sim.paused ? 'Play' : 'Pause';
  });
  speedSel.addEventListener('change', () => (sim.speed = Number(speedSel.value)));
  sim.speed = Number(speedSel.value);

  let followPrev: THREE.Vector3 | null = null;
  camSel.addEventListener('change', () => (followPrev = null));

  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now();
  let hudT = 0;
  let pathVer = '';
  renderer.setAnimationLoop((now) => {
    const dt = (now - last) / 1000;
    last = now;
    sim.advance(dt);

    env.update(scene, sim.clock.localHours, sim.tau);
    roverView.update(sim.rover, camera);

    const rem = sim.rover.remaining;
    const ver = `${rem.length}:${rem[0]?.x}:${rem[rem.length - 1]?.x}`;
    if (ver !== pathVer) {
      pathVer = ver;
      pathLine.set([{ x: sim.rover.x, z: sim.rover.z }, ...rem]);
      pathLine.line.visible = rem.length > 0;
    }

    if (camSel.value === 'follow') {
      const rp = new THREE.Vector3(sim.rover.x, sim.rover.y, sim.rover.z);
      if (followPrev) camera.position.add(rp.clone().sub(followPrev));
      else camera.position.set(rp.x - Math.sin(sim.rover.heading) * 18, rp.y + 9, rp.z - Math.cos(sim.rover.heading) * 18);
      followPrev = rp;
      controls.target.copy(rp).add(new THREE.Vector3(0, 1.5, 0));
    }
    controls.update();

    hudT += dt;
    if (hudT > 0.25) {
      hudT = 0;
      hud.update(env.elevationDeg);
      clockEl.textContent = `Sol ${sim.clock.sol} · ${formatLocalTime(sim.clock.localHours)} LMST`;
      readout.textContent = `sun ${env.elevationDeg.toFixed(1)}°  τ ${sim.tau.toFixed(2)}  relief ${(hm.meta.maxElevation - hm.meta.minElevation).toFixed(0)} m / ${hm.sizeMetres / 1000} km`;
      if (document.activeElement !== timeSlider) timeSlider.value = String(sim.clock.localHours);
    }
    renderer.render(scene, camera);
  });
  (window as unknown as { __sim: Simulation; __scene: THREE.Scene }).__sim = sim;
  (window as unknown as { __scene: THREE.Scene }).__scene = scene;
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;padding:12px">${String(e)}</pre>`);
  throw e;
});

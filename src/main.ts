import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadWorld } from './world/world';
import { buildTerrain } from './terrain/terrainMesh';
import { SceneEnv } from './render/sceneEnv';
import { RoverView } from './render/roverMesh';
import { PathLine, buildRocks } from './render/worldView';
import { EXPOSURE } from './render/tone';
import { Simulation } from './sim/simulation';
import { sunAt } from './sim/environment';
import { Hud } from './ui/hud';
import { MiniMap } from './ui/minimap';
import { EyePanel } from './ui/eyePanel';
import { MastCamera } from './perception/mastCamera';
import { IdSpace, rockIdMaterial, terrainIdMaterial } from './perception/idPass';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const view = $('view');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // refreshed when the sun moves and a few times a second for the rover shadow
  view.prepend(renderer.domElement);

  const world = await loadWorld();
  const hm = world.hm;
  const sim = new Simulation(world);
  const half = hm.sizeMetres / 2;

  const scene = new THREE.Scene();
  const env = new SceneEnv(scene, half);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.4, 14000);

  const { group: terrainGroup } = buildTerrain(hm, world.geology, world.ortho);
  const rocksMesh = buildRocks(hm, sim.rocks);
  scene.add(terrainGroup, rocksMesh);
  const roverView = new RoverView(hm);
  const pathLine = new PathLine(hm);
  scene.add(roverView.group, pathLine.line);

  // Perception: the camera sees the same scene; a hidden flat-colour pass provides ground truth for scoring only.
  const ids = new IdSpace(world.geology, sim.rocks);
  const terrainId = terrainIdMaterial(world.geology);
  terrainGroup.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.idMaterial = terrainId;
  });
  rocksMesh.userData.idMaterial = rockIdMaterial(rocksMesh, ids, sim.rocks);
  roverView.group.userData.overlay = true;
  pathLine.line.userData.overlay = true;
  const mastCam = new MastCamera(ids.lookup);
  const eye = new EyePanel($('eyeCanvas') as HTMLCanvasElement, $('eyeInfo'), document.querySelector('#eyeCard .tabs') as HTMLElement);
  const hud = new Hud(sim);
  const minimap = new MiniMap($('mapCanvas') as HTMLCanvasElement, world, sim.agent.known);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.maxDistance = 4000;
  camera.position.set(half * 0.75, 520, half * 1.15);
  controls.target.set(0, 40, 0);
  controls.update();

  // ---- controls ----
  const timeSlider = $<HTMLInputElement>('timeSlider');
  const tauSlider = $<HTMLInputElement>('tauSlider');
  const playBtn = $<HTMLButtonElement>('playBtn');
  let camMode: 'orbit' | 'follow' = 'orbit';
  let followPrev: THREE.Vector3 | null = null;

  const segment = (root: HTMLElement, attr: string, onPick: (v: string) => void) => {
    root.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        root.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onPick((b as HTMLElement).dataset[attr]!);
      }),
    );
  };
  const speedSeg = $('speedSeg');
  const camSeg = $('camSeg');
  const setSpeed = (v: number) => {
    sim.speed = v;
    speedSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === v));
  };
  const setCam = (m: 'orbit' | 'follow') => {
    camMode = m;
    followPrev = null;
    camSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.cam === m));
  };
  const setPaused = (p: boolean) => {
    sim.paused = p;
    $('icoPause').toggleAttribute('hidden', p);
    $('icoPlay').toggleAttribute('hidden', !p);
    playBtn.setAttribute('aria-label', p ? 'Play' : 'Pause');
  };
  segment(speedSeg, 'speed', (v) => setSpeed(Number(v)));
  segment(camSeg, 'cam', (v) => setCam(v as 'orbit' | 'follow'));
  playBtn.addEventListener('click', () => setPaused(!sim.paused));
  tauSlider.addEventListener('input', () => (sim.tau = Number(tauSlider.value)));
  timeSlider.addEventListener('input', () => sim.clock.setLocalHours(Number(timeSlider.value)));
  const snap = () => sim.agent.requestCapture({ panDeg: 0, tiltDeg: -4, reason: 'manual' });
  $('snapBtn').addEventListener('click', snap);
  sim.tau = Number(tauSlider.value);
  setSpeed(600);
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const speeds = [1, 60, 600, 3600, 14400];
    if (e.code === 'Space') { e.preventDefault(); setPaused(!sim.paused); }
    else if (e.key >= '1' && e.key <= '5') setSpeed(speeds[Number(e.key) - 1]!);
    else if (e.key === 'f' || e.key === 'F') setCam('follow');
    else if (e.key === 'o' || e.key === 'O') setCam('orbit');
    else if (e.key === 'c' || e.key === 'C') snap();
  });

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
  let mapT = 0;
  let shadowT = 0;
  let pathVer = '';
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    sim.advance(dt);

    const sunMoved = env.update(sim.clock.localHours, sim.tau);
    shadowT += dt;
    if (sunMoved || shadowT > 0.35) {
      shadowT = 0;
      renderer.shadowMap.needsUpdate = true;
    }
    roverView.update(sim.rover, camera);

    const rem = sim.rover.remaining;
    const ver = `${rem.length}:${rem[0]?.x}:${rem[rem.length - 1]?.x}`;
    if (ver !== pathVer) {
      pathVer = ver;
      pathLine.set([{ x: sim.rover.x, z: sim.rover.z }, ...rem]);
      pathLine.line.visible = rem.length > 0;
    }

    if (camMode === 'follow') {
      const rp = new THREE.Vector3(sim.rover.x, sim.rover.y, sim.rover.z);
      if (followPrev) camera.position.add(rp.clone().sub(followPrev));
      else camera.position.set(rp.x - Math.sin(sim.rover.heading) * 14, rp.y + 6, rp.z - Math.cos(sim.rover.heading) * 14);
      followPrev = rp;
      controls.target.copy(rp).add(new THREE.Vector3(0, 1.2, 0));
    }
    controls.update();

    hudT += dt;
    if (hudT > 0.2) {
      hudT = 0;
      hud.update(env.elevationDeg);
      if (document.activeElement !== timeSlider) timeSlider.value = String(sim.clock.localHours);
    }
    mapT += dt;
    if (mapT > 0.4) {
      mapT = 0;
      minimap.draw(sim.rover, sim.rover.remaining, sim.agent.goal);
    }
    renderer.render(scene, camera);

    // Fulfil at most one camera request per frame (three offscreen passes + readback).
    const req = sim.agent.takeCaptureRequest();
    if (req) {
      renderer.shadowMap.needsUpdate = true;
      const sun = sunAt(sim.clock.localHours);
      const { agent, truth } = mastCam.capture(
        renderer,
        scene,
        req,
        { x: sim.rover.x, y: sim.rover.y, z: sim.rover.z, headingRad: sim.rover.heading },
        { simTime: sim.clock.t, sol: sim.clock.sol, localHours: sim.clock.localHours, sunElevationDeg: (sun.elevation * 180) / Math.PI, sunAzimuthDeg: (sun.azimuth * 180) / Math.PI, tau: sim.tau },
      );
      sim.agent.receiveFrame(agent); // the agent gets the image + depth only
      eye.setFrames(agent, truth); // the UI/evaluator also gets the hidden ground truth
      (window as unknown as { __frames: unknown }).__frames = { agent, truth }; // dev/test hook
    }
  });
  (window as unknown as { __sim: Simulation }).__sim = sim;
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;padding:12px;position:fixed;top:60px;left:12px;z-index:99">${String(e)}</pre>`);
  throw e;
});

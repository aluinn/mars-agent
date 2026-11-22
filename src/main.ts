import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadHeightmap } from './terrain/heightmap';
import { buildTerrainMesh } from './terrain/terrainMesh';
import { SceneEnv } from './render/sceneEnv';
import { formatLocalTime } from './sim/environment';

async function main() {
  const view = document.getElementById('view') as HTMLDivElement;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const env = new SceneEnv(scene);
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 30000);

  const hm = await loadHeightmap();
  scene.add(buildTerrainMesh(hm));
  camera.position.set(-300, 520, 2300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-200, 60, 0);
  controls.update();

  const timeSlider = document.getElementById('timeSlider') as HTMLInputElement;
  const tauSlider = document.getElementById('tauSlider') as HTMLInputElement;
  const readout = document.getElementById('envReadout') as HTMLSpanElement;
  const clock = document.getElementById('clock') as HTMLSpanElement;

  function applyEnv() {
    const t = Number(timeSlider.value);
    const tau = Number(tauSlider.value);
    env.update(scene, t, tau);
    clock.textContent = `Local ${formatLocalTime(t)} LMST`;
    readout.textContent = `sun ${env.elevationDeg.toFixed(1)}°  direct ${(env.directFactor * 100).toFixed(0)}%  relief ${(hm.meta.maxElevation - hm.meta.minElevation).toFixed(0)} m over ${hm.sizeMetres / 1000} km`;
  }
  timeSlider.addEventListener('input', applyEnv);
  tauSlider.addEventListener('input', applyEnv);
  applyEnv();

  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;padding:12px">${String(e)}</pre>`);
  throw e;
});

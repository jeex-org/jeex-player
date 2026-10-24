/**
 * The light-bake calibration room with its bake bound, for a person to look
 * at: the lit room from inside (lightmap plus the live sun, which is what a
 * baked surface keeps), the floor from above, and the atlas page raw and
 * decoded. The bar toggles the lightmap and the sun and prints the measured
 * plate factor and lamp landmark error, the same numbers the component tests
 * gate on (`tests/component/lightmap-calibration.test.ts`); they are also on
 * `window.__lightmapCalibration` for a scripted check.
 *
 * The corner lamp is in the bake, so it is not lit live here: the lighting's
 * baked-surface policy, which will skip a baked lamp's diffuse on a baked
 * surface, is not in this page. The display uses the lighting standard's
 * tone mapping (Neutral) and sRGB output; the measurements are linear.
 */

import * as THREE from 'three';
import { CALIBRATION_LAMP, CALIBRATION_ROOM } from '../tests/fixtures/lightmap-calibration/calibration-facts.js';
import {
  boundCalibration,
  floorCamera,
  floorPoint,
  FLOOR_PPM,
  meshOf,
  plateCamera,
  renderLinear,
  showOnly,
} from '../tests/component/lightmap-support.js';

declare global {
  interface Window {
    __lightmapCalibration?: { plateFactor: number; landmarkError: number; unresolvedLamps: readonly string[]; ready: boolean };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const readout = document.querySelector<HTMLElement>('#readout');
if (!canvas || !readout) throw new Error('lightmap-calibration: page markup missing');

// The baked corner lamp, as a bank lamp is built: a light in its placement group. The binding marks it baked; it stays dark here (see the module comment).
const lamp = new THREE.PointLight(new THREE.Color().setRGB(...CALIBRATION_LAMP.color, THREE.LinearSRGBColorSpace), 0);
lamp.position.set(...CALIBRATION_LAMP.position);
const lampGroup = new THREE.Group();
lampGroup.userData['assetId'] = CALIBRATION_LAMP.id;
lampGroup.add(lamp);

const calibration = await boundCalibration({ beforeBind: (root) => root.add(lampGroup) });
const { gl: measureGl, loaded, scene, shell, bound } = calibration;
const [W, , D] = CALIBRATION_ROOM.size;

/** The two numbers the tests gate on, measured on this page's own bound shell. */
function measure(): { plateFactor: number; landmarkError: number } {
  const visible = new Map<THREE.Object3D, boolean>();
  shell.traverse((object) => visible.set(object, object.visible));
  showOnly(shell, meshOf(shell, 'plate').name);
  const plate = renderLinear(measureGl, scene, plateCamera(), 80, 80);
  let sum = 0;
  for (let j = 4; j < 76; j++)
    for (let i = 4; i < 76; i++) sum += (plate[4 * (j * 80 + i)]! + plate[4 * (j * 80 + i) + 1]! + plate[4 * (j * 80 + i) + 2]!) / 3;
  // A standard material's indirect diffuse carries an energy term, so this reads a little under pi; the test uses a zero-specular material.
  const plateFactor = (Math.PI * CALIBRATION_ROOM.skyRadiance * CALIBRATION_ROOM.plate.albedo) / (sum / (72 * 72));
  showOnly(shell, meshOf(shell, 'floor').name);
  const [fw, fh] = [W * FLOOR_PPM, D * FLOOR_PPM];
  const floor = renderLinear(measureGl, scene, floorCamera(), fw, fh);
  const value = (i: number): number => Math.max(floor[4 * i]!, floor[4 * i + 1]!, floor[4 * i + 2]!);
  let top = 0;
  for (let i = 0; i < fw * fh; i++) top = Math.max(top, value(i));
  let [sx, sz, sw] = [0, 0, 0];
  for (let j = 0; j < fh; j++)
    for (let i = 0; i < fw; i++) {
      const v = value(j * fw + i);
      if (v < 0.9 * top) continue;
      const [x, z] = floorPoint(i, j);
      [sx, sz, sw] = [sx + x * v, sz + z * v, sw + v];
    }
  for (const [object, was] of visible) object.visible = was;
  return { plateFactor, landmarkError: Math.hypot(sx / sw - CALIBRATION_LAMP.position[0], sz / sw - CALIBRATION_LAMP.position[2]) };
}
const numbers = measure();

// The display renderer.
const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
gl.toneMapping = THREE.NeutralToneMapping;
gl.shadowMap.enabled = true;

const { sun: bakedSun } = loaded.bake;
const sun = new THREE.DirectionalLight(0xffffff, bakedSun.strength);
sun.color.setRGB(...bakedSun.color, THREE.LinearSRGBColorSpace);
sun.target.position.set(W / 2, 0, D / 2);
sun.position.set(W / 2 - bakedSun.direction[0] * 12, -bakedSun.direction[1] * 12, D / 2 - bakedSun.direction[2] * 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
shell.traverse((object) => {
  if ((object as THREE.Mesh).isMesh) object.castShadow = object.receiveShadow = true;
});

// The atlas views: one quad, raw bytes or the decoded light (scaled down for display).
const page = loaded.pages[0]!.texture;
const atlasScene = new THREE.Scene();
const atlasMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: { map: { value: page }, decoded: { value: 0 }, range: { value: loaded.bake.contract.encoding.range } },
  vertexShader: 'out vec2 vUv; void main() { vUv = vec2( uv.x, 1.0 - uv.y ); gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader:
    'uniform sampler2D map; uniform float decoded; uniform float range; in vec2 vUv; out vec4 colour; void main() { vec4 t = texture( map, vUv ); vec3 light = t.rgb * t.a * range; colour = vec4( decoded > 0.5 ? light / ( 1.0 + light ) : t.rgb, 1.0 ); }',
  toneMapped: false,
});
atlasScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), atlasMaterial));

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);
const views: Record<string, () => void> = {
  window: () => {
    camera.position.set(0.6, 1.5, 2.8);
    camera.lookAt(2.2, 1.0, 0);
  },
  lamp: () => {
    camera.position.set(3.6, 1.6, 0.4);
    camera.lookAt(0.6, 0.8, 2.6);
  },
};
let view = 'window';
let lightmapOn = true;
let sunOn = true;

function setLightmap(on: boolean): void {
  shell.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (material?.lightMap) material.lightMapIntensity = on ? loaded.bake.contract.intensity : 0;
  });
}

function draw(): void {
  const { clientWidth: w, clientHeight: h } = canvas!;
  gl.setSize(w, h, false);
  showOnly(
    shell,
    ...['floor', 'ceiling', 'wallFront', 'wallBack', 'wallLeft', 'wallRight', 'plate', 'block'].map(
      (role) => meshOf(shell, role as never).name,
    ),
  );
  sun.visible = sunOn;
  setLightmap(lightmapOn);
  if (view === 'raw' || view === 'decoded') {
    atlasMaterial.uniforms['decoded']!.value = view === 'decoded' ? 1 : 0;
    const side = Math.min(w, h);
    gl.setViewport((w - side) / 2, (h - side) / 2, side, side);
    gl.setClearColor(0x0d1111);
    gl.clear();
    gl.render(atlasScene, new THREE.Camera());
    gl.setViewport(0, 0, w, h);
    return;
  }
  if (view === 'floor') {
    const top = floorCamera();
    const aspect = w / h;
    Object.assign(top, {
      left: -Math.max(W / 2, (D / 2) * aspect),
      right: Math.max(W / 2, (D / 2) * aspect),
      top: Math.max(D / 2, W / 2 / aspect),
      bottom: -Math.max(D / 2, W / 2 / aspect),
    });
    top.updateProjectionMatrix();
    meshOf(shell, 'ceiling').visible = false;
    gl.render(scene, top);
    return;
  }
  views[view]!();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  gl.render(scene, camera);
}

for (const button of document.querySelectorAll<HTMLButtonElement>('#bar button')) {
  button.addEventListener('click', () => {
    if (button.dataset['view']) {
      view = button.dataset['view'];
      for (const other of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
        other.setAttribute('aria-pressed', String(other === button));
    } else if (button.dataset['toggle'] === 'lightmap') {
      lightmapOn = !lightmapOn;
      button.setAttribute('aria-pressed', String(lightmapOn));
    } else if (button.dataset['toggle'] === 'sun') {
      sunOn = !sunOn;
      button.setAttribute('aria-pressed', String(sunOn));
    }
    draw();
  });
}
new ResizeObserver(draw).observe(canvas);

readout.textContent = `bake ${loaded.bake.bakeId.slice(0, 8)}… · plate factor ${numbers.plateFactor.toFixed(3)} (standard material) · lamp landmark ${(100 * numbers.landmarkError).toFixed(1)} cm off · baked lamps marked ${String(lamp.userData['jeexBaked'] === true)} · unresolved lamps ${String(bound.unresolvedLamps.length)}`;
window.__lightmapCalibration = { ...numbers, unresolvedLamps: bound.unresolvedLamps, ready: true };
draw();

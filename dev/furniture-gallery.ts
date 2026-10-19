import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AssetLoader } from '../src/geometry/asset-loader.js';
import { listCatalogueObjects } from '../src/assets/asset-catalogue.js';
import { JEEX_GUID_NAMESPACE } from '../src/scene/guid.js';
import { uuidV5 } from '../src/shared/uuid.js';
import type { DemoAsset } from '../src/scene/types.js';

/**
 * Reference-room preview harness for the object bank.
 *
 * The visual QC step ("render preview in a reference room"): every archetype,
 * or every variant of one archetype, is laid out on a neutral ground under the
 * same lighting so proportions, pivots and finishes can be compared. Not part of the viewer bundle - `index.html` never imports it;
 * open `/dev/furniture-gallery.html` in dev.
 *
 * Query parameters: `?variants=<archetype id|all>` expands variants,
 * `?ids=a,b,c` narrows to those archetype ids (UUIDs; the labels show slugs).
 *
 * Invariant: the harness only reads the catalogue and the loader; it never
 * mutates either.
 */

const CELL_PADDING = 0.55; // metres of clear ground around each specimen
const GALLERY_CEILING = 2.7; // metres - the height ceiling fixtures hang from here

type Specimen = { placement: DemoAsset; label: string; width: number; depth: number; height: number; anchor: string };

/** The placement id of the specimen showing `variantId`: a UUID v5 of it, the same on every load. */
function specimenId(variantId: string): string {
  return uuidV5(JEEX_GUID_NAMESPACE, `jeex-gallery-specimen:${variantId}`);
}

function specimens(): Specimen[] {
  const params = new URLSearchParams(window.location.search);
  const variantsOf = params.get('variants');
  const only = params
    .get('ids')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const objects = listCatalogueObjects().filter((object) => !only || only.includes(object.id));
  const out: Specimen[] = [];
  for (const object of objects) {
    const variants =
      variantsOf === object.id || variantsOf === 'all'
        ? object.variants
        : object.variants.filter((variant) => variant.id === object.defaultVariant);
    for (const variant of variants) {
      const dims = variant.dims ?? object.dims;
      out.push({
        // A specimen is derived from its variant, so its id is derived too
        // (deterministic, like a face GUID): never the variant's own UUID, which
        // names a different thing, and never minted. The slug is only the label.
        placement: { id: specimenId(variant.id), type: object.id, asset: object.id, variant: variant.id, position: { x: 0, y: 0, z: 0 } },
        label: variant.slug,
        width: dims[0],
        depth: dims[2],
        height: dims[1],
        anchor: object.anchor,
      });
    }
  }
  return out;
}

function layout(items: Specimen[]): { columns: number; cell: number } {
  // `Math.max()` of nothing is -Infinity; the empty case is guarded so a query
  // that matched no id cannot poison the cell size, the ground plane and the camera.
  const widest = items.length === 0 ? 1 : Math.max(...items.map((item) => Math.max(item.width, item.depth)));
  const cell = widest + CELL_PADDING * 2;
  const columns = Math.max(1, Math.round(Math.sqrt(items.length * 1.35)));
  return { columns, cell };
}

function makeLabel(text: string, cell: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(24, 26, 26, 0.82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f3ece0';
  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const width = cell * 0.82;
  sprite.scale.set(width, width * 0.13, 1);
  return sprite;
}

function main(): void {
  const canvas = document.querySelector<HTMLElement>('#gallery-canvas') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r182: PCFSoftShadowMap deprecated, PCFShadowMap is soft

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfc6b6');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  environment.dispose();
  pmrem.dispose();

  const items = specimens();
  if (items.length === 0) {
    const query = new URLSearchParams(location.search).get('ids');
    document.body.textContent = query ? `No catalogue object or variant matches ?ids=${query}` : 'The object bank is empty.';
    return;
  }
  const { columns, cell } = layout(items);
  const rows = Math.ceil(items.length / columns);
  const spanX = columns * cell;
  const spanZ = rows * cell;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spanX + cell * 2, spanZ + cell * 2),
    new THREE.MeshStandardMaterial({ color: '#d9d1c2', roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(new THREE.HemisphereLight('#fff6e6', '#6f6a63', 1.5));
  const sun = new THREE.DirectionalLight('#ffe6c2', 3);
  sun.position.set(-spanX * 0.4, Math.max(10, spanZ), spanZ * 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const extent = Math.max(spanX, spanZ) * 0.75;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#c3d8e0', 0.55);
  fill.position.set(spanX, spanZ * 0.6, -spanZ);
  scene.add(fill);

  const loader = new AssetLoader([], { ceilingHeight: GALLERY_CEILING });
  let degraded = 0;
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = (column - (columns - 1) / 2) * cell;
    const z = (row - (rows - 1) / 2) * cell;
    const result = loader.load({ ...item.placement, position: { x, y: 0, z } });
    if (result.degraded) degraded += 1;
    // Wall pieces hang at eye height so their pivot reads correctly; ceiling
    // pieces are already mounted at `GALLERY_CEILING` by the loader.
    if (item.anchor === 'wall') result.group.position.y = 1.45;
    scene.add(result.group);
    const label = makeLabel(item.label, cell);
    label.position.set(x, 0.05, z - cell * 0.46);
    scene.add(label);
  });

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 400);
  // Objects face -Z once the loader applies the scene facing convention, so the
  // reference camera stands in front of them.
  const radius = Math.max(spanX, spanZ) * 0.92 + 2.2;
  camera.position.set(-radius * 0.58, radius * 0.55, -radius * 0.78);
  camera.lookAt(0, Math.min(0.8, radius * 0.08), 0);

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', resize);
  resize();
  renderer.render(scene, camera);

  window.__galleryReady = true;
  window.__gallery = {
    count: items.length,
    degraded,
    ids: items.map((item) => item.label),
    look: (x: number, y: number, z: number, distance: number) => {
      camera.position.set(x + distance * 0.55, y + distance * 0.5, z + distance * 0.75);
      camera.lookAt(x, y, z);
      renderer.render(scene, camera);
    },
    cell: () => ({ cell, columns, rows }),
  };
}

declare global {
  interface Window {
    __galleryReady?: boolean;
    __gallery?: {
      count: number;
      degraded: number;
      ids: string[];
      look: (x: number, y: number, z: number, distance: number) => void;
      cell: () => { cell: number; columns: number; rows: number };
    };
  }
}

main();

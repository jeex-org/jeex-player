/**
 * Applies a light bake to a loaded shell, as one transaction.
 *
 * Each binding names one mesh by its entity id (`Object3D.name`). A clone is
 * made even for a material no other mesh uses, so a material the shell
 * shares with furniture is never marked. Before
 * anything changes, every binding must resolve to exactly one single-material
 * standard mesh whose UV1 is finite, two-component and inside the binding's
 * chart rect (half a texel of slack), and the shader decode must find its
 * anchor in this three.js. Only then are the materials cloned (one clone per
 * source material and page, shared by every mesh bound with that pair), given
 * the page's lightmap from UV channel 1, the contract's intensity and the
 * RGBM decode and no AO map (the bake already holds the occlusion), marked
 * as baked surfaces, and assigned; a material that transmits light (glass)
 * is left unbound and unmarked, and named; and the lights under
 * every listed lamp placement are marked baked. Nothing reads a mesh's
 * transform: the lightmap is addressed by UV1 alone.
 *
 * Invariant: `unbind` restores a mesh only while it still holds the clone it
 * was given (a later material change wins), restores every lamp's previous
 * flag, disposes the clones and does nothing a second time. Pages are the
 * loaded bake's to dispose, not the binding's.
 */

import * as THREE from 'three';
import { markBakedSurface, setLampBaked } from '../render/baked-surface.js';
import type { LightBake, LightBakeBinding } from './light-bake.js';
import { LightBakeError } from './light-bake-error.js';
import { decorateRgbm } from './lightmap-shader.js';

/**
 * A bound bake: the lamp ids that named no light, the bound nodes left
 * without a lightmap because their material transmits light (glass keeps its
 * live lighting), and the undo.
 */
export type BoundLightBake = { readonly unresolvedLamps: readonly string[]; readonly transmissive: readonly string[]; unbind(): void };

type Lamp = THREE.PointLight | THREE.SpotLight;

/** Every object under `root` by name; names that occur more than once map to all of their objects. */
function byName(root: THREE.Object3D): Map<string, THREE.Object3D[]> {
  const index = new Map<string, THREE.Object3D[]>();
  root.traverse((object) => {
    if (!object.name) return;
    const list = index.get(object.name);
    if (list) list.push(object);
    else index.set(object.name, [object]);
  });
  return index;
}

const refuse = (binding: LightBakeBinding, why: string): LightBakeError =>
  new LightBakeError('binding', `light bake binding ${binding.node}: ${why}`, { detail: { node: binding.node } });

/** The one standard mesh a binding names, with its UV1 checked against the rect. */
function resolveMesh(index: Map<string, THREE.Object3D[]>, binding: LightBakeBinding, page: { width: number; height: number }): THREE.Mesh {
  const found = index.get(binding.node) ?? [];
  if (found.length !== 1)
    throw refuse(binding, found.length === 0 ? 'no mesh has this name' : `${String(found.length)} objects have this name`);
  const mesh = found[0] as THREE.Mesh;
  if (!mesh.isMesh) throw refuse(binding, 'the named object is not a mesh');
  if (Array.isArray(mesh.material)) throw refuse(binding, 'the mesh has more than one material');
  if (!(mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) throw refuse(binding, 'the mesh has no standard material');
  const uv1 = mesh.geometry.getAttribute('uv1') as THREE.BufferAttribute | undefined;
  if (!uv1 || uv1.itemSize !== 2) throw refuse(binding, 'the mesh has no two-component UV1');
  const { x, y, w, h } = binding.rect;
  const [u0, u1, v0, v1] = [(x - 0.5) / page.width, (x + w + 0.5) / page.width, (y - 0.5) / page.height, (y + h + 0.5) / page.height];
  for (let i = 0; i < uv1.count; i++) {
    const [u, v] = [uv1.getX(i), uv1.getY(i)];
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw refuse(binding, 'UV1 is not finite');
    if (u < u0 || u > u1 || v < v0 || v > v1) throw refuse(binding, 'UV1 leaves the chart rect');
  }
  return mesh;
}

/** The lights under each listed lamp placement (the nearest `userData.assetId` on the way up). */
function resolveLamps(root: THREE.Object3D, ids: ReadonlySet<string>): { lamps: Lamp[]; unresolved: string[] } {
  const lamps: Lamp[] = [];
  const found = new Set<string>();
  root.traverse((object) => {
    const kind = object as { isPointLight?: boolean; isSpotLight?: boolean };
    if (!(kind.isPointLight || kind.isSpotLight)) return;
    const light = object as Lamp;
    let at: THREE.Object3D | null = light;
    while (at && typeof at.userData['assetId'] !== 'string') at = at.parent;
    const id = at?.userData['assetId'] as string | undefined;
    if (id === undefined || !ids.has(id)) return;
    lamps.push(light);
    found.add(id);
  });
  return { lamps, unresolved: [...ids].filter((id) => !found.has(id)) };
}

/**
 * Whether a prepared clone compiles its decode: its composed hook (the
 * source's own, then the decode) runs on a throwaway copy of this three.js's
 * physical shader, with the clone's final state as `this`. Compilation is
 * lazy, so a missing anchor would otherwise surface only at the first draw,
 * after the binding committed. There is no renderer here; a hook that needs
 * one fails the preflight and the bake is refused.
 */
function preflightShader(clone: THREE.MeshStandardMaterial, node: string): void {
  const { fragmentShader, vertexShader } = THREE.ShaderLib.physical;
  const probe = { fragmentShader, vertexShader, uniforms: {}, defines: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  try {
    clone.onBeforeCompile.call(clone, probe, undefined as unknown as THREE.WebGLRenderer);
  } catch (error) {
    throw new LightBakeError(
      'shader',
      `light bake binding ${node}: the material's shader does not take the decode (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

/** The clone of `source` bound to `texture`: its hooks kept, the lightmap set, decoded and marked. */
function bakedClone(source: THREE.MeshStandardMaterial, texture: THREE.Texture, bake: LightBake): THREE.MeshStandardMaterial {
  const clone = source.clone();
  // `Material.clone` copies neither hook; the decode composes onto the source's own, run with the clone as `this`.
  const identity = source.onBeforeCompile.toString();
  clone.onBeforeCompile = source.onBeforeCompile.bind(clone);
  // three's default key (never assigned) names the hook's source, which a bound copy no longer shows.
  clone.customProgramCacheKey = Object.hasOwn(source, 'customProgramCacheKey') ? source.customProgramCacheKey.bind(clone) : () => identity;
  // A shell AO map would darken light the bake already occluded.
  clone.aoMap = null;
  clone.lightMap = texture;
  clone.lightMapIntensity = bake.contract.intensity;
  decorateRgbm(clone, bake.contract.encoding.range);
  markBakedSurface(clone);
  return clone;
}

/**
 * Binds `bake` onto the shell under `root` with its loaded page textures
 * (`textures[i]` for page `i`); throws a `LightBakeError` and changes nothing
 * when any binding does not fit.
 */
export function bindLightBake(root: THREE.Object3D, bake: LightBake, textures: readonly THREE.Texture[]): BoundLightBake {
  if (textures.length !== bake.pages.length)
    throw new LightBakeError('binding', `light bake: ${String(textures.length)} textures for ${String(bake.pages.length)} pages`);
  const index = byName(root);
  const resolved = bake.bindings.map((binding) => ({ binding, mesh: resolveMesh(index, binding, bake.pages[binding.page]!) }));
  const transmits = (mesh: THREE.Mesh): boolean => ((mesh.material as Partial<THREE.MeshPhysicalMaterial>).transmission ?? 0) > 0;
  const transmissive = resolved.filter(({ mesh }) => transmits(mesh)).map(({ binding }) => binding.node);
  const bindable = resolved.filter(({ mesh }) => !transmits(mesh));
  const meshes = bindable.map(({ mesh }) => mesh);
  const { lamps, unresolved } = resolveLamps(root, new Set(bake.lamps.map((lamp) => lamp.id)));

  const clones = new Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>();
  const plan = meshes.map((mesh, i) => {
    const source = mesh.material as THREE.MeshStandardMaterial;
    const page = bindable[i]!.binding.page;
    let perPage = clones.get(source);
    if (!perPage) clones.set(source, (perPage = new Map()));
    let clone = perPage.get(page);
    if (!clone) perPage.set(page, (clone = bakedClone(source, textures[page]!, bake)));
    return { mesh, source, clone, node: bindable[i]!.binding.node };
  });
  const prepared = [...clones.values()].flatMap((perPage) => [...perPage.values()]);
  try {
    for (const { clone, node } of plan) preflightShader(clone, node);
  } catch (error) {
    for (const clone of prepared) clone.dispose();
    throw error;
  }
  const lampFlags = lamps.map((lamp) => ({
    lamp,
    had: Object.hasOwn(lamp.userData, 'jeexBaked'),
    was: lamp.userData['jeexBaked'] as unknown,
  }));

  for (const { mesh, clone } of plan) mesh.material = clone;
  for (const lamp of lamps) setLampBaked(lamp, true);

  let bound = true;
  return {
    unresolvedLamps: unresolved,
    transmissive,
    unbind() {
      if (!bound) return;
      bound = false;
      for (const { mesh, source, clone } of plan) if (mesh.material === clone) mesh.material = source;
      for (const { lamp, had, was } of lampFlags) {
        if (had) lamp.userData['jeexBaked'] = was;
        else delete lamp.userData['jeexBaked'];
      }
      for (const clone of prepared) clone.dispose();
    },
  };
}

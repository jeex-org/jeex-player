/**
 * The site ground's two looks: the warm lit disc under the flat, and a shadow
 * catcher that shows only the model's sun shadow over the host's backdrop.
 *
 * Seen from the 360 and plan cameras the disc fills the whole frame around the
 * model, so a lit disc would hide the themed backdrop behind it. Walk and tour
 * need it lit: the room probes and the grid bake see it through the windows,
 * as part of the daylight bounce. So the mesh, its name and its geometry stay
 * one (the sun shadow fits its frustum to the disc and keeps it out of the
 * casters, `render/sun-shadow.ts`; the lightmap contract names it), and only
 * its material changes, in the same place as the daylight sky
 * (`ViewerStage`).
 *
 * Both materials belong to the shell builder that made the disc and are freed
 * with it, whichever of the two is on the mesh then.
 */

import * as THREE from 'three';

/** The disc's name, which the sun shadow and the lightmap contract look it up by. */
export const SITE_GROUND_NAME = 'site-ground';

/** How dark the model's sun shadow lies on the host's backdrop in 360 and plan, 0..1. */
export const SITE_GROUND_SHADOW_OPACITY = 0.3;

/**
 * The plinth slab under the flat (`site-slab`), in every mode: a neutral
 * concrete grey that sits on any host theme. It stays lit and takes the
 * contact shadow; a thin band of it at the foot of a window view is all walk
 * and tour see, too little to move their light.
 */
export const SITE_SLAB_COLOUR = '#b4b4b0';

const looks = new WeakMap<THREE.Mesh, { readonly lit: THREE.Material; readonly catcher: THREE.ShadowMaterial }>();

/** A lit disc of `radius` metres with its shadow catcher beside it; both materials are pushed onto `owned`. */
export function createSiteGround(radius: number, owned: THREE.Material[]): THREE.Mesh {
  const lit = new THREE.MeshStandardMaterial({ color: '#b7a893', roughness: 1 });
  const catcher = new THREE.ShadowMaterial({ opacity: SITE_GROUND_SHADOW_OPACITY });
  owned.push(lit, catcher);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), lit);
  ground.name = SITE_GROUND_NAME;
  ground.receiveShadow = true;
  looks.set(ground, { lit, catcher });
  return ground;
}

/** The site ground under `root`, or `null` when it has none. */
export function findSiteGround(root: THREE.Object3D): THREE.Mesh | null {
  const ground = root.getObjectByName(SITE_GROUND_NAME);
  return ground instanceof THREE.Mesh && looks.has(ground) ? ground : null;
}

/**
 * The material `mesh` is drawn with in walk and tour: the site ground's lit
 * look whichever is on it now, `material` (its own) for any other mesh. What
 * the light bake's shell contract reads, so a bake bound while 360 shows the
 * catcher sees the same shell.
 */
export function litMaterialOf(mesh: THREE.Mesh, material: THREE.Material): THREE.Material {
  return looks.get(mesh)?.lit ?? material;
}

/** Puts the lit look on `ground` (`lit`), or the shadow catcher. */
export function setSiteGroundLit(ground: THREE.Mesh | null, lit: boolean): void {
  const look = ground ? looks.get(ground) : undefined;
  if (!ground || !look) return;
  const material = lit ? look.lit : look.catcher;
  if (ground.material !== material) ground.material = material;
}

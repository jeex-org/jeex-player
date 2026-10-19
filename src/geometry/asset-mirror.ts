/**
 * Drawing a mirrored placement: the body is reflected about the centre of its own bounds, in the
 * placement group's frame — `x` left↔right, `y` up↔down, `z` front↔back — so
 * the object stays where it stands (a `y` mirror does not sink a sofa under
 * the floor).
 *
 * The reflection is a negative scale on the BODY nodes under the placement
 * group, never on the group: the group keeps the placement's own transform
 * (position, yaw, positive uniform scale) that the move tool, the animator
 * and the picker write, and a body swapped in later (`SceneBuilder.upgrade…`)
 * is reflected on its way in. Lighting and culling need nothing more: three's
 * renderer flips the front-face winding of any mesh whose world matrix has a
 * negative determinant, and the normal matrix is the inverse transpose, which
 * carries a reflection correctly. An export clones the nodes with their
 * transforms (`render/export-graph.ts`), so a glTF or USDZ file carries the
 * mirror as the node's scale.
 */

import * as THREE from 'three';
import { isMirrorAxis, mirroredAxes, mirrorOf } from '../scene/mirror.js';
import type { Mirror, MirrorAxis, MirrorFacts } from '../scene/types.js';
import { GLOW_GROUP_NAME } from './selection-glow.js';

/** `userData` key on a placement group: the axes its bodies are reflected on now. */
export const MIRROR_USERDATA_KEY = 'mirror';

const scratchBox = new THREE.Box3();
const scratchMatrix = new THREE.Matrix4();

/** The bounds of `nodes`, in the frame their parent sits in. */
function boundsInParent(nodes: readonly THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const node of nodes) {
    node.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox) return;
      // The mesh's matrix up to (and including) `node`, not the world: the
      // placement group's own pose must not enter the centre.
      scratchMatrix.identity();
      for (let at: THREE.Object3D | null = object; at !== null; at = at.parent) {
        at.updateMatrix();
        scratchMatrix.premultiply(at.matrix);
        if (at === node) break;
      }
      box.union(scratchBox.copy(geometry.boundingBox).applyMatrix4(scratchMatrix));
    });
  }
  return box;
}

/** Reflects `nodes` on `axes` about the centre of their bounds; nothing for no axes or no geometry. */
function reflect(nodes: readonly THREE.Object3D[], axes: readonly MirrorAxis[]): void {
  if (axes.length === 0 || nodes.length === 0) return;
  const box = boundsInParent(nodes);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const sign = (axis: MirrorAxis): number => (axes.includes(axis) ? -1 : 1);
  const about = new THREE.Matrix4()
    .makeTranslation(centre.x, centre.y, centre.z)
    .multiply(new THREE.Matrix4().makeScale(sign('x'), sign('y'), sign('z')))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  for (const node of nodes) node.applyMatrix4(about);
}

/** The bodies of a placement group: every child but the selection aura. */
function bodiesOf(group: THREE.Object3D): THREE.Object3D[] {
  return group.children.filter((child) => child.name !== GLOW_GROUP_NAME);
}

/** The axes a placement group's bodies are reflected on now. */
export function bodyMirrorOf(group: THREE.Object3D): Mirror {
  const stored: unknown = group.userData[MIRROR_USERDATA_KEY];
  return mirrorOf(Array.isArray(stored) ? stored.filter((axis) => isMirrorAxis(axis)) : []);
}

/** `userData` key on a placement group: the mirror axes its asset allows (`asset-loader.ts` tags it). */
export const MIRROR_FACTS_USERDATA_KEY = 'mirrorFacts';

/** The mirror facts a placement group was tagged with, or none (absent allows no axis). */
export function mirrorFactsOf(group: THREE.Object3D | undefined): MirrorFacts | undefined {
  const value: unknown = group?.userData[MIRROR_FACTS_USERDATA_KEY];
  if (typeof value !== 'object' || value === null) return undefined;
  const facts = value as Partial<Record<MirrorAxis, unknown>>;
  return { x: facts.x === true, y: facts.y === true, z: facts.z === true };
}

/**
 * Brings a placement group's bodies to the mirror state `wanted`: the axes
 * that differ from what they show now are reflected (a reflection about the
 * bounds centre keeps the bounds, so toggling one axis twice is the identity).
 */
export function setBodyMirror(group: THREE.Object3D, wanted: Mirror | undefined): void {
  const now = new Set(mirroredAxes(bodyMirrorOf(group)));
  const next = mirroredAxes(wanted);
  const flip = [...new Set([...now, ...next])].filter((axis) => now.has(axis) !== next.includes(axis));
  reflect(bodiesOf(group), flip);
  if (next.length === 0) delete group.userData[MIRROR_USERDATA_KEY];
  else group.userData[MIRROR_USERDATA_KEY] = next;
}

/** Reflects ONE body that is about to join a placement group (a model swapped in for its procedural stand-in). */
export function mirrorBody(body: THREE.Object3D, mirror: Mirror | undefined): void {
  reflect([body], mirroredAxes(mirror));
}

/**
 * The light-probe grids of walk and tour: one per room box, and one fixed
 * grid for everything outside the rooms.
 *
 * Selection: three r186 gives an object the first grid in the frame's list
 * whose `boundingBox.containsPoint` holds its world origin (`WebGLRenderer`
 * `findLightProbeGrid`), and the shader samples the grid between that box's
 * `min` and `max`. A room grid replaces its box with a `SelectionBox`: `min`
 * and `max` stay the inset sampling box, `containsPoint` answers from the room
 * box grown to the wall centreline, so a cabinet standing on the floor against
 * a wall, a door leaf on its hinge or a window part in the wall is lit by its
 * room. The behaviour is pinned in the browser
 * (`tests/component/walk-lighting.test.ts`) beside the engine-revision guard.
 *
 * The exterior grid is never baked: its 2 x 2 x 2 atlas holds the apartment
 * rig's hemisphere and fill as spherical harmonics (`exterior-sh.ts`), and
 * its selection box contains every point, so listed last it catches every
 * object no room grid took and no object is ever left without a grid (which
 * would recompile its program every frame).
 */

import { ViewerLibError } from '../../shared/errors.js';
import * as THREE from 'three';
import { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';
import type { Box, RoomBox } from './room-volumes.js';
import { exteriorSH, packAtlas, type ExteriorLights } from './exterior-sh.js';

/** A `Box3` whose `min`/`max` are what the shader samples and whose `containsPoint` is the selection test. */
export class SelectionBox extends THREE.Box3 {
  /** The box an origin is tested against; `null` contains every point. */
  readonly selection: THREE.Box3 | null;

  constructor(selection: THREE.Box3 | null) {
    super();
    this.selection = selection;
  }

  override containsPoint(point: THREE.Vector3): boolean {
    return this.selection === null || this.selection.containsPoint(point);
  }
}

const toBox3 = (box: Box): THREE.Box3 =>
  new THREE.Box3(new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z));

/** The grid of one room box: placed on its sampling box, selected by its selection box. */
export class RoomGrid extends LightProbeGridWebGL {
  readonly roomId: string;

  constructor(room: RoomBox) {
    const { sampling, resolution } = room;
    super(
      sampling.max.x - sampling.min.x,
      sampling.max.y - sampling.min.y,
      sampling.max.z - sampling.min.z,
      resolution.x,
      resolution.y,
      resolution.z,
    );
    this.roomId = room.roomId;
    this.name = `walk-grid-${room.roomId}`;
    toBox3(sampling).getCenter(this.position);
    this.boundingBox = new SelectionBox(toBox3(room.selection));
    this.updateBoundingBox();
    this.updateMatrixWorld(true);
  }
}

/** The fixed grid of everything outside the rooms; `bake` is refused. */
class ExteriorGrid extends LightProbeGridWebGL {
  override bake(): void {
    throw new ViewerLibError('internal', 'the exterior grid is computed, never baked');
  }

  override dispose(): void {
    this.texture?.dispose();
    this.texture = null;
  }
}

/** The exterior grid over `bounds`, lit by the rig's hemisphere and fill. */
export function createExteriorGrid(lights: ExteriorLights, bounds: Box): LightProbeGridWebGL {
  const size = 2;
  const box = toBox3(bounds);
  const extent = box.getSize(new THREE.Vector3());
  const grid = new ExteriorGrid(extent.x, extent.y, extent.z, size, size, size);
  grid.name = 'walk-grid-exterior';
  box.getCenter(grid.position);
  grid.boundingBox = new SelectionBox(null);
  grid.updateBoundingBox();
  const atlas = packAtlas(exteriorSH(lights), size);
  const halves = new Uint16Array(atlas.data.length);
  for (let i = 0; i < atlas.data.length; i += 1) halves[i] = THREE.DataUtils.toHalfFloat(atlas.data[i]!);
  const texture = new THREE.Data3DTexture(halves, atlas.width, atlas.height, atlas.depth);
  texture.type = THREE.HalfFloatType;
  texture.format = THREE.RGBAFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  grid.texture = texture;
  return grid;
}

/**
 * What a click on a door selects, on a really built shell: the two-room box
 * with an entrance in its 0.30 facade and a door in its 0.10 partition.
 *
 * The picks are real raycasts against `SceneBuilder`'s output, registered the
 * way `app/scene-mount.ts` registers it, through the two cameras a selection
 * is cast with: the plan modes' top view (an orthographic camera straight
 * down, `ui/plan-modes.ts`'s `fitTopView`) and an orbit camera above the
 * facade. From above, the wall standing over a door (its lintel, up to the
 * ceiling) is the first thing every ray meets, so the door has to own that
 * part of the wall's top for a click on it to name the door.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from './scene-builder.js';
import { Picker, type SurfacePick } from './picker.js';
import { solvePlan } from '../plan/plan-solver.js';
import { TWO_ROOM_ENTRANCE, twoRoomEntrancePlan } from '../fixtures/plan-two-room-entrance.js';

const RECT = { left: 0, top: 0, width: 800, height: 500 };
const O = TWO_ROOM_ENTRANCE.opening;
const W = TWO_ROOM_ENTRANCE.wall;

function builtPicker(): { picker: Picker; dispose: () => void } {
  const builder = new SceneBuilder(twoRoomEntrancePlan, solvePlan(twoRoomEntrancePlan));
  const built = builder.build();
  built.root.updateMatrixWorld(true);
  const picker = new Picker({ getBoundingClientRect: () => RECT });
  picker.register(built.root, () => false);
  return { picker, dispose: () => builder.dispose() };
}

/** The plan modes' top view over the whole box: north up, looking straight down. */
function topView(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-5, 5, 3.125, -3.125, 0.1, 100);
  camera.position.set(4, 40, 2.5);
  camera.up.set(0, 0, -1);
  camera.lookAt(4, 0, 2.5);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/** An orbit camera high over the south facade, looking down at the box. */
function orbitView(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 100);
  camera.position.set(4, 9, -6);
  camera.lookAt(4, 0, 2.5);
  camera.updateMatrixWorld(true);
  return camera;
}

/** What a click on the pixel showing plan point `(x, z)` at `y` picks. */
function pickAt(picker: Picker, camera: THREE.Camera, x: number, z: number, y = 0): SurfacePick | null {
  const ndc = new THREE.Vector3(x, y, z).project(camera);
  const clientX = ((ndc.x + 1) / 2) * RECT.width;
  const clientY = ((1 - ndc.y) / 2) * RECT.height;
  return picker.pickSurface(clientX, clientY, camera);
}

describe('a click on a door names the door, beside it the wall', () => {
  for (const [name, camera] of [
    ['the top view', topView],
    ['an orbit view', orbitView],
  ] as const) {
    test(`${name}: the entrance door in the facade, across the wall's thickness`, () => {
      const { picker, dispose } = builtPicker();
      // The wall is 0.30 thick: its faces are at z = -0.15 and z = 0.15.
      for (const z of [0, 0.05, 0.12, -0.12]) {
        expect(pickAt(picker, camera(), 1.2, z, 2.7)).toMatchObject({ surface: 'opening', openingId: O.entrance, wallId: W.livingSouth });
      }
      dispose();
    });

    test(`${name}: the partition door`, () => {
      const { picker, dispose } = builtPicker();
      expect(pickAt(picker, camera(), 4, 2.6, 2.7)).toMatchObject({ surface: 'opening', openingId: O.inner, wallId: W.partition });
      dispose();
    });

    test(`${name}: the facade wall beside the entrance is still the wall`, () => {
      const { picker, dispose } = builtPicker();
      for (const x of [0.5, 2.5]) {
        expect(pickAt(picker, camera(), x, 0, 2.7)).toMatchObject({ surface: 'wall', wallId: W.livingSouth });
      }
      dispose();
    });
  }
});

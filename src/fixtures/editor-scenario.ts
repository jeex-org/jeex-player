/**
 * The two pieces of material an editor host's end-to-end scenario starts
 * from: an empty shell and a project's own object library.
 *
 * `emptyShell` is the "box" an editor begins with — four nodes, four walls, one
 * room, one camera, a one-leg tour — and nothing else. Every room, opening,
 * finish, placement and camera the scenario ends with is put there by
 * OPERATIONS, which is the whole point: it proves the vocabulary can build a
 * flat rather than only edit one.
 *
 * `fixtureProjectLibrary` is a `ProjectLibrary` in the shape
 * `registriesFromLibrary` takes: objects with their variants,
 * and materials the library ships as finishes. It is deliberately NOT a slice
 * of the shipped catalogues — a project library whose ids nothing in `assets/`
 * has ever heard of is exactly what a catalogue service hands an editor host, and a
 * scenario that placed the bundled three-seat sofa would prove nothing about
 * libraries. Its ids are the literals of `editor-scenario-ids.ts`.
 *
 * Pure data: no `three`, no DOM.
 */

import type { ProjectLibrary } from '../scene/registries.js';
import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';
import { EDITOR } from './editor-scenario-ids.js';

const { library: LIBRARY } = EDITOR;

/**
 * A project's own bank: two archetypes with variants, four finishes.
 *
 * The first material is a FLOOR finish on purpose — `registriesFromLibrary`
 * makes it the library's `defaultFloorFinish`, which is what `add_room` writes
 * when the editor names none.
 */
export const fixtureProjectLibrary: ProjectLibrary = {
  id: LIBRARY.project,
  objects: [
    {
      id: LIBRARY.object.sofaLib,
      defaultVariant: LIBRARY.variant.sofaLibLinen,
      variants: [{ id: LIBRARY.variant.sofaLibLinen }, { id: LIBRARY.variant.sofaLibWool }],
      anchor: 'floor',
    },
    { id: LIBRARY.object.tableLib, defaultVariant: LIBRARY.variant.tableLibOak, variants: [{ id: LIBRARY.variant.tableLibOak }] },
    {
      id: LIBRARY.object.sconceLib,
      defaultVariant: LIBRARY.variant.sconceLibBrass,
      variants: [{ id: LIBRARY.variant.sconceLibBrass }],
      anchor: 'wall',
    },
  ],
  materials: [
    { id: LIBRARY.material.libOak, apply: ['floor'] },
    { id: LIBRARY.material.libTerrazzo, apply: ['floor'] },
    { id: LIBRARY.material.libChalk, apply: ['wall'] },
    { id: LIBRARY.material.libLinen, apply: ['fabric'] },
  ],
};

/**
 * The empty shell: an 8.00 x 6.00 m box, 2.70 m high, one room called Space.
 *
 * The four walls meet at the four corners, so the graph has exactly one inner
 * face and the solver gives the one room its outline. The autotour is the
 * shortest legal one (two points) because `SceneData.autotour` is not optional
 * and `set_autotour` is one of the operations the scenario runs — starting from
 * a tour that says nothing lets the assertion at the end be about the op.
 */
export const emptyShell: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: EDITOR.scene,
  name: 'Empty shell',
  ceilingHeight: 2.7,
  nodes: [
    { id: EDITOR.node.cNw, p: { x: 0, z: 0 } },
    { id: EDITOR.node.cNe, p: { x: 8, z: 0 } },
    { id: EDITOR.node.cSe, p: { x: 8, z: 6 } },
    { id: EDITOR.node.cSw, p: { x: 0, z: 6 } },
  ],
  walls: [
    { id: EDITOR.wall.wallN, a: EDITOR.node.cNw, b: EDITOR.node.cNe, thickness: 0.3, role: 'facade' },
    { id: EDITOR.wall.wallE, a: EDITOR.node.cNe, b: EDITOR.node.cSe, thickness: 0.3, role: 'facade' },
    { id: EDITOR.wall.wallS, a: EDITOR.node.cSe, b: EDITOR.node.cSw, thickness: 0.3, role: 'facade' },
    { id: EDITOR.wall.wallW, a: EDITOR.node.cSw, b: EDITOR.node.cNw, thickness: 0.3, role: 'facade' },
  ],
  rooms: [{ id: EDITOR.room.space, name: 'Space', anchor: { x: 4, z: 3 }, floorMaterial: FINISH.oak }],
  assets: [],
  presentationCamera: { position: { x: 4, y: 8, z: 14 }, target: { x: 4, y: 1, z: 3 } },
  roomCameras: {},
  navigation: { points: [{ x: 4, y: 0, z: 3 }] },
  autotour: {
    speed: 1.2,
    path: [
      { x: 2, y: 1.6, z: 3 },
      { x: 6, y: 1.6, z: 3 },
    ],
    gaze: [],
  },
};

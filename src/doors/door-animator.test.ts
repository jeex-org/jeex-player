/**
 * The leaf `userData` contract and the animator that drives it.
 *
 * The contract is asserted on leaves the real `OpeningBuilder` produced (over
 * the L-shape fixture), because the whole point of recording `restAngle` and
 * friends is that no other module has to re-derive a swing.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { SceneBuilder } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { OPENING_VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import { DOOR_ANIMATION_MS, DoorStates } from './door-state.js';
import { DoorAnimator, applyToLeaf, doorLeafCentre, doorLeavesOf } from './door-animator.js';
import { LEAF_REST_ANGLE_RAD } from '../plan/door-swing.js';
import { DOOR_VARIANTS, type OpeningVariant } from '../assets/opening-variants.js';
import type { SceneData } from '../scene/types.js';

function build(scene: SceneData = lShapePlan): { builder: SceneBuilder; root: THREE.Group } {
  const plan = solvePlan(scene);
  const builder = new SceneBuilder(scene, plan);
  const { root } = builder.build();
  return { builder, root };
}

/** The interior door of the fixture; `doorEntry` is the entrance one. */
const DOOR = L_SHAPE.opening.doorAb;

/** Ids this file invents: a sliding door variant the bank does not ship, and an opening no scene has. */
const ID = {
  slidingVariant: '01a12ffa-7379-79cc-aaf3-102454248bd9',
  unknownOpening: '01a12ffa-737a-7ce9-b48c-8a395c0524a6',
} as const;

describe('hinged leaves', () => {
  test('every leaf records its rest angle and its signs', () => {
    const { builder } = build();
    for (const id of [DOOR, L_SHAPE.opening.doorEntry]) {
      const leaves = doorLeavesOf(builder.getOpeningGroup(id)!);
      expect(leaves.length).toBe(1);
      const data = leaves[0]!.userData;
      expect(Math.abs(data['restAngle'] as number)).toBeCloseTo(LEAF_REST_ANGLE_RAD, 10);
      expect(Math.abs(data['hingeSign'] as number)).toBe(1);
      expect(Math.abs(data['openSign'] as number)).toBe(1);
      // Built open: the rest angle is the pose on screen.
      expect(leaves[0]!.rotation.y).toBeCloseTo(data['restAngle'] as number, 10);
      expect(data['slide']).toBeUndefined();
    }
  });

  test('a window has no leaf to record anything on', () => {
    const { builder } = build();
    expect(doorLeavesOf(builder.getOpeningGroup(L_SHAPE.opening.windowASouth)!)).toEqual([]);
  });
});

describe('double leaves', () => {
  test('two leaves with opposite signs, meeting in the middle when shut', () => {
    const { builder } = build();
    expect(builder.rebuildOpening(DOOR, OPENING_VARIANT.door_white_double)).toBe(true);
    const leaves = doorLeavesOf(builder.getOpeningGroup(DOOR)!);
    expect(leaves.length).toBe(2);
    const [first, second] = leaves as [THREE.Object3D, THREE.Object3D];
    expect(first.userData['hingeSign']).toBe(-second.userData['hingeSign']);
    expect(first.userData['restAngle']).toBeCloseTo(-(second.userData['restAngle'] as number), 10);
    expect(first.userData['openSign']).toBe(second.userData['openSign']);

    // The fixture's partition runs along z at x = 6: shut, both leaves lie IN
    // the wall plane (a leaf thickness across x); open, they stand out of it.
    const spanX = (): number => {
      const box = new THREE.Box3();
      for (const leaf of leaves) {
        leaf.updateWorldMatrix(true, true);
        box.union(new THREE.Box3().setFromObject(leaf));
      }
      return box.getSize(new THREE.Vector3()).x;
    };
    for (const leaf of leaves) applyToLeaf(leaf, 1);
    const openSpan = spanX();
    for (const leaf of leaves) applyToLeaf(leaf, 0);
    // Shut: a leaf thickness plus the handles that stand off it, no more.
    expect(spanX()).toBeLessThan(0.2);
    expect(openSpan).toBeGreaterThan(0.3);
  });
});

describe('sliding leaves', () => {
  /**
   * The bank has no sliding door today, so the branch is covered by putting one
   * at the head of the interior set — that is what `defaultOpeningVariant`
   * hands out — and taking it away again.
   */
  const sliding: OpeningVariant = {
    id: ID.slidingVariant,
    slug: 'test-door-sliding',
    name: 'Sliding, test only',
    for: 'door',
    frame: { material: FINISH.white, width: 0.06, depth: 0.1 },
    leaf: { style: 'sliding', material: FINISH.white, handle: 'bar' },
    preview: { base: '#fff' },
  };

  beforeAll(() => {
    DOOR_VARIANTS.unshift(sliding);
  });
  afterAll(() => {
    DOOR_VARIANTS.shift();
  });

  test('the leaf carries its open offset and its shut position', () => {
    const { builder } = build();
    const leaves = doorLeavesOf(builder.getOpeningGroup(DOOR)!);
    expect(leaves.length).toBe(1);
    const leaf = leaves[0]!;
    const slide = leaf.userData['slide'] as { x: number; y: number; z: number };
    const base = leaf.userData['slideBase'] as { x: number; y: number; z: number };
    expect(Math.abs(slide.x)).toBeGreaterThan(0.5);
    expect(slide.y).toBe(0);
    expect(slide.z).toBe(0);
    expect(leaf.userData['restAngle']).toBe(0);
    // Built parked beside the opening (t = 1) and shut by `applyToLeaf(0)`.
    expect(leaf.position.x).toBeCloseTo(base.x + slide.x, 10);
    applyToLeaf(leaf, 0);
    expect(leaf.position.x).toBeCloseTo(base.x, 10);
    expect(leaf.rotation.y).toBe(0);
    applyToLeaf(leaf, 1);
    expect(leaf.position.x).toBeCloseTo(base.x + slide.x, 10);
  });
});

describe('DoorAnimator', () => {
  function harness(tourActive = false) {
    const { builder } = build();
    const ids = builder
      .openingsList()
      .filter((entry) => entry.type === 'door')
      .map((entry) => entry.id);
    const states = new DoorStates(ids);
    const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
    let tour = tourActive;
    const animator = new DoorAnimator({
      states,
      group: (id) => builder.getOpeningGroup(id),
      doors: () => builder.openingsList().filter((entry) => entry.type === 'door'),
      camera: () => camera,
      scriptedCamera: () => tour,
    });
    return {
      builder,
      states,
      animator,
      camera,
      ids,
      setTour: (value: boolean) => {
        tour = value;
      },
    };
  }

  function leafAngle(builder: SceneBuilder, id: string): number {
    return doorLeavesOf(builder.getOpeningGroup(id)!)[0]!.rotation.y;
  }

  test('a closing door swings its leaf towards zero and back', () => {
    const { builder, states, animator } = harness();
    const open = leafAngle(builder, DOOR);
    states.close(DOOR, 0);
    animator.update(DOOR_ANIMATION_MS / 2);
    const half = leafAngle(builder, DOOR);
    expect(Math.abs(half)).toBeLessThan(Math.abs(open));
    expect(Math.abs(half)).toBeGreaterThan(0);
    animator.update(DOOR_ANIMATION_MS);
    expect(leafAngle(builder, DOOR)).toBeCloseTo(0, 10);

    states.open(DOOR, DOOR_ANIMATION_MS);
    animator.update(2 * DOOR_ANIMATION_MS);
    expect(leafAngle(builder, DOOR)).toBeCloseTo(open, 10);
  });

  test('reports a moved leaf on every frame of a motion and its final pose, then nothing', () => {
    const { states, animator } = harness();
    animator.takeMoved();
    states.close(DOOR, 0);
    const frames: boolean[] = [];
    for (const now of [
      DOOR_ANIMATION_MS / 3,
      (2 * DOOR_ANIMATION_MS) / 3,
      DOOR_ANIMATION_MS,
      2 * DOOR_ANIMATION_MS,
      3 * DOOR_ANIMATION_MS,
    ]) {
      animator.update(now);
      frames.push(animator.takeMoved());
    }
    expect(frames).toEqual([true, true, true, false, false]);
  });

  test('applyAll re-shuts a door whose group was rebuilt behind its back', () => {
    const { builder, states, animator } = harness();
    states.close(DOOR, 0);
    animator.update(DOOR_ANIMATION_MS);
    expect(leafAngle(builder, DOOR)).toBeCloseTo(0, 10);

    // A variant swap builds a brand-new group, with its leaf open again.
    expect(builder.rebuildOpening(DOOR, OPENING_VARIANT.door_oak_panelled_knob)).toBe(true);
    expect(leafAngle(builder, DOOR)).not.toBe(0);
    animator.applyAll();
    expect(leafAngle(builder, DOOR)).toBeCloseTo(0, 10);
  });

  test('an unknown or leafless opening is a no-op, never a throw', () => {
    const { animator } = harness();
    expect(() => animator.apply(ID.unknownOpening)).not.toThrow();
    expect(() => animator.apply(L_SHAPE.opening.windowASouth)).not.toThrow();
  });

  test('the tour opens a shut door it is walking up to, and leaves the rest alone', () => {
    const { builder, states, animator, camera, setTour } = harness();
    const target = builder.openingsList().find((entry) => entry.id === DOOR)!;
    for (const id of states.list().map((door) => door.id)) states.close(id, 0);
    animator.update(DOOR_ANIMATION_MS);
    expect(states.get(DOOR)!.phase).toBe('closed');

    setTour(true);
    // 1.2 m short of the door, looking at it.
    const centre = new THREE.Vector3(target.center.x, 1.65, target.center.z);
    camera.position.set(centre.x - 1.2, 1.65, centre.z);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    animator.update(DOOR_ANIMATION_MS + 16);
    expect(states.get(DOOR)!.phase).toBe('opening');
    expect(states.get(L_SHAPE.opening.doorEntry)!.phase).toBe('closed');
  });

  test("a door latched in the camera's face is not pushed back open", () => {
    // The failure this pins: with `doors.autoOpen: false` the user
    // shuts a door on a running route and the scripted fallback opens it again
    // a frame later, walking the camera through the decision it just made.
    const { builder, states, animator, camera, setTour } = harness();
    const target = builder.openingsList().find((entry) => entry.id === DOOR)!;
    const centre = new THREE.Vector3(target.center.x, 1.65, target.center.z);
    setTour(true);
    camera.position.set(centre.x - 1.2, 1.65, centre.z);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);

    states.close(DOOR, 0);
    animator.update(DOOR_ANIMATION_MS);
    expect(states.get(DOOR)!).toMatchObject({ phase: 'closed', armed: false });
    animator.update(DOOR_ANIMATION_MS + 16);
    expect(states.get(DOOR)!.phase).toBe('closed');
  });

  test('a latch the scripted camera has left behind expires on the close radius', () => {
    // The other half of the same rule: without it every door ever shut in an
    // `autoOpen: false` session would stay latched for good and the fallback
    // would have nothing left to open.
    const { builder, states, animator, camera, setTour } = harness();
    const target = builder.openingsList().find((entry) => entry.id === DOOR)!;
    const centre = new THREE.Vector3(target.center.x, 1.65, target.center.z);
    setTour(true);
    camera.position.set(centre.x - 1.2, 1.65, centre.z);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    states.close(DOOR, 0);
    animator.update(DOOR_ANIMATION_MS);

    // Away, past `DOOR_AUTO_CLOSE_M`: the decision is behind the walker now.
    camera.position.set(centre.x - 4, 1.65, centre.z);
    camera.updateMatrixWorld(true);
    animator.update(DOOR_ANIMATION_MS + 16);
    expect(states.get(DOOR)!).toMatchObject({ phase: 'closed', armed: true });

    // And back: the fallback opens it on the approach, as it always did.
    camera.position.set(centre.x - 1.2, 1.65, centre.z);
    camera.updateMatrixWorld(true);
    animator.update(DOOR_ANIMATION_MS + 32);
    expect(states.get(DOOR)!.phase).toBe('opening');
  });

  test('with the tour off nothing opens itself', () => {
    const { builder, states, animator, camera } = harness();
    const target = builder.openingsList().find((entry) => entry.id === DOOR)!;
    states.close(DOOR, 0);
    animator.update(DOOR_ANIMATION_MS);
    camera.position.set(target.center.x - 0.5, 1.65, target.center.z);
    camera.lookAt(target.center.x, 1.65, target.center.z);
    camera.updateMatrixWorld(true);
    animator.update(DOOR_ANIMATION_MS + 16);
    expect(states.get(DOOR)!.phase).toBe('closed');
  });
});

describe('DoorAnimator: the proximity automation', () => {
  /** The animator wired the way the composition root wires it, automation on. */
  function harness() {
    const { builder } = build();
    const centres = builder.openingsList().filter((entry) => entry.type === 'door');
    const states = new DoorStates(centres.map((entry) => entry.id));
    const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
    let walker = true;
    const animator = new DoorAnimator({
      states,
      group: (id) => builder.getOpeningGroup(id),
      doors: () => centres,
      camera: () => camera,
      scriptedCamera: () => false,
      autoOpen: () => true,
      walkerCamera: () => walker,
    });
    const centre = centres.find((entry) => entry.id === DOOR)!.center;
    /** Puts the eye `metres` west of the door, looking east at it. */
    const stand = (metres: number): void => {
      camera.position.set(centre.x - metres, 1.65, centre.z);
      camera.lookAt(centre.x, 1.65, centre.z);
      camera.updateMatrixWorld(true);
    };
    return {
      builder,
      states,
      animator,
      camera,
      centre,
      stand,
      setWalker: (value: boolean) => {
        walker = value;
      },
    };
  }

  /** Shuts a door the way the scene or the user does, from far away. */
  function shutFromAfar(states: DoorStates, animator: DoorAnimator, id: string, from = 0): number {
    states.close(id, from);
    states.release(id, from);
    animator.update(from + DOOR_ANIMATION_MS);
    expect(states.get(id)!.phase).toBe('closed');
    return from + DOOR_ANIMATION_MS;
  }

  test('a rest-closed door opens as the walker arrives and shuts once they have left', () => {
    const { states, animator, stand } = harness();
    let now = shutFromAfar(states, animator, DOOR);

    stand(1.5);
    animator.update((now += 16));
    expect(states.get(DOOR)).toMatchObject({ phase: 'opening', rest: 'closed', auto: true });
    animator.update((now += DOOR_ANIMATION_MS));
    expect(states.get(DOOR)!.phase).toBe('open');

    // Three metres past it: the automation gives the leaf back to its rest.
    stand(-3);
    animator.update((now += 16));
    expect(states.get(DOOR)!.phase).toBe('closing');
    animator.update((now += DOOR_ANIMATION_MS));
    expect(states.get(DOOR)).toMatchObject({ phase: 'closed', rest: 'closed', auto: false, armed: true });
  });

  test('an open door is never shut by walking away', () => {
    const { states, animator, stand } = harness();
    stand(1.2);
    animator.update(16);
    stand(-4);
    animator.update(32 + DOOR_ANIMATION_MS);
    expect(states.get(DOOR)).toMatchObject({ phase: 'open', t: 1, rest: 'open' });
  });

  test('nothing opens itself under the 360 camera', () => {
    const { states, animator, stand, setWalker } = harness();
    const now = shutFromAfar(states, animator, DOOR);
    setWalker(false);
    stand(1.2);
    animator.update(now + 16);
    expect(states.get(DOOR)!.phase).toBe('closed');
  });

  test('a door shut by hand where the walker stands stays shut until they leave', () => {
    const { states, animator, stand } = harness();
    let now = shutFromAfar(states, animator, DOOR);
    stand(1.4);
    animator.update((now += 16));
    animator.update((now += DOOR_ANIMATION_MS));
    expect(states.get(DOOR)!.phase).toBe('open');

    // The HUD click, taken from where the walker is standing.
    states.toggle(DOOR, now);
    animator.update((now += DOOR_ANIMATION_MS));
    expect(states.get(DOOR)!.phase).toBe('closed');
    // Still standing there: the automation does not undo the decision.
    animator.update((now += 16));
    expect(states.get(DOOR)!.phase).toBe('closed');

    // Away and back: it opens again.
    stand(4);
    animator.update((now += 16));
    stand(1.4);
    animator.update((now += 16));
    expect(states.get(DOOR)!.phase).toBe('opening');
  });
});

describe('doorLeafCentre', () => {
  test('answers the world centre of the leaves, and null without any', () => {
    const { builder } = build();
    const centre = doorLeafCentre(builder.getOpeningGroup(DOOR)!)!;
    expect(centre).not.toBeNull();
    // The fixture's partition wall runs along x = 6, its door `doorAb` at t = 2.5.
    expect(centre.x).toBeCloseTo(6, 0);
    expect(centre.y).toBeGreaterThan(0.5);
    expect(centre.y).toBeLessThan(2.2);
    expect(doorLeafCentre(builder.getOpeningGroup(L_SHAPE.opening.windowASouth)!)).toBeNull();
  });
});

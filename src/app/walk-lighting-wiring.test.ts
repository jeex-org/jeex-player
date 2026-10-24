import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { volumeInput } from './walk-lighting-wiring.js';
import { SceneModel } from '../scene/scene-model.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { apartmentScene } from '../demo/scene-data.js';
import { roomVolumes } from '../render/walk-lighting/room-volumes.js';
import { FURNITURE_GROUP_NAME } from '../geometry/scene-builder.js';

describe('volumeInput on the demo apartment', () => {
  test("each selection side stops at its own wall's centreline: 0.3 m facades, 0.1 m partitions", () => {
    const model = SceneModel.load(apartmentScene, CATALOGUE_REGISTRIES);
    const result = roomVolumes(volumeInput(model, new THREE.Group()));
    if (!result.ok) throw new Error(result.error);
    const bathroom = model.plan.rooms.find((room) => room.roomId === '01a15f1b-dbbd-7630-93f2-2522489e6e62')!;
    const box = result.volumes.boxes.find((candidate) => candidate.roomId === bathroom.roomId)!;
    // The bathroom spans x 4.45..6.75 between two partitions, z 0.15 from the facade.
    expect(box.selection.min.x).toBeCloseTo(4.4, 6);
    expect(box.selection.max.x).toBeCloseTo(6.8, 6);
    expect(box.selection.min.z).toBeCloseTo(0, 6);
  });
});

describe('volumeInput furniture', () => {
  test('carries each furniture item’s height span with its plan rectangle', () => {
    const model = SceneModel.load(apartmentScene, CATALOGUE_REGISTRIES);
    const root = new THREE.Group();
    const group = new THREE.Group();
    group.name = FURNITURE_GROUP_NAME;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 0.4));
    lamp.position.set(2, 0.85, 7);
    group.add(lamp);
    root.add(group);
    root.updateMatrixWorld(true);
    const [box] = volumeInput(model, root).furniture;
    expect(box).toEqual({ minX: 1.8, maxX: 2.2, minY: 0, maxY: 1.7, minZ: 6.8, maxZ: 7.2 });
  });
});

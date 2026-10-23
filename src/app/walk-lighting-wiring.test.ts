import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { volumeInput } from './walk-lighting-wiring.js';
import { SceneModel } from '../scene/scene-model.js';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { apartmentScene } from '../demo/scene-data.js';
import { roomVolumes } from '../render/walk-lighting/room-volumes.js';

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

import { describe, expect, test } from 'bun:test';
import { z } from 'zod/mini';
import { provenanceFor } from './provenance.js';
import { provenanceSchema } from './provenance.schema.js';
import { VIEWER_VERSION } from '../shared/version.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';

/** A scene id that is not the demo's, for the forged sidecar. */
const FOREIGN_SCENE = '01a12ffa-e528-78d3-b98c-0195a8b1b6ec';

describe('provenanceFor', () => {
  test('fills every required field of the sidecar', () => {
    const provenance = provenanceFor(apartmentScene, 7, 'still', 'current');
    expect(provenance.generator).toBe('jeex-viewer');
    expect(provenance.version).toBe(VIEWER_VERSION);
    expect(provenance.sceneId).toBe(apartmentScene.id);
    expect(provenance.rev).toBe(7);
    expect(provenance.schemaVersion).toBe(apartmentScene.schemaVersion);
    expect(provenance.kind).toBe('still');
    expect(provenance.state).toBe('current');
  });

  test('the disclosure is a constant: a JEEX artefact is never a photograph', () => {
    for (const kind of ['still', 'panorama', 'plan', 'frame'] as const) {
      expect(provenanceFor(apartmentScene, 0, kind, 'default').disclosure).toBe('rendered-3d');
    }
  });

  test('createdAt is a valid ISO 8601 instant', () => {
    const { createdAt } = provenanceFor(apartmentScene, 0, 'still', 'current');
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
  });

  test('the camera and the room are what a caller may add', () => {
    const camera = apartmentScene.presentationCamera;
    expect(provenanceFor(apartmentScene, 1, 'still', 'current', { camera }).camera).toEqual(camera);
    expect(provenanceFor(apartmentScene, 1, 'panorama', 'current', { roomId: DEMO.room.living }).roomId).toBe(DEMO.room.living);
  });

  test('what the sidecar decides cannot be overridden by a caller', () => {
    const forged = provenanceFor(apartmentScene, 2, 'still', 'current', {
      generator: 'jeex-viewer',
      sceneId: FOREIGN_SCENE,
      rev: 99,
      state: 'default',
    });
    expect(forged.sceneId).toBe(apartmentScene.id);
    expect(forged.rev).toBe(2);
    expect(forged.state).toBe('current');
  });

  test('it is structured-cloneable, because it crosses the frame boundary beside the PNG', () => {
    const provenance = provenanceFor(apartmentScene, 3, 'panorama', 'default', { roomId: DEMO.room.living });
    expect(structuredClone(provenance)).toEqual(provenance);
  });

  test('the sidecar passes its own compile-time contract (`provenance.schema.ts`)', () => {
    const provenance = provenanceFor(apartmentScene, 4, 'still', 'current');
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(true);
  });
});

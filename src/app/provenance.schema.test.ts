import { describe, expect, test } from 'bun:test';
import { z } from 'zod/mini';
import { provenanceSchema } from './provenance.schema.js';
import { provenanceFor, type Provenance } from './provenance.js';
import { apartmentScene } from '../demo/scene-data.js';
import { DEMO } from '../demo/demo-ids.js';

describe('provenanceSchema', () => {
  test('a real provenanceFor() output passes', () => {
    const provenance = provenanceFor(apartmentScene, 3, 'still', 'current');
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(true);
  });

  test('every kind and every state provenanceFor can produce passes', () => {
    for (const kind of ['still', 'panorama', 'plan', 'frame'] as const) {
      for (const state of ['current', 'default'] as const) {
        const provenance = provenanceFor(apartmentScene, 1, kind, state);
        expect({ kind, state, ok: z.safeParse(provenanceSchema, provenance).success }).toEqual({ kind, state, ok: true });
      }
    }
  });

  test('with a camera and a room id, still passes', () => {
    const provenance = provenanceFor(apartmentScene, 2, 'panorama', 'current', {
      camera: apartmentScene.presentationCamera,
      roomId: DEMO.room.living,
    });
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(true);
  });

  test('the scene and the room are named by UUID: a readable id is refused', () => {
    const provenance = provenanceFor(apartmentScene, 2, 'panorama', 'current', { roomId: 'living' });
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(false);
    const named = { ...provenanceFor(apartmentScene, 0, 'still', 'current'), sceneId: 'apartment' };
    expect(z.safeParse(provenanceSchema, named).success).toBe(false);
  });

  test('kind is a closed set: "video" is refused', () => {
    const provenance = provenanceFor(apartmentScene, 0, 'still', 'current') as unknown as Record<string, unknown>;
    provenance['kind'] = 'video';
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(false);
  });

  test('disclosure is a literal by contract: "photo" is refused even though provenanceFor never produces it', () => {
    const provenance = provenanceFor(apartmentScene, 0, 'still', 'current') as unknown as Record<string, unknown>;
    provenance['disclosure'] = 'photo';
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(false);
  });

  test('createdAt must parse as an instant: "yesterday" is refused', () => {
    const provenance = provenanceFor(apartmentScene, 0, 'still', 'current') as unknown as Record<string, unknown>;
    provenance['createdAt'] = 'yesterday';
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(false);
  });

  test('schemaVersion is the scene schema\'s own closed set: "1.3" is refused', () => {
    const provenance = provenanceFor(apartmentScene, 0, 'still', 'current') as unknown as Record<string, unknown>;
    provenance['schemaVersion'] = '1.3';
    expect(z.safeParse(provenanceSchema, provenance).success).toBe(false);
  });

  /**
   * `Provenance` is produced and never accepted (`app/provenance.ts` module
   * header): this is a compile-time contract, not a
   * runtime guard — a drift fails `tsc`, not the assertion.
   */
  test('the schema and Provenance type-check as the same shape', () => {
    type SchemaShape = z.infer<typeof provenanceSchema>;
    type BothWays = SchemaShape extends Provenance ? (Provenance extends SchemaShape ? true : false) : false;
    const agree: BothWays = true;
    expect(agree).toBe(true);
  });
});

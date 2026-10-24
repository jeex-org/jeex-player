/**
 * The light-bake sidecar boundary: the calibration fixture passes as it is,
 * and every contract the player does not know, every broken reference and
 * every id that is not a UUID v7 is refused with a sentence naming it.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { z } from 'zod/mini';
import type { LightBake } from './light-bake.js';
import { judgeLightBake, lightBakeSchema } from './light-bake.schema.js';

const FIXTURE = new URL('../../tests/fixtures/lightmap-calibration/sidecar.json', import.meta.url);
const fixture = (): Record<string, unknown> => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;

/** A deep copy of the fixture with one edit applied. */
function edited(edit: (doc: any) => void): unknown {
  const doc = fixture();
  edit(doc);
  return doc;
}

function refusal(input: unknown): string {
  const verdict = judgeLightBake(input);
  if (verdict.ok) throw new Error('expected a refusal');
  return verdict.message;
}

describe('judgeLightBake', () => {
  test('accepts the calibration bake unchanged', () => {
    const doc = fixture();
    const verdict = judgeLightBake(doc);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.value).toBe(doc as never);
      expect(verdict.value.bindings).toHaveLength(7);
      expect(verdict.value.lamps).toEqual([{ id: '01a16825-acf5-7011-8f24-6e96e2c80636' }]);
    }
  });

  test('refuses a contract the player does not know, naming the field', () => {
    expect(refusal(edited((d) => (d.contract.uv.channel = 0)))).toContain('contract.uv.channel');
    expect(refusal(edited((d) => (d.contract.rows = 'bottom-up')))).toContain('contract.rows');
    expect(refusal(edited((d) => (d.contract.encoding.kind = 'rgbe')))).toContain('contract.encoding.kind');
    expect(refusal(edited((d) => (d.contract.upload.colorSpace = 'srgb')))).toContain('contract.upload.colorSpace');
    expect(refusal(edited((d) => (d.contract.upload.flipY = true)))).toContain('contract.upload.flipY');
    expect(refusal(edited((d) => (d.contract.intensity = 0)))).toContain('contract.intensity');
    expect(refusal(edited((d) => (d.contract.extra = 1)))).toContain('contract.extra');
  });

  test('refuses another format and an unknown top-level key', () => {
    expect(refusal(edited((d) => (d.format = 2)))).toContain('format');
    expect(refusal(edited((d) => (d.probes = [])))).toContain('probes');
  });

  test('refuses ids that are not UUID v7, and lamps or nodes listed twice', () => {
    expect(refusal(edited((d) => (d.bakeId = 'bake-1')))).toContain('bakeId');
    expect(refusal(edited((d) => (d.bindings[0].node = 'wall-face')))).toContain('bindings.0.node');
    expect(refusal(edited((d) => (d.lamps = [{ id: 'lamp' }])))).toContain('lamps.0.id');
    expect(refusal(edited((d) => d.bindings.push({ ...d.bindings[0] })))).toContain('bound twice');
    expect(refusal(edited((d) => d.lamps.push({ ...d.lamps[0] })))).toContain('listed twice');
  });

  test('refuses a sidecar without the list of baked lamps', () => {
    expect(refusal(edited((d) => delete d.lamps))).toContain('lamps');
  });

  test('refuses broken references inside the bake', () => {
    expect(refusal(edited((d) => (d.bindings[0].page = 3)))).toContain('page 3 does not exist');
    expect(refusal(edited((d) => (d.bindings[0].rect.x = 500)))).toContain('the rect leaves page 0');
    expect(refusal(edited((d) => d.pages[0].webp.pop()))).toContain('9 level files for 10 levels');
    expect(refusal(edited((d) => (d.contract.mips.lodLimit = 10)))).toContain('has no level 10');
    expect(refusal(edited((d) => (d.pages[0].levels = 11)))).toContain('pages.0.levels');
  });

  test('refuses a level file that names a path instead of a file next to the sidecar', () => {
    for (const name of ['../secret.webp', '/abs.webp', 'https://x.test/a.webp', 'dir/a.webp']) {
      expect(refusal(edited((d) => (d.pages[0].webp[0] = name)))).toContain('pages.0.webp.0');
    }
  });

  test('refuses a live policy the player does not implement', () => {
    expect(refusal(edited((d) => d.contract.live.disable.pop()))).toContain('contract.live.disable');
    expect(refusal(edited((d) => d.contract.live.keep.push('lamp diffuse')))).toContain('contract.live.keep');
    expect(refusal(edited((d) => (d.contract.live.keep = [])))).toContain('contract.live.keep');
    expect(refusal(edited((d) => (d.contract.live.keep = ['direct sun', 'direct sun', 'specular'])))).toContain('contract.live.keep');
    expect(refusal(edited((d) => (d.contract.live.disable[0] = 'lamp diffuse')))).toContain('contract.live.disable');
    expect(judgeLightBake(edited((d) => d.contract.live.disable.reverse())).ok).toBe(true);
  });

  test('refuses a sun that is not a unit direction or has a negative colour', () => {
    expect(refusal(edited((d) => (d.sun.direction = [0, 0, 0])))).toContain('sun.direction');
    expect(refusal(edited((d) => (d.sun.direction = [0, -2, 0])))).toContain('sun.direction');
    expect(refusal(edited((d) => (d.sun.color = [1, -0.1, 1])))).toContain('sun.color');
    expect(refusal(edited((d) => (d.sun.strength = -1)))).toContain('sun.strength');
  });

  /** A drift between the schema and `LightBake` fails `tsc`: `BothWays` collapses to `false`. */
  test('the schema and the hand-written type are the same shape', () => {
    type SchemaShape = z.infer<typeof lightBakeSchema>;
    type BothWays = SchemaShape extends LightBake ? (LightBake extends SchemaShape ? true : false) : false;
    const agree: BothWays = true;
    expect(agree).toBe(true);
  });

  test('refuses what is not an object', () => {
    for (const input of [null, 5, 'bake', []]) expect(judgeLightBake(input).ok).toBe(false);
  });
});

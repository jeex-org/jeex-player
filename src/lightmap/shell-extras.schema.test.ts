/**
 * The shell file contract judges the JSON of a shell file: the demo
 * apartment's export passes unchanged, and each rule refuses with a message
 * naming the field.
 */

import { describe, expect, test } from 'bun:test';
import { apartmentScene } from '../demo/scene-data.js';
import { glbJson } from '../fixtures/shell-unwrap.js';
import { judgeShellGltf } from './shell-extras.schema.js';
import { exportShellForBake, SHIPPED_FINISHES } from './shell-export.js';

let n = 0;
const exported = await exportShellForBake(apartmentScene, {
  mintId: () => `01a1e000-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`,
  finishes: SHIPPED_FINISHES,
});
const json = (): Record<string, any> => structuredClone(glbJson(exported.glb)) as Record<string, any>;

function refused(edit: (gltf: Record<string, any>) => void): string {
  const gltf = json();
  edit(gltf);
  const verdict = judgeShellGltf(gltf);
  return verdict.ok ? 'accepted' : verdict.message;
}

describe('judgeShellGltf', () => {
  test('accepts the export of the demo apartment, and passes it on unchanged', () => {
    const gltf = json();
    const verdict = judgeShellGltf(gltf);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.value).toBe(gltf as never);
  });

  test('refuses a node name that is not a UUID v7', () => {
    expect(refused((g) => (g['nodes'][0].name = 'wall-face'))).toContain('nodes.0.name: not a UUID v7');
  });

  test('refuses two nodes with the same name', () => {
    expect(refused((g) => (g['nodes'][1].name = g['nodes'][0].name))).toContain('is used twice');
  });

  test('refuses a mesh named differently from its node', () => {
    expect(refused((g) => (g['meshes'][0].name = '01a1e000-0000-7000-8000-ffffffffffff'))).toContain('differs from its node name');
  });

  test('refuses a node with a transform or children', () => {
    for (const key of ['translation', 'rotation', 'scale', 'matrix', 'children'])
      expect(refused((g) => (g['nodes'][0][key] = [0, 0, 0]))).toContain(`nodes.0.${key}`);
  });

  test('refuses a mesh without TEXCOORD_0, or with two primitives', () => {
    expect(refused((g) => delete g['meshes'][0].primitives[0].attributes.TEXCOORD_0)).toContain('TEXCOORD_0');
    expect(refused((g) => g['meshes'][0].primitives.push(g['meshes'][0].primitives[0]))).toContain('exactly one primitive');
  });

  test('allows `unseen: true` on a floor, wall, skirting or joint part only', () => {
    const first = (kind: string) => json()['nodes'].findIndex((node: any) => node.extras.jeex.kind === kind);
    for (const kind of ['floor', 'wall', 'skirting', 'joint'])
      expect(refused((g) => (g['nodes'][first(kind)].extras.jeex.unseen = true))).toBe('accepted');
    for (const kind of ['ceiling', 'opening', 'site'])
      expect(refused((g) => (g['nodes'][first(kind)].extras.jeex.unseen = true))).toContain('unseen');
    expect(refused((g) => (g['nodes'][first('wall')].extras.jeex.unseen = false))).toContain('unseen');
  });

  test('refuses an unknown kind, an extra contract key and a missing origin', () => {
    expect(refused((g) => (g['nodes'][0].extras.jeex.kind = 'roof'))).toContain('nodes.0.extras.jeex.kind');
    expect(refused((g) => (g['nodes'][0].extras.jeex.colour = 'red'))).toContain('colour');
    expect(refused((g) => delete g['nodes'][0].extras.jeex.origin)).toContain('origin');
  });

  test('refuses a material without its finish value and an asset without its digest', () => {
    expect(refused((g) => delete g['materials'][0].extras.jeex.finish)).toContain('materials.0.extras.jeex.finish');
    expect(refused((g) => (g['asset'].extras.jeex.shellInputsHash = 'abc'))).toContain('not a sha256 digest');
  });

  test('refuses a scene that does not list every node once, in order', () => {
    expect(refused((g) => g['scenes'][0].nodes.reverse())).toContain('in node order');
  });
});

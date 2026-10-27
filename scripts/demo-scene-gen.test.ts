import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apartmentScene } from '../src/demo/scene-data.ts';
import { CATALOGUE_REGISTRIES } from '../src/assets/catalogue-registries.ts';
import { validateScene } from '../src/scene/scene-validator.ts';
import { DEMO_SCENE_FILE, demoSceneText, writeDemoScene } from './demo-scene-gen.ts';

const scratch = mkdtempSync(join(tmpdir(), 'demo-scene-gen-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the published demo scene', () => {
  test('is the demo apartment the player ships, as data', () => {
    expect(JSON.parse(demoSceneText())).toEqual(JSON.parse(JSON.stringify(apartmentScene)));
  });

  test('is a document the validator accepts against the shipped catalogues', () => {
    const quiet = { warn: () => {}, error: () => {} };
    expect(validateScene(JSON.parse(demoSceneText()), CATALOGUE_REGISTRIES, quiet).id).toBe(apartmentScene.id);
  });

  test('is written under its published name, ending in a newline', () => {
    const file = writeDemoScene(scratch);
    expect(file).toBe(join(scratch, DEMO_SCENE_FILE));
    expect(DEMO_SCENE_FILE).toBe('demo-scene.json');
    expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
  });
});

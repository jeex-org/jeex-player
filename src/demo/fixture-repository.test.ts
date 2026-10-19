/**
 * The demo page's own repository: serves the bundled apartment, or whatever
 * fixture map it was built with, and names an unknown reference rather than
 * silently returning nothing.
 */

import { describe, expect, test } from 'bun:test';
import { LocalFixtureRepository } from './fixture-repository.js';
import { apartmentScene } from './scene-data.js';

describe('LocalFixtureRepository', () => {
  test('serves the bundled apartment and names an unknown reference', async () => {
    const repository = new LocalFixtureRepository();
    expect(await repository.load()).toBe(apartmentScene);
    await expect(repository.load('nope')).rejects.toThrow('Unknown scene reference nope');
  });
});

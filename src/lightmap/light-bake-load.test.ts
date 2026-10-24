/**
 * Loading a light bake refuses a bad sidecar and a foreign shell before a
 * single level file is requested. The successful load, which decodes images,
 * is proved in the browser (`tests/component/lightmap-page.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { LightBakeError } from './light-bake-error.js';
import { loadLightBake, sha256Of } from './light-bake-load.js';

const DIR = new URL('../../tests/fixtures/lightmap-calibration/', import.meta.url);
const SIDECAR = new URL('sidecar.json', DIR);
const SHELL = new URL('shell.glb', DIR);

/** Serves the fixture folder, with overrides, and records every request. */
function serve(overrides: Record<string, Uint8Array<ArrayBuffer> | string> = {}): {
  fetchBytes: (url: URL) => Promise<Blob>;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    fetchBytes: async (url) => {
      const name = url.pathname.split('/').at(-1)!;
      asked.push(name);
      const body = overrides[name] ?? new Uint8Array(readFileSync(url));
      return new Blob([body]);
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<LightBakeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LightBakeError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('loadLightBake', () => {
  test('the fixture shell hashes to its sidecar', async () => {
    const bytes = readFileSync(SHELL);
    const sidecar = JSON.parse(readFileSync(SIDECAR, 'utf8')) as { shellHash: string };
    expect(await sha256Of(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(sidecar.shellHash);
  });

  test('refuses a sidecar that is not JSON or not a light bake, before asking for anything else', async () => {
    for (const body of ['{', JSON.stringify({ format: 2 })]) {
      const { fetchBytes, asked } = serve({ 'sidecar.json': body });
      const error = await refusal(loadLightBake(SIDECAR, SHELL, fetchBytes));
      expect(error.reason).toBe('sidecar');
      expect(asked).toEqual(['sidecar.json']);
    }
  });

  test('refuses a shell whose bytes do not hash to shellHash, before any level file', async () => {
    const shell = new Uint8Array(readFileSync(SHELL));
    shell[shell.length - 1] = shell.at(-1)! ^ 1;
    const { fetchBytes, asked } = serve({ 'shell.glb': shell });
    const error = await refusal(loadLightBake(SIDECAR, SHELL, fetchBytes));
    expect(error.reason).toBe('shell');
    expect(error.message).toContain('another shell');
    expect(asked).toEqual(['sidecar.json', 'shell.glb']);
  });

  test('refuses a shell that cannot be fetched as a shell refusal, before any level file', async () => {
    const { fetchBytes: fixture, asked } = serve();
    const fetchBytes = async (url: URL): Promise<Blob> => {
      if (url.pathname.endsWith('shell.glb')) {
        asked.push('shell.glb');
        throw new Error('offline');
      }
      return fixture(url);
    };
    const error = await refusal(loadLightBake(SIDECAR, SHELL, fetchBytes));
    expect(error.reason).toBe('shell');
    expect(asked).toEqual(['sidecar.json', 'shell.glb']);
  });
});

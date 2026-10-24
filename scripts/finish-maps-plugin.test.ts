import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finishMaps, indexedFiles, servedFinishMap } from './finish-maps-plugin.ts';
import { FINISH_MAPS_DIR } from './finish-maps-fetch.ts';

const listed = indexedFiles(FINISH_MAPS_DIR);
const one = [...listed][0]!;

describe('indexedFiles', () => {
  test('lists every map the index records, and nothing else', () => {
    const index = JSON.parse(readFileSync(join(FINISH_MAPS_DIR, 'index.json'), 'utf8')) as {
      versions: { maps: Record<string, { files: Record<string, { path: string }> }> }[];
    };
    const recorded = index.versions.flatMap((version) =>
      Object.values(version.maps).flatMap((map) => Object.values(map.files).map((file) => file.path)),
    );
    expect([...listed].sort()).toEqual(recorded.sort());
  });
});

describe('servedFinishMap', () => {
  test('answers an indexed file under any folder, ignoring query and fragment', () => {
    expect(servedFinishMap(`/src/shared/finish-maps/${one}?v=1#x`, listed)).toEqual({ kind: 'file', path: one });
    expect(servedFinishMap(`/finish-maps/${one}`, listed)).toEqual({ kind: 'file', path: one });
  });

  test('refuses an unlisted name under the folder instead of falling through', () => {
    expect(servedFinishMap('/finish-maps/tex/01a1689e-0000-7000-8000-000000000000/albedo.512.webp', listed)).toEqual({ kind: 'missing' });
    expect(servedFinishMap('/finish-maps/tex/../../package.json', listed)).toEqual({ kind: 'missing' });
  });

  test('ignores everything outside the folder', () => {
    expect(servedFinishMap('/src/main.ts', listed)).toBeNull();
    expect(servedFinishMap('/finish-maps-elsewhere/x.webp', listed)).toBeNull();
  });
});

describe('finishMaps', () => {
  test('emits every indexed file and the source list under the prefix', () => {
    const emitted: { fileName: string; source: Uint8Array | string }[] = [];
    const plugin = finishMaps('assets/');
    (
      plugin.generateBundle as unknown as (this: { emitFile: (file: { fileName: string; source: Uint8Array | string }) => void }) => void
    ).call({
      emitFile: (file) => void emitted.push(file),
    });
    const names = emitted.map((file) => file.fileName).sort();
    expect(names).toEqual([...[...listed].map((path) => `assets/finish-maps/${path}`), 'assets/finish-maps/SOURCES.md'].sort());
    const map = emitted.find((file) => file.fileName === `assets/finish-maps/${one}`)!;
    expect(Buffer.from(map.source as Uint8Array).equals(readFileSync(join(FINISH_MAPS_DIR, one)))).toBe(true);
  });
});

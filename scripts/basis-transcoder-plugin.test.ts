import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  basisTranscoder,
  neutraliseDefaultUrls,
  publishedTranscoderNames,
  servedTranscoderFile,
  transcoderHash,
  transcoderSourceDir,
} from './basis-transcoder-plugin.ts';

const loaderSource = readFileSync(createRequire(import.meta.url).resolve('three/examples/jsm/loaders/KTX2Loader.js'), 'utf8');

describe('neutraliseDefaultUrls', () => {
  test("replaces both default transcoder URLs of the installed KTX2Loader with ''", () => {
    const out = neutraliseDefaultUrls(loaderSource);
    expect(out).not.toContain("basis_transcoder.wasm', import.meta.url");
    expect(out).not.toMatch(/new URL\(\s*'\.\.\/libs\/basis/);
    expect(out).toContain("const WASM_BIN_URL = '';");
    expect(out).toContain("const WASM_JS_URL = '';");
  });

  test('fails naming the plugin when the loader no longer declares them', () => {
    expect(() => neutraliseDefaultUrls('const WASM_BIN_URL = somethingElse;')).toThrow(
      /basis-transcoder: KTX2Loader\.js no longer declares/,
    );
  });
});

describe('published names', () => {
  test('one hash of both files names both, and changes with either', () => {
    const hash = transcoderHash(Buffer.from('js'), Buffer.from('wasm'));
    expect(hash).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(transcoderHash(Buffer.from('js!'), Buffer.from('wasm'))).not.toBe(hash);
    expect(transcoderHash(Buffer.from('js'), Buffer.from('wasm!'))).not.toBe(hash);
    expect(publishedTranscoderNames(hash)).toEqual({
      'basis_transcoder.js': `lazy-jeex-viewer-basis-transcoder-${hash}.js`,
      'basis_transcoder.wasm': `lazy-jeex-viewer-basis-transcoder-${hash}.wasm`,
    });
  });

  test('the installed transcoder files exist where the plugin reads them', () => {
    const dir = transcoderSourceDir();
    expect(readFileSync(`${dir}/basis_transcoder.wasm`).subarray(0, 4)).toEqual(Buffer.from([0, 0x61, 0x73, 0x6d]));
  });
});

describe('servedTranscoderFile', () => {
  test('answers either name under any folder, whatever the hash, ignoring query and fragment', () => {
    expect(servedTranscoderFile('/lazy-jeex-viewer-basis-transcoder-abcdEF12.js')).toBe('basis_transcoder.js');
    expect(servedTranscoderFile('/src/materials/lazy-jeex-viewer-basis-transcoder-dev.wasm?v=1#x')).toBe('basis_transcoder.wasm');
  });

  test('ignores everything else', () => {
    expect(servedTranscoderFile('/basis_transcoder.js')).toBeNull();
    expect(servedTranscoderFile('/lazy-jeex-viewer-basis-transcoder-x.js.map')).toBeNull();
    expect(servedTranscoderFile('/lazy-jeex-viewer-GLTFLoader-abc.js')).toBeNull();
  });
});

describe('basisTranscoder', () => {
  test('defines the hash for the bundle', () => {
    const plugin = basisTranscoder();
    const config = (plugin.config as () => { define: Record<string, string> })();
    expect(JSON.parse(config.define['__JEEX_BASIS_TRANSCODER__']!)).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });
});

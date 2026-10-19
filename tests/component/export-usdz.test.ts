/**
 * `exportUsdz` against a real browser: `USDZExporter` rasterises textures
 * through a `<canvas>` (`src/app/export-usdz.ts`'s header explains the
 * dependency), so this cannot run under `bun test`.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { exportUsdz, type ExportUsdzOptions } from '../../src/app/export-usdz.js';
import type { ExportDeps } from '../../src/app/export-gltf.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { closeContainers, openContainer } from './support.js';

const ZIP_LOCAL_FILE_MAGIC = 0x04034b50;

/** A stand-in for `ViewerHandle.getScene`/`getState`, without mounting a viewer. */
function fakeDeps(overrides: { scene?: unknown; sceneId?: string; rev?: number } = {}): ExportDeps {
  const scene = overrides.scene === undefined ? lShapePlan : overrides.scene;
  return {
    getScene: () => scene as never,
    getState: () => ({ sceneId: overrides.sceneId ?? (scene as { id: string } | null)?.id ?? null, rev: overrides.rev ?? 1 }),
  };
}

describe('exportUsdz', () => {
  test('rejects with `not-ready` before the first scene', async () => {
    await expect(exportUsdz(fakeDeps({ scene: null }))).rejects.toMatchObject({ code: 'not-ready' });
  });

  test('a USDZ: ZIP-signed, over 10 KB, with a .usda model entry', async () => {
    const blob = await exportUsdz(fakeDeps());
    expect(blob.type).toBe('model/vnd.usdz+zip');
    expect(blob.size).toBeGreaterThan(10_000);

    const buffer = await blob.arrayBuffer();
    // The ZIP local file header signature ('PK\x03\x04'), little-endian.
    expect(new DataView(buffer).getUint32(0, true)).toBe(ZIP_LOCAL_FILE_MAGIC);
    expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 2))).toBe('PK');

    // The USD ASCII header, somewhere in the archive's bytes: the model file
    // is stored, not compressed (`zipSync(files, { level: 0 })` in
    // `USDZExporter.js`), so its text is not deflated and is found as-is.
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).toContain('#usda 1.0');
    expect(text).toContain('model.usda');
  });

  test('`includeFurniture: false` drops the furniture group, shrinking the archive', async () => {
    const withFurniture = await (await exportUsdz(fakeDeps())).arrayBuffer();
    const withoutFurniture = await (await exportUsdz(fakeDeps(), { includeFurniture: false })).arrayBuffer();
    expect(withoutFurniture.byteLength).toBeLessThan(withFurniture.byteLength);
  });

  test('an absent options object asks for the exporter’s own defaults (furniture included)', async () => {
    const options: ExportUsdzOptions = {};
    const blob = await exportUsdz(fakeDeps(), options);
    expect(blob.size).toBeGreaterThan(10_000);
  });
});

describe('exportUsdz, wired through a mounted handle', () => {
  const handles: ViewerHandle[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.dispose();
    closeContainers();
  });

  // NOT the demo apartment (contrast `export-gltf.test.ts`'s equivalent
  // smoke test, which mounts it): `USDZExporter` rasterises EVERY texture
  // through a `<canvas>` + `canvas.toBlob` (`imageToCanvas`,
  // `USDZExporter.js`), one at a time — the apartment's procedural textures
  // pushed this well past a 60 s timeout under headless SwiftShader, and the
  // subject here is the WIRING (`ViewerHandle.exportUsdz` through a real
  // mount), which `lShapePlan`'s much smaller material set proves just as
  // well: a test mounts the smallest scene that carries its subject.
  //
  // Even `lShapePlan`'s smaller material set measured 30089 ms against the
  // suite's 30 s default in a full gate run: the canvas
  // rasterisation cost is paid under the same shared, single software-GPU
  // process as every other component test, not against the scene alone. 90 s
  // matches the margin `export-gltf.test.ts` and `frame-bridge.test.ts` give
  // their own texture-heavy exports.
  test('handle.exportUsdz() on a mounted scene gives a well-formed USDZ', async () => {
    const container = openContainer();
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(lShapePlan) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    await handle.ready;

    const blob = await handle.exportUsdz();
    expect(blob.type).toBe('model/vnd.usdz+zip');
    expect(blob.size).toBeGreaterThan(10_000);
    const buffer = await blob.arrayBuffer();
    expect(new DataView(buffer).getUint32(0, true)).toBe(ZIP_LOCAL_FILE_MAGIC);
  }, 90_000);
});

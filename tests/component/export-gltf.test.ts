/**
 * `exportGlb` against a real browser: `GLTFExporter` needs `FileReader` to
 * turn its buffers into the binary chunk, so this cannot run under `bun
 * test` (`src/app/export-gltf.ts`'s header explains the dependency).
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { exportGlb, type ExportDeps } from '../../src/app/export-gltf.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { metadataTable } from '../../src/scene/metadata-table.js';
import { solvePlan } from '../../src/plan/plan-solver.js';
import { closeContainers, openContainer, parkForExport } from './support.js';

const GLB_MAGIC = 0x46546c67;

type GlbParts = { json: Record<string, unknown>; jsonText: string; bin: Uint8Array };

/** A GLB split into its two chunks, without re-encoding anything. */
function splitGlb(buffer: ArrayBuffer): GlbParts {
  const view = new DataView(buffer);
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC);
  let offset = 12;
  let jsonText = '';
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) jsonText = new TextDecoder().decode(data);
    else if (type === 0x004e4942) bin = new Uint8Array(data);
    offset += 8 + length;
  }
  expect(jsonText.length).toBeGreaterThan(0);
  return { json: JSON.parse(jsonText) as Record<string, unknown>, jsonText, bin };
}

/** Reads a GLB's JSON chunk back into an object, the way a real reader would. */
async function readGlbJson(blob: Blob): Promise<Record<string, unknown>> {
  const buffer = await blob.arrayBuffer();
  expect(new DataView(buffer).getUint32(4, true)).toBe(2);
  return splitGlb(buffer).json;
}

/** Index of the first differing byte, or `-1` when the two runs agree. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? -1 : shared;
}

/** Which bufferView (and which image, if any) a binary-chunk offset belongs to. */
function whatLivesAt(parts: GlbParts, offset: number): string {
  const views = (parts.json['bufferViews'] as Array<{ byteOffset?: number; byteLength: number }> | undefined) ?? [];
  const images = (parts.json['images'] as Array<{ bufferView: number; mimeType?: string }> | undefined) ?? [];
  for (const [index, view] of views.entries()) {
    const start = view.byteOffset ?? 0;
    if (offset < start || offset >= start + view.byteLength) continue;
    const image = images.findIndex((entry) => entry.bufferView === index);
    const what = image === -1 ? 'geometry' : `image ${image} (${images[image]?.mimeType ?? '?'})`;
    return `bufferView ${index} [${what}], ${view.byteLength} bytes, +${offset - start} into it`;
  }
  return 'no bufferView (padding or chunk tail)';
}

/**
 * `'identical'`, or ONE line naming where the two exports part company.
 *
 * Never `toEqual` on the two byte arrays: a 4 MB `Uint8Array` mismatch makes
 * Vitest deep-compare and then pretty-print every element, which cost one gate
 * run 36 minutes and 400 000 lines of log before this helper existed.
 */
function compareExports(first: ArrayBuffer, second: ArrayBuffer): string {
  const a = splitGlb(first);
  const b = splitGlb(second);
  if (a.jsonText !== b.jsonText) {
    const at = firstDifference(new TextEncoder().encode(a.jsonText), new TextEncoder().encode(b.jsonText));
    return `JSON chunk differs (${a.jsonText.length} vs ${b.jsonText.length} chars) at ${at}: ${JSON.stringify(a.jsonText.slice(at, at + 80))} vs ${JSON.stringify(b.jsonText.slice(at, at + 80))}`;
  }
  const at = firstDifference(a.bin, b.bin);
  if (at !== -1) return `binary chunk differs (${a.bin.length} vs ${b.bin.length} bytes) at ${at}: ${whatLivesAt(a, at)}`;
  return first.byteLength === second.byteLength
    ? 'identical'
    : `same chunks, different total size: ${first.byteLength} vs ${second.byteLength}`;
}

/** A stand-in for `ViewerHandle.getScene`/`getState`, without mounting a viewer. */
function fakeDeps(overrides: { scene?: unknown; sceneId?: string; rev?: number } = {}): ExportDeps {
  const scene = overrides.scene === undefined ? lShapePlan : overrides.scene;
  return {
    getScene: () => scene as never,
    getState: () => ({ sceneId: overrides.sceneId ?? (scene as { id: string } | null)?.id ?? null, rev: overrides.rev ?? 1 }),
  };
}

describe('exportGlb', () => {
  test('rejects with `not-ready` before the first scene', async () => {
    await expect(exportGlb(fakeDeps({ scene: null }))).rejects.toMatchObject({ code: 'not-ready' });
  });

  test('a GLB, with the element metadata table as EXT_structural_metadata and EXT_mesh_features on its meshes', async () => {
    const blob = await exportGlb(fakeDeps());
    expect(blob.type).toBe('model/gltf-binary');
    const json = await readGlbJson(blob);

    const extensionsUsed = json['extensionsUsed'] as string[];
    expect(extensionsUsed).toContain('EXT_structural_metadata');
    expect(extensionsUsed).toContain('EXT_mesh_features');

    const extension = (json['extensions'] as Record<string, unknown>)['EXT_structural_metadata'] as {
      schema: { classes: { jeexElement: unknown } };
      propertyTables: Array<{ count: number }>;
    };
    expect(extension.schema.classes.jeexElement).toBeTruthy();
    const rows = metadataTable(lShapePlan, solvePlan(lShapePlan));
    expect(extension.propertyTables[0]?.count).toBe(rows.length);

    const extras = json['extras'] as { jeex: { sceneId: string; rev: number; document?: unknown } };
    expect(extras.jeex.sceneId).toBe(lShapePlan.id);
    expect(extras.jeex.rev).toBe(1);
    expect(extras.jeex.document).toBeTruthy();

    const nodes = (json['nodes'] as Array<{ extensions?: { EXT_mesh_features?: { featureIds: Array<{ constant: number }> } } }>) ?? [];
    const tagged = nodes.filter((node) => node.extensions?.EXT_mesh_features);
    expect(tagged.length).toBeGreaterThan(0);
    for (const node of tagged) {
      const index = node.extensions!.EXT_mesh_features!.featureIds[0]!.constant;
      expect(rows[index]).toBeTruthy();
    }
  });

  test('no material carries the light bake facts of an opening part in its extras', async () => {
    const json = await readGlbJson(await exportGlb(fakeDeps()));
    const materials = (json['materials'] as Array<{ name?: string; extras?: Record<string, unknown> }> | undefined) ?? [];
    expect(materials.length).toBeGreaterThan(0);
    const leaking = materials.filter(
      (material) => material.extras?.['jeexFinish'] !== undefined || material.extras?.['jeexGlass'] !== undefined,
    );
    expect(leaking.map((material) => material.name ?? '(unnamed)')).toEqual([]);
  });

  test('`includeFurniture: false` drops the furniture group from the export', async () => {
    const withFurniture = await readGlbJson(await exportGlb(fakeDeps()));
    const withoutFurniture = await readGlbJson(await exportGlb(fakeDeps(), { includeFurniture: false }));
    const meshCount = (json: Record<string, unknown>): number => ((json['meshes'] as unknown[]) ?? []).length;
    expect(meshCount(withoutFurniture)).toBeLessThan(meshCount(withFurniture));
  });

  test('`embedDocument: false` omits the full document but keeps sceneId/rev', async () => {
    const json = await readGlbJson(await exportGlb(fakeDeps(), { embedDocument: false }));
    const extras = json['extras'] as { jeex: { sceneId: string; document?: unknown } };
    expect(extras.jeex.sceneId).toBe(lShapePlan.id);
    expect(extras.jeex.document).toBeUndefined();
  });

  // Two full exports of a textured plan, so this one declares its own budget
  // (a test that builds the scene twice, exports or captures declares 90 s). It is also the test that must never run long on failure:
  // `compareExports` reports one line, so a red run costs the same as a green
  // one.
  test('re-exporting the same document byte-for-byte matches the first export', async () => {
    const first = await (await exportGlb(fakeDeps())).arrayBuffer();
    const second = await (await exportGlb(fakeDeps())).arrayBuffer();
    expect(compareExports(first, second)).toBe('identical');
  }, 90_000);

  /*
   * The invariant behind the test above, checked on ONE export so a regression
   * is named rather than merely observed as "the bytes moved".
   *
   * `GLTFExporter` allocates a texture's bufferView inside the `FileReader`
   * callback chained after `canvas.toBlob`, so on a busy machine the PNGs land
   * in the binary chunk in whatever order Blink's encoder thread pool finishes
   * them — which is why the byte-for-byte test above failed in three of four
   * full gate runs before `canonicaliseBufferViews`.
   * `export-gltf.ts` sorts them back into document order; document order is
   * what this asserts.
   */
  test('bufferViews are laid out in document order, not in PNG-encode completion order', async () => {
    const { json } = splitGlb(await (await exportGlb(fakeDeps())).arrayBuffer());
    const views = json['bufferViews'] as Array<{ byteOffset?: number; byteLength: number }>;
    const images = (json['images'] as Array<{ bufferView: number }> | undefined) ?? [];
    expect(images.length).toBeGreaterThan(0);

    // Offsets ascend with the index, with no gap beyond 4-byte alignment.
    let expected = 0;
    let layout = 'packed in index order';
    for (const [index, view] of views.entries()) {
      if ((view.byteOffset ?? 0) !== expected && layout === 'packed in index order') {
        layout = `bufferView ${index} at ${view.byteOffset ?? 0}, expected ${expected}`;
      }
      expected += view.byteLength + ((4 - (view.byteLength % 4)) % 4);
    }
    expect(layout).toBe('packed in index order');

    // Accessors come before images, and each array's own order is preserved.
    const accessorViews = (json['accessors'] as Array<{ bufferView?: number }>).flatMap((accessor) =>
      typeof accessor.bufferView === 'number' ? [accessor.bufferView] : [],
    );
    const imageViews = images.map((image) => image.bufferView);
    const lastAccessorView = accessorViews.reduce((highest, index) => Math.max(highest, index), -1);
    const firstImageView = imageViews.reduce((lowest, index) => Math.min(lowest, index), Number.POSITIVE_INFINITY);
    expect(lastAccessorView).toBeLessThan(firstImageView);
    expect(imageViews).toEqual([...imageViews].sort((a, b) => a - b));
  });
});

describe('exportGlb, wired through a mounted handle', () => {
  const handles: ViewerHandle[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.dispose();
    closeContainers();
  });

  // The L-shape plan, not the demo apartment: what this test proves is the
  // handle's wiring (a mounted viewer hands its committed document to
  // `exportGlb` and gets a GLB with the metadata and the scene id back), which
  // the small plan proves as well as the full apartment; the exporter's own
  // behaviour over a real document is the describe block above. The viewer is
  // parked first (`parkForExport`), so the export does not queue behind
  // SwiftShader frames. On the demo apartment with the loop running, this test
  // ran past a 90 s budget on a hosted runner.
  test('handle.exportGlb() on a mounted viewer gives a well-formed GLB', async () => {
    const container = openContainer();
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(lShapePlan) },
      tour: { mode: 'off' },
      debug: false,
    });
    handles.push(handle);
    await handle.ready;
    parkForExport(handle);

    const blob = await handle.exportGlb();
    expect(blob.type).toBe('model/gltf-binary');
    expect(blob.size).toBeGreaterThan(1000);
    const json = await readGlbJson(blob);
    expect((json['extensionsUsed'] as string[]) ?? []).toContain('EXT_structural_metadata');
    const extras = json['extras'] as { jeex: { sceneId: string } };
    expect(extras.jeex.sceneId).toBe(lShapePlan.id);
  });
});

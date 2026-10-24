/**
 * `exportGlb`: turns the committed document into a GLB with the element
 * metadata table riding along as `EXT_structural_metadata` (a binary property
 * table at the root) and `EXT_mesh_features` (a feature id on every primitive
 * of an element mesh, through a `_FEATURE_ID_0` vertex attribute), both
 * written against the Cesium vendor extensions' text (draft status).
 *
 * Deliberately independent of the live mounted scene graph: `exportGlb` reads
 * only `ExportDeps.getScene()`/`getState()` — the same `SceneData` and
 * `{ sceneId, rev }` a host already gets from `ViewerHandle.getScene()` /
 * `getState()` — and builds its OWN throwaway `SceneBuilder` from them. That
 * is half of what makes a re-export of the same document byte-for-byte
 * identical (no live door animation, no selection aura, no in-flight camera
 * state to differ run to run) and is why this module never touches `ViewerApp`
 * or `SceneMount`: everything it needs is already public. The other half is
 * `canonicaliseBufferViews` below, which undoes the one thing `GLTFExporter`
 * decides by a race instead of by the document — where each texture's PNG
 * lands in the binary chunk.
 *
 * `GLTFExporter`'s binary path reads its buffers back through `FileReader`
 * (`three/addons/exporters/GLTFExporter.js`), a browser-only API — this
 * module (and its test) only run where one exists.
 *
 * Both `GLTFExporter` and the throwaway builder are imported behind this
 * function, never at module load, so they land in their own `lazy-*` chunk
 * (`scripts/budget-check.ts`) and the boot bundle never pays for an export
 * action nobody asked for yet.
 */

import * as THREE from 'three';
import { SceneBuilder, FURNITURE_GROUP_NAME, type SceneBuilderOptions } from '../geometry/scene-builder.js';
import { prepareLibraryMaps, type LibraryMapsOptions } from './export-library.js';
import { solvePlan } from '../plan/plan-solver.js';
import { metadataTable, structuralMetadataExtension, type ElementRow } from '../scene/metadata-table.js';
import { exportGraphWithRows } from '../render/export-graph.js';
import type { SceneData } from '../scene/types.js';
import { ViewerLibError } from '../shared/errors.js';
import type { ExportGlbOptions, ExportSceneState } from './export-types.js';
import type { ExportSurfaces } from './export-surfaces.js';

// Re-exported so every existing `from './export-gltf.js'` import (`viewer-api.ts`,
// `embed/frame-bridge.ts`) keeps working; the type itself lives in
// `export-types.ts` — a leaf module — so this file and `viewer-handle.ts`
// never import each other (`export-types.ts`'s header explains why).
export type { ExportGlbOptions } from './export-types.js';

/** What an export needs from a mounted viewer: two already-public reads, nothing more. */
export type ExportDeps = {
  /** The committed document, or `null` before the first scene (`ViewerHandle.getScene`). */
  getScene: () => SceneData | null;
  /** `sceneId`/`rev` in one read (`ViewerHandle.getState`); the rest of the state is not this module's business. */
  getState: () => ExportSceneState;
  /**
   * What the mounted viewer draws room surfaces with (`export-surfaces.ts`):
   * its project materials and its own texture sources. Absent or `null`, every
   * library surface is exported flat in its first-frame colour.
   */
  getSurfaces?: (() => ExportSurfaces | null) | undefined;
};

const DEFAULT_OPTIONS: Required<ExportGlbOptions> = { includeFurniture: true, state: 'current', embedDocument: true };

function notReady(action: string): ViewerLibError {
  return new ViewerLibError('not-ready', `${action}: no scene is on screen yet`);
}

/** `scene`, with every painted override stripped, when `state: 'default'` asks for the catalogue's own look. */
function effectiveScene(scene: SceneData, state: 'current' | 'default'): SceneData {
  if (state !== 'default') return scene;
  // `exactOptionalPropertyTypes` refuses `finishes: undefined` (the key must
  // be ABSENT, not present-and-undefined) — omit it instead of nulling it.
  const { finishes: _finishes, ...withoutFinishes } = scene;
  return withoutFinishes;
}

/**
 * The builder options an export draws room surfaces with: the mounted
 * viewer's project materials, finish lookup and texture sources
 * (`export-surfaces.ts`), or nothing (every library surface flat).
 */
function surfaceOptions(surfaces: ExportSurfaces | null | undefined): SceneBuilderOptions {
  if (!surfaces) return {};
  return {
    ...(surfaces.surfaceMaterials !== undefined && { surfaceMaterials: surfaces.surfaceMaterials }),
    ...(surfaces.findFinish !== undefined && { findFinish: surfaces.findFinish }),
    ...(surfaces.textures !== null && { textures: surfaces.textures }),
    ...(surfaces.builtinTextures !== null && { builtinTextures: surfaces.builtinTextures }),
  };
}

/**
 * Builds a throwaway export graph from `scene`: solves the plan, builds the
 * procedural scene fresh with the room-surface context `surfaces` names,
 * waits until every library map has attached or given up, optionally drops
 * the furniture group, tags the result with the element metadata table, and
 * makes its library surfaces writable (`export-library.ts`).
 *
 * The returned `dispose` releases the throwaway builder's OWN geometries,
 * materials and texture views (`SceneBuilder.dispose`) and what the library
 * preparation made — never anything the live viewer might also be holding,
 * because this builder is not it (module header). Callers must call
 * `dispose()` only AFTER every consumer of `graph` (an exporter's
 * `parseAsync`) has finished reading it.
 */
async function prepareExport(
  scene: SceneData,
  options: Pick<Required<ExportGlbOptions>, 'includeFurniture' | 'state'>,
  surfaces?: ExportSurfaces | null,
  maps: LibraryMapsOptions = {},
): Promise<{ graph: THREE.Object3D; rows: readonly ElementRow[]; meshRows: ReadonlyMap<THREE.Mesh, number>; dispose: () => void }> {
  const document = effectiveScene(scene, options.state);
  const plan = solvePlan(document);
  const builder = new SceneBuilder(document, plan, surfaceOptions(surfaces));
  try {
    const { root } = builder.build();
    await builder.mapsSettled();
    if (!options.includeFurniture) root.getObjectByName(FURNITURE_GROUP_NAME)?.removeFromParent();
    const rows = metadataTable(document, plan);
    const { graph, meshRows } = exportGraphWithRows(root, rows);
    const disposeMaps = prepareLibraryMaps(graph, maps);
    return {
      graph,
      rows,
      meshRows,
      dispose: () => {
        disposeMaps();
        builder.dispose();
      },
    };
  } catch (error) {
    builder.dispose();
    throw error;
  }
}

/** The feature id attribute, as `GLTFExporter` names it: a custom attribute starting with `_` is upper-cased and kept. */
const FEATURE_ID_ATTRIBUTE = '_feature_id_0';

/**
 * Gives every element mesh of the export graph its feature id, the way
 * `EXT_mesh_features` defines one for a whole primitive: a `_FEATURE_ID_0`
 * vertex attribute holding the row index on every vertex (`FLOAT`: a vertex
 * attribute is padded to a 4-byte stride anyway, `UNSIGNED_INT` is not valid
 * for one, and a float is exact to 2^24 rows), and
 * `{ featureIds: [{ featureCount: 1, attribute: 0, propertyTable: 0 }] }`,
 * which `GLTFExporter` copies off `geometry.userData.gltfExtensions` onto every
 * primitive it writes for that geometry.
 *
 * The mesh gets a wrapper geometry in place of its own: the same attribute
 * objects (so the exporter still writes each vertex buffer once), the same
 * index, groups and draw range, plus the feature attribute. Only the clone
 * changes; the throwaway builder's geometries are left as they are, and
 * `exportUsdz` never sees a wrapper. One wrapper per (geometry, row) keeps
 * meshes that share a geometry deduplicated; one feature attribute per
 * (row, vertex count) lets equal ones share an accessor. Returns the
 * wrappers' disposal.
 */
function addFeatureIds(meshRows: ReadonlyMap<THREE.Mesh, number>): () => void {
  const wrappers = new Map<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();
  const featureAttributes = new Map<string, THREE.BufferAttribute>();
  for (const [mesh, row] of meshRows) {
    const source = mesh.geometry;
    const byRow = wrappers.get(source) ?? new Map<number, THREE.BufferGeometry>();
    wrappers.set(source, byRow);
    let wrapper = byRow.get(row);
    if (!wrapper) {
      wrapper = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(source.attributes)) wrapper.setAttribute(name, attribute);
      wrapper.morphAttributes = source.morphAttributes;
      wrapper.morphTargetsRelative = source.morphTargetsRelative;
      wrapper.setIndex(source.index);
      for (const group of source.groups) wrapper.addGroup(group.start, group.count, group.materialIndex);
      wrapper.setDrawRange(source.drawRange.start, source.drawRange.count);
      const vertices = source.getAttribute('position').count;
      const key = `${row}:${vertices}`;
      const feature = featureAttributes.get(key) ?? new THREE.BufferAttribute(new Float32Array(vertices).fill(row), 1);
      featureAttributes.set(key, feature);
      wrapper.setAttribute(FEATURE_ID_ATTRIBUTE, feature);
      // Nothing else of the source's `userData`: the exporter would write it into every primitive's `extras`.
      wrapper.userData = { gltfExtensions: { EXT_mesh_features: { featureIds: [{ featureCount: 1, attribute: 0, propertyTable: 0 }] } } };
      byRow.set(row, wrapper);
    }
    mesh.geometry = wrapper;
  }
  return () => {
    for (const byRow of wrappers.values()) for (const wrapper of byRow.values()) wrapper.dispose();
  };
}

const GLB_MAGIC = 0x46546c67;
const GLB_HEADER_BYTES = 12;
const CHUNK_PREFIX_BYTES = 8;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

/**
 * `buffer`, padded with `fill` to the next 8-byte boundary: the GLB rule is 4,
 * and `EXT_structural_metadata` asks for 8 so binary property values can sit
 * on 8-byte boundaries.
 */
function padTo8Bytes(buffer: ArrayBuffer, fill: number): ArrayBuffer {
  const remainder = buffer.byteLength % 8;
  if (remainder === 0) return buffer;
  const out = new Uint8Array(buffer.byteLength + (8 - remainder));
  out.set(new Uint8Array(buffer));
  out.fill(fill, buffer.byteLength);
  return out.buffer;
}

/** `value`, rounded up to the next 4-byte boundary — the glTF bufferView alignment rule. */
function align4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}

/** `value`, rounded up to the next 8-byte boundary — where `EXT_structural_metadata` wants a property's bufferView. */
function align8(value: number): number {
  return value + ((8 - (value % 8)) % 8);
}

/**
 * `bin` with `blocks` appended, each starting on an 8-byte boundary, and one
 * bufferView per block appended to `json` in the same order (so block `k`
 * becomes bufferView `firstIndex + k`, the index the caller already wrote).
 */
function appendBlocks(json: Record<string, unknown>, bin: ArrayBuffer | null, blocks: readonly Uint8Array[]): ArrayBuffer | null {
  if (blocks.length === 0) return bin;
  const views = (json['bufferViews'] as Array<Record<string, unknown>> | undefined) ?? [];
  json['bufferViews'] = views;
  let cursor = bin?.byteLength ?? 0;
  const placed = blocks.map((block) => {
    const byteOffset = align8(cursor);
    cursor = byteOffset + block.byteLength;
    return byteOffset;
  });
  const out = new Uint8Array(cursor);
  if (bin) out.set(new Uint8Array(bin));
  blocks.forEach((block, index) => {
    out.set(block, placed[index]);
    views.push({ buffer: 0, byteOffset: placed[index]!, byteLength: block.byteLength });
  });
  return out.buffer;
}

/** One place in the glTF JSON that names a `bufferView` by index. */
type ViewSlot = { read: () => number; write: (index: number) => void };

/**
 * Every `bufferView` reference in the document, in DOCUMENT order: accessors
 * by accessor index (their own `bufferView` and both sparse ones), then images
 * by image index.
 *
 * Both arrays are filled synchronously while `GLTFExporter` walks the graph,
 * so their order is a function of the scene alone — which is what makes this
 * list a canonical order to sort the bufferViews into.
 */
function bufferViewSlots(json: Record<string, unknown>): ViewSlot[] {
  const slots: ViewSlot[] = [];
  const add = (owner: Record<string, unknown> | undefined): void => {
    if (!owner || typeof owner['bufferView'] !== 'number') return;
    slots.push({
      read: () => owner['bufferView'] as number,
      write: (index) => {
        owner['bufferView'] = index;
      },
    });
  };
  for (const accessor of (json['accessors'] as Array<Record<string, unknown>> | undefined) ?? []) {
    add(accessor);
    const sparse = accessor['sparse'] as Record<string, unknown> | undefined;
    add(sparse?.['indices'] as Record<string, unknown> | undefined);
    add(sparse?.['values'] as Record<string, unknown> | undefined);
  }
  for (const image of (json['images'] as Array<Record<string, unknown>> | undefined) ?? []) add(image);
  return slots;
}

/**
 * Rewrites the binary chunk so its bufferViews sit in document order, and
 * renumbers every reference to them. This is what makes a re-export of the
 * same document byte-for-byte identical.
 *
 * `GLTFExporter` allocates a TEXTURE's bufferView inside the `FileReader`
 * callback chained after `canvas.toBlob` (three r186,
 * `GLTFWriter.processBufferViewImage`), and the binary chunk is the
 * concatenation of `writer.buffers` in push order. Neither `toBlob` nor
 * `FileReader` promises completion order across independent instances: Blink
 * encodes PNGs on a thread pool, so which of a scene's textures finishes first
 * depends on how busy the machine is. On an idle machine that happens to be
 * traversal order; under load two exports of the SAME document put the same
 * pixels at different offsets, in a different `bufferViews` order, and differ
 * by megabytes with nothing changed in the scene (a flake seen under load).
 *
 * Geometry is not affected — accessor bufferViews are allocated synchronously
 * during the walk — but they are reordered by the same pass anyway, so the
 * canonical form is one rule rather than a special case for images.
 */
function canonicaliseBufferViews(json: Record<string, unknown>, bin: ArrayBuffer): ArrayBuffer {
  const views = json['bufferViews'] as Array<Record<string, unknown>> | undefined;
  if (!views || views.length === 0) return bin;

  const slots = bufferViewSlots(json);
  const order: number[] = [];
  const placed = new Set<number>();
  for (const slot of slots) {
    const index = slot.read();
    if (index < 0 || index >= views.length || placed.has(index)) continue;
    placed.add(index);
    order.push(index);
  }
  // A bufferView nothing references keeps its relative position at the end
  // rather than being dropped: this pass reorders, it never edits the payload.
  for (let index = 0; index < views.length; index += 1) if (!placed.has(index)) order.push(index);

  const source = new Uint8Array(bin);
  const out = new Uint8Array(order.reduce((sum, index) => sum + align4(views[index]!['byteLength'] as number), 0));
  const remap: number[] = Array.from({ length: views.length }, () => 0);
  const reordered: Array<Record<string, unknown>> = [];
  let cursor = 0;
  for (const index of order) {
    const view = views[index]!;
    const byteLength = view['byteLength'] as number;
    const byteOffset = (view['byteOffset'] as number | undefined) ?? 0;
    out.set(source.subarray(byteOffset, byteOffset + byteLength), cursor);
    remap[index] = reordered.length;
    reordered.push({ ...view, byteOffset: cursor, byteLength });
    cursor += align4(byteLength);
  }

  json['bufferViews'] = reordered;
  for (const slot of slots) slot.write(remap[slot.read()]!);
  const buffers = json['buffers'] as Array<Record<string, unknown>> | undefined;
  if (buffers?.[0]) buffers[0]['byteLength'] = out.byteLength;
  return out.buffer;
}

function chunk(type: number, data: ArrayBuffer): ArrayBuffer[] {
  const prefix = new ArrayBuffer(CHUNK_PREFIX_BYTES);
  const view = new DataView(prefix);
  view.setUint32(0, data.byteLength, true);
  view.setUint32(4, type, true);
  return [prefix, data];
}

/**
 * Rewrites a GLB produced by `GLTFExporter`: its bufferViews put into
 * document order (`canonicaliseBufferViews`), then `mutate`'s changes to the
 * JSON and the blocks it returns appended to the binary chunk (each on an
 * 8-byte boundary, `appendBlocks`), both chunks padded to 8 bytes.
 *
 * `GLTFExporter` has no root-level `extensions` hook of its own — its
 * `userData` mechanism (`serializeUserData`) only reaches a node, a material
 * or a mesh, never the document root — so `EXT_structural_metadata`, which
 * belongs at the document root next to `extensionsUsed`, is added by
 * patching the already-written GLB instead of asking the exporter for it.
 */
function patchGlbJson(glb: ArrayBuffer, mutate: (json: Record<string, unknown>) => readonly Uint8Array[]): ArrayBuffer {
  const view = new DataView(glb);
  if (glb.byteLength < GLB_HEADER_BYTES || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new ViewerLibError('internal', 'exportGlb: GLTFExporter did not produce a GLB (bad magic)');
  }
  const version = view.getUint32(4, true);

  let offset = GLB_HEADER_BYTES;
  let jsonChunk: ArrayBuffer | null = null;
  let binChunk: ArrayBuffer | null = null;
  while (offset + CHUNK_PREFIX_BYTES <= glb.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + CHUNK_PREFIX_BYTES;
    const data = glb.slice(start, start + length);
    if (type === JSON_CHUNK_TYPE) jsonChunk = data;
    else if (type === BIN_CHUNK_TYPE) binChunk = data;
    offset = start + length;
  }
  if (!jsonChunk) throw new ViewerLibError('internal', 'exportGlb: GLB carries no JSON chunk');

  const json = JSON.parse(new TextDecoder().decode(jsonChunk)) as Record<string, unknown>;
  // Before anything is added: put the exporter's race-ordered bufferViews back
  // into document order, so the same document always produces the same bytes.
  if (binChunk) binChunk = canonicaliseBufferViews(json, binChunk);
  // Then whatever the caller adds: its blocks go after the canonical views, in its order.
  binChunk = appendBlocks(json, binChunk, mutate(json));
  if (binChunk) {
    binChunk = padTo8Bytes(binChunk, 0x00);
    const buffers = (json['buffers'] as Array<Record<string, unknown>> | undefined) ?? [{}];
    json['buffers'] = buffers;
    buffers[0]!['byteLength'] = binChunk.byteLength;
  }

  const jsonBytes = padTo8Bytes(new TextEncoder().encode(JSON.stringify(json)).buffer, 0x20);
  const parts: ArrayBuffer[] = [...chunk(JSON_CHUNK_TYPE, jsonBytes)];
  if (binChunk) parts.push(...chunk(BIN_CHUNK_TYPE, binChunk));

  const totalLength = GLB_HEADER_BYTES + parts.reduce((sum, part) => sum + part.byteLength, 0);
  const header = new ArrayBuffer(GLB_HEADER_BYTES);
  const headerView = new DataView(header);
  headerView.setUint32(0, GLB_MAGIC, true);
  headerView.setUint32(4, version, true);
  headerView.setUint32(8, totalLength, true);

  const out = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of [header, ...parts]) {
    out.set(new Uint8Array(part), cursor);
    cursor += part.byteLength;
  }
  return out.buffer;
}

/**
 * Exports the committed document as a GLB: `GLTFExporter.parseAsync` over
 * `exportGraph`'s prepared clone, with `EXT_structural_metadata` (the element
 * metadata table) and `extras.jeex` (schema version, scene id, revision, and
 * — by default — the full document) added onto the root afterwards
 * (`patchGlbJson`). Rejects with `ViewerLibError('not-ready')` before the
 * first scene.
 */
export async function exportGlb(deps: ExportDeps, options: ExportGlbOptions = {}): Promise<Blob> {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const scene = deps.getScene();
  if (!scene) throw notReady('exportGlb');
  const { sceneId, rev } = deps.getState();

  const { graph, rows, meshRows, dispose } = await prepareExport(scene, resolved, deps.getSurfaces?.());
  const disposeFeatureIds = addFeatureIds(meshRows);
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const arrayBuffer = (await exporter.parseAsync(graph, {
      binary: true,
      onlyVisible: true,
      includeCustomExtensions: true,
    })) as ArrayBuffer;

    const patched = patchGlbJson(arrayBuffer, (json) => {
      const { extension, blocks } = structuralMetadataExtension(rows, ((json['bufferViews'] as unknown[] | undefined) ?? []).length);
      const extensionsUsed = new Set<string>([...((json['extensionsUsed'] as string[] | undefined) ?? []), 'EXT_structural_metadata']);
      json['extensionsUsed'] = [...extensionsUsed];
      json['extensions'] = {
        ...(json['extensions'] as Record<string, unknown> | undefined),
        EXT_structural_metadata: extension,
      };
      json['extras'] = {
        ...(json['extras'] as Record<string, unknown> | undefined),
        jeex: {
          schemaVersion: scene.schemaVersion,
          sceneId,
          rev,
          ...(resolved.embedDocument ? { document: scene } : {}),
        },
      };
      return blocks;
    });

    return new Blob([patched], { type: 'model/gltf-binary' });
  } finally {
    disposeFeatureIds();
    dispose();
  }
}

export { prepareExport };

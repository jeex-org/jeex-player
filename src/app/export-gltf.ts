/**
 * `exportGlb`: turns the committed document into a GLB with the element
 * metadata table riding along as `EXT_structural_metadata` /
 * `EXT_mesh_features`.
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
import { SceneBuilder, FURNITURE_GROUP_NAME } from '../geometry/scene-builder.js';
import { solvePlan } from '../plan/plan-solver.js';
import { metadataTable, structuralMetadataExtension, type ElementRow } from '../scene/metadata-table.js';
import { exportGraph } from '../render/export-graph.js';
import type { SceneData } from '../scene/types.js';
import { ViewerLibError } from '../shared/errors.js';
import type { ExportGlbOptions, ExportSceneState } from './export-types.js';

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
 * Builds a throwaway export graph from `scene`: solves the plan, builds the
 * procedural scene fresh, optionally drops the furniture group, and tags the
 * result with the element metadata table.
 *
 * The returned `dispose` releases the throwaway builder's OWN geometries and
 * materials only (`SceneBuilder.dispose`) — never anything the live viewer
 * might also be holding, because this builder is not it (module header).
 * Callers must call `dispose()` only AFTER every consumer of `graph` (an
 * exporter's `parseAsync`) has finished reading it.
 */
function prepareExport(
  scene: SceneData,
  options: Pick<Required<ExportGlbOptions>, 'includeFurniture' | 'state'>,
): { graph: THREE.Object3D; rows: readonly ElementRow[]; dispose: () => void } {
  const document = effectiveScene(scene, options.state);
  const plan = solvePlan(document);
  const builder = new SceneBuilder(document, plan);
  const { root } = builder.build();
  if (!options.includeFurniture) root.getObjectByName(FURNITURE_GROUP_NAME)?.removeFromParent();
  const rows = metadataTable(document, plan);
  const graph = exportGraph(root, rows);
  return { graph, rows, dispose: () => builder.dispose() };
}

const GLB_MAGIC = 0x46546c67;
const GLB_HEADER_BYTES = 12;
const CHUNK_PREFIX_BYTES = 8;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

/** `buffer`, padded with `fill` to the next 4-byte boundary — the GLB chunk-alignment rule. */
function padTo4Bytes(buffer: ArrayBuffer, fill: number): ArrayBuffer {
  const remainder = buffer.byteLength % 4;
  if (remainder === 0) return buffer;
  const out = new Uint8Array(buffer.byteLength + (4 - remainder));
  out.set(new Uint8Array(buffer));
  out.fill(fill, buffer.byteLength);
  return out.buffer;
}

/** `value`, rounded up to the next 4-byte boundary — the glTF bufferView alignment rule. */
function align4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
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
 * Rewrites the JSON chunk of a GLB produced by `GLTFExporter`, leaving its
 * binary chunk (if any) untouched.
 *
 * `GLTFExporter` has no root-level `extensions` hook of its own — its
 * `userData` mechanism (`serializeUserData`) only reaches a node, a material
 * or a mesh, never the document root — so `EXT_structural_metadata`, which
 * belongs at the document root next to `extensionsUsed`, is added by
 * patching the already-written GLB instead of asking the exporter for it.
 */
function patchGlbJson(glb: ArrayBuffer, mutate: (json: Record<string, unknown>) => void): ArrayBuffer {
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
  mutate(json);

  const jsonBytes = padTo4Bytes(new TextEncoder().encode(JSON.stringify(json)).buffer, 0x20);
  const parts: ArrayBuffer[] = [...chunk(JSON_CHUNK_TYPE, jsonBytes)];
  if (binChunk) parts.push(...chunk(BIN_CHUNK_TYPE, padTo4Bytes(binChunk, 0x00)));

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

  const { graph, rows, dispose } = prepareExport(scene, resolved);
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const arrayBuffer = (await exporter.parseAsync(graph, {
      binary: true,
      onlyVisible: true,
      includeCustomExtensions: true,
    })) as ArrayBuffer;

    const patched = patchGlbJson(arrayBuffer, (json) => {
      const extensionsUsed = new Set<string>([...((json['extensionsUsed'] as string[] | undefined) ?? []), 'EXT_structural_metadata']);
      json['extensionsUsed'] = [...extensionsUsed];
      json['extensions'] = {
        ...(json['extensions'] as Record<string, unknown> | undefined),
        EXT_structural_metadata: structuralMetadataExtension(rows),
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
    });

    return new Blob([patched], { type: 'model/gltf-binary' });
  } finally {
    dispose();
  }
}

export { prepareExport };

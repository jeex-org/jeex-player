/**
 * The exported GLB of the demo apartment, read by the Khronos glTF Validator
 * and by a strict reader of the two metadata extensions it carries
 * (`glb-conformance.ts`): zero validator errors, a conformant
 * `EXT_mesh_features` on every element primitive and a conformant binary
 * `EXT_structural_metadata` property table, and every wall, room, opening and
 * furniture primitive resolving to its own `jeexElements` row.
 *
 * The validator does not support either extension (it reports them as
 * `UNSUPPORTED_EXTENSION`, an Information); the strict reader is what checks
 * them, and this file says so by asserting exactly which extensions the
 * validator skipped.
 */

import { describe, expect, test } from 'vitest';
import { validateBytes } from 'gltf-validator';
import { exportGlb, type ExportDeps } from '../../src/app/export-gltf.js';
import { metadataFindings, readScalars, readStringColumn, type GltfJson } from './glb-conformance.js';
import { demoScene } from './support.js';

type ValidatorMessage = { code: string; message: string; severity: number; pointer?: string };
type ValidatorReport = {
  issues: { numErrors: number; numWarnings: number; numInfos: number; messages: ValidatorMessage[] };
};

/** Warning codes judged harmless for this export, with the reason; any other warning fails the test. */
const JUDGED_WARNINGS: Record<string, string> = {
  KHR_MATERIALS_EMISSIVE_STRENGTH_ZERO_FACTOR:
    'three writes the emissive strength of a material whose emissive colour is black; it has no effect on how the file renders',
};

/**
 * Information codes judged harmless for this export, with the reason. Anything not listed fails
 * the test until it is judged here.
 */
const JUDGED_INFORMATION: Record<string, string> = {
  UNSUPPORTED_EXTENSION:
    'the validator cannot check these extensions; the strict reader checks the two metadata ones, and the exact list is asserted',
  UNUSED_OBJECT:
    'TEXCOORD_0 on meshes whose material has no texture, textures three keeps for material variants, and the property-table bufferViews (referenced only by EXT_structural_metadata, which the validator cannot read): valid glTF',
};

const ERROR = 0;
const WARNING = 1;
const INFORMATION = 2;

function deps(): ExportDeps {
  const scene = demoScene();
  return { getScene: () => scene, getState: () => ({ sceneId: scene.id, rev: 1 }) };
}

/** The JSON and BIN chunks of a GLB, as a reader sees them. */
function chunks(buffer: ArrayBuffer): { json: GltfJson; bin: Uint8Array } {
  const view = new DataView(buffer);
  let offset = 12;
  let json: GltfJson = {};
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length))) as GltfJson;
    else if (type === 0x004e4942) bin = new Uint8Array(buffer, offset + 8, length);
    offset += 8 + length;
  }
  return { json, bin };
}

/** `code at pointer`, one per message of `severity`. */
function lines(report: ValidatorReport, severity: number): string[] {
  return report.issues.messages
    .filter((entry) => entry.severity === severity)
    .map((entry) => `${entry.code} at ${entry.pointer ?? '/'}: ${entry.message}`);
}

/** What an element node of the export says it is, from the `extras` the exporter copies off `userData`. */
type Element = { class: string; id?: string; wallId?: string; side?: string; roomId?: string | null };

function elementOf(extras: Record<string, unknown> | undefined): Element | null {
  if (!extras) return null;
  if (extras['surface'] === 'wall') {
    const face = extras['face'] as { wallId: string; side: string; room?: string | null };
    return { class: 'wallFace', wallId: face.wallId, side: face.side, roomId: face.room ?? null };
  }
  if (extras['surface'] === 'floor' || extras['isCeiling'] === true) return { class: 'room', id: extras['roomId'] as string };
  if (extras['surface'] === 'opening' && typeof extras['openingId'] === 'string') return { class: 'opening', id: extras['openingId'] };
  if (typeof extras['assetId'] === 'string') return { class: 'furniture', id: extras['assetId'] };
  return null;
}

/** Every mesh at or under `nodeIndex` that belongs to `nodeIndex`'s element (a descendant element owns its own subtree). */
function meshesOf(json: GltfJson, nodeIndex: number, root = true): number[] {
  const node = json.nodes?.[nodeIndex];
  if (!node || (!root && elementOf(node.extras) !== null)) return [];
  return [...(node.mesh === undefined ? [] : [node.mesh]), ...(node.children ?? []).flatMap((child) => meshesOf(json, child, false))];
}

describe('exportGlb conformance', () => {
  test('the demo apartment GLB passes the glTF Validator and the strict metadata reader, and every element primitive resolves to its row', async () => {
    const buffer = await (await exportGlb(deps())).arrayBuffer();
    const report = (await validateBytes(new Uint8Array(buffer), { maxIssues: 0, writeTimestamp: false, format: 'glb' })) as ValidatorReport;

    // `expect.soft` throughout: one run names every breach, not only the first.
    expect.soft(lines(report, ERROR)).toEqual([]);
    const judgedWarnings = new Set(Object.keys(JUDGED_WARNINGS));
    expect.soft(lines(report, WARNING).filter((line) => !judgedWarnings.has(line.slice(0, line.indexOf(' '))))).toEqual([]);
    const skipped = report.issues.messages.filter((entry) => entry.code === 'UNSUPPORTED_EXTENSION').map((entry) => entry.message);
    expect
      .soft(skipped.toSorted())
      .toEqual([
        "Cannot validate an extension as it is not supported by the validator: 'EXT_materials_bump'.",
        "Cannot validate an extension as it is not supported by the validator: 'EXT_mesh_features'.",
        "Cannot validate an extension as it is not supported by the validator: 'EXT_structural_metadata'.",
      ]);
    const judgedInfos = new Set(Object.keys(JUDGED_INFORMATION));
    expect.soft(lines(report, INFORMATION).filter((line) => !judgedInfos.has(line.slice(0, line.indexOf(' '))))).toEqual([]);

    const { json, bin } = chunks(buffer);
    // EXT_structural_metadata asks for the GLB's JSON and BIN chunks to be padded to 8 bytes,
    // so binary property values can sit on 8-byte boundaries.
    expect
      .soft({ jsonChunk: new DataView(buffer).getUint32(12, true) % 8, binChunk: bin.byteLength % 8 })
      .toEqual({ jsonChunk: 0, binChunk: 0 });
    expect.soft(metadataFindings(json, bin)).toEqual([]);

    const column = (name: string): Array<string | null> => readStringColumn(json, bin, 0, name) ?? [];
    const table = { class: column('class'), id: column('id'), wallId: column('wallId'), side: column('side'), roomId: column('roomId') };
    expect.soft(table.class.length).toBeGreaterThan(0);

    const unresolved: string[] = [];
    const seen = new Set<string>();
    const reached = new Set<number>();
    for (const [nodeIndex, node] of (json.nodes ?? []).entries()) {
      const element = elementOf(node.extras);
      if (!element) continue;
      seen.add(element.class);
      for (const meshIndex of meshesOf(json, nodeIndex)) {
        for (const [primitiveIndex, primitive] of (json.meshes?.[meshIndex]?.primitives ?? []).entries()) {
          const where = `nodes[${nodeIndex}] ${element.class} ${element.id ?? `${element.wallId}/${element.side}`}, meshes[${meshIndex}].primitives[${primitiveIndex}]`;
          const set = (
            primitive.extensions?.['EXT_mesh_features'] as
              | { featureIds?: Array<{ attribute?: number; propertyTable?: number }> }
              | undefined
          )?.featureIds?.[0];
          const accessor = set?.attribute === undefined ? undefined : primitive.attributes[`_FEATURE_ID_${set.attribute}`];
          const ids = accessor === undefined ? null : readScalars(json, bin, accessor);
          const row = ids?.[0];
          if (set?.propertyTable !== 0 || !ids || row === undefined || ids.some((id) => id !== row)) {
            unresolved.push(`${where}: no single feature id into jeexElements`);
            continue;
          }
          const actual =
            element.class === 'wallFace'
              ? { class: table.class[row], wallId: table.wallId[row], side: table.side[row], roomId: table.roomId[row] ?? null }
              : { class: table.class[row], id: table.id[row] };
          const expected = element.class === 'wallFace' ? element : { class: element.class, id: element.id };
          if (JSON.stringify(actual) === JSON.stringify(expected)) reached.add(row);
          else unresolved.push(`${where}: row ${row} is ${JSON.stringify(actual)}`);
        }
      }
    }
    expect.soft([...seen].toSorted()).toEqual(['furniture', 'opening', 'room', 'wallFace']);
    expect.soft(unresolved.slice(0, 20)).toEqual([]);
    // From the row side too, so the check does not only follow what the tagging code tagged: every
    // row of a class a primitive should carry is reached by at least one primitive. `wall` rows are
    // reached through `wallId` of their face rows and carry no primitive of their own.
    const unreached = table.class.flatMap((rowClass, row) =>
      rowClass !== null && rowClass !== 'wall' && !reached.has(row) ? [`row ${row} (${rowClass})`] : [],
    );
    expect.soft(unreached.slice(0, 20)).toEqual([]);
  }, 180_000);
});

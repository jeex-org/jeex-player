/**
 * A strict reader of the two metadata extensions an exported GLB carries,
 * written against their published specification (EXT_mesh_features and
 * EXT_structural_metadata, glTF 2.0 vendor extensions by Cesium):
 *
 * - `EXT_mesh_features` lives on mesh PRIMITIVES only. A feature id set is
 *   `{ featureCount, nullFeatureId?, label?, attribute?, texture?,
 *   propertyTable? }`; `featureCount` is the number of distinct features,
 *   `nullFeatureId` is a non-negative integer, and with neither `attribute` nor
 *   `texture` the feature id of a vertex is its index.
 * - A property table stores every property in binary: `values` names a
 *   bufferView, a STRING property also has `stringOffsets` (count + 1 offsets).
 *   An absent value is the class property's `noData` sentinel, never a JSON
 *   `null`, and `noData` is not allowed on a required property. A
 *   `stringOffsets` bufferView is aligned to its offset width and holds
 *   exactly count + 1 offsets.
 * - Deliberately stricter than the reference validator in one place: the
 *   distinct ids of a feature id attribute must EQUAL `featureCount` (the
 *   spec text), where the validator only fails when they exceed it.
 *
 * The Khronos glTF Validator checks the core format but reports both
 * extensions as unsupported (Information), so this module is the part of the
 * conformance test that actually reads them. It returns a list of findings
 * instead of throwing, so one run names every breach at once.
 */

import { z } from 'zod';

const ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const index = z.number().int().nonnegative();
const passThrough = { extensions: z.record(z.string(), z.unknown()).optional(), extras: z.unknown().optional() };

const featureIdSchema = z.strictObject({
  featureCount: z.number().int().min(1),
  nullFeatureId: index.optional(),
  label: z.string().regex(ID).optional(),
  attribute: index.optional(),
  texture: z.looseObject({ index, texCoord: index.optional(), channels: z.array(index).optional() }).optional(),
  propertyTable: index.optional(),
  ...passThrough,
});

const meshFeaturesSchema = z.strictObject({ featureIds: z.array(featureIdSchema).min(1), ...passThrough });

const PROPERTY_TYPES = ['SCALAR', 'VEC2', 'VEC3', 'VEC4', 'MAT2', 'MAT3', 'MAT4', 'STRING', 'BOOLEAN', 'ENUM'] as const;

const classPropertySchema = z.looseObject({
  type: z.enum(PROPERTY_TYPES),
  required: z.boolean().optional(),
  noData: z.unknown().optional(),
});

const OFFSET_TYPES = ['UINT8', 'UINT16', 'UINT32', 'UINT64'] as const;

const tablePropertySchema = z.looseObject({
  values: index,
  stringOffsets: index.optional(),
  stringOffsetType: z.enum(OFFSET_TYPES).optional(),
  arrayOffsets: index.optional(),
});

const structuralMetadataSchema = z.looseObject({
  schema: z.looseObject({
    id: z.string().regex(ID),
    classes: z
      .record(z.string().regex(ID), z.looseObject({ properties: z.record(z.string().regex(ID), classPropertySchema).optional() }))
      .optional(),
  }),
  propertyTables: z
    .array(
      z.looseObject({
        class: z.string(),
        count: z.number().int().min(1),
        properties: z.record(z.string(), tablePropertySchema).optional(),
      }),
    )
    .optional(),
});

type Accessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean };
type BufferView = { byteOffset?: number; byteLength: number; byteStride?: number };
type Primitive = { attributes: Record<string, number>; extensions?: Record<string, unknown> };
export type GltfJson = {
  extensionsUsed?: string[];
  extensions?: Record<string, unknown>;
  nodes?: Array<{ mesh?: number; children?: number[]; extensions?: Record<string, unknown>; extras?: Record<string, unknown> }>;
  meshes?: Array<{ primitives: Primitive[]; extensions?: Record<string, unknown> }>;
  accessors?: Accessor[];
  bufferViews?: BufferView[];
};

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Every element of a SCALAR accessor, read from the BIN chunk (`null` when it has no bufferView). */
export function readScalars(json: GltfJson, bin: Uint8Array, accessorIndex: number): number[] | null {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) return null;
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const size = COMPONENT_BYTES[accessor.componentType] ?? 4;
  const stride = view.byteStride ?? size;
  const data = new DataView(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0));
  const out: number[] = [];
  for (let element = 0; element < accessor.count; element += 1) {
    const at = element * stride;
    switch (accessor.componentType) {
      case 5121:
        out.push(data.getUint8(at));
        break;
      case 5123:
        out.push(data.getUint16(at, true));
        break;
      case 5125:
        out.push(data.getUint32(at, true));
        break;
      default:
        out.push(data.getFloat32(at, true));
    }
  }
  return out;
}

/** The bytes of one bufferView. */
function viewBytes(json: GltfJson, bin: Uint8Array, viewIndex: number): Uint8Array | null {
  const view = json.bufferViews?.[viewIndex];
  if (!view) return null;
  const start = view.byteOffset ?? 0;
  if (start + view.byteLength > bin.byteLength) return null;
  return bin.subarray(start, start + view.byteLength);
}

/**
 * The cells of a STRING property of a binary property table, with the class's
 * `noData` sentinel turned back into `null`; `null` overall (with a finding)
 * when the property is not stored the way the specification says.
 */
export function readStringColumn(
  json: GltfJson,
  bin: Uint8Array,
  tableIndex: number,
  property: string,
  findings: string[] = [],
): Array<string | null> | null {
  const metadata = structuralMetadataSchema.safeParse(json.extensions?.['EXT_structural_metadata']);
  if (!metadata.success) return null;
  const table = metadata.data.propertyTables?.[tableIndex];
  const definition = table ? metadata.data.schema.classes?.[table.class]?.properties?.[property] : undefined;
  const stored = table?.properties?.[property];
  const where = `propertyTables[${tableIndex}].properties.${property}`;
  if (!table || !definition) return null;
  if (!stored)
    return definition.required === true
      ? (findings.push(`${where}: required property missing`), null)
      : Array.from({ length: table.count }, () => null);
  if (stored.stringOffsets === undefined) return (findings.push(`${where}: STRING property without stringOffsets`), null);
  const values = viewBytes(json, bin, stored.values);
  const offsetBytes = viewBytes(json, bin, stored.stringOffsets);
  if (!values || !offsetBytes) return (findings.push(`${where}: values/stringOffsets bufferView out of range`), null);
  const offsetType = stored.stringOffsetType ?? 'UINT32';
  const width = { UINT8: 1, UINT16: 2, UINT32: 4, UINT64: 8 }[offsetType];
  // The extension: offsets are aligned to their component size, and there are exactly count + 1 of them.
  if ((json.bufferViews?.[stored.stringOffsets]?.byteOffset ?? 0) % width !== 0)
    return (findings.push(`${where}: stringOffsets not aligned to ${offsetType}`), null);
  if (offsetBytes.byteLength !== (table.count + 1) * width) return (findings.push(`${where}: not exactly count + 1 string offsets`), null);
  const offsets = new DataView(offsetBytes.buffer, offsetBytes.byteOffset, offsetBytes.byteLength);
  const read = (at: number): number =>
    width === 1
      ? offsets.getUint8(at)
      : width === 2
        ? offsets.getUint16(at, true)
        : width === 4
          ? offsets.getUint32(at, true)
          : Number(offsets.getBigUint64(at, true));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cells: Array<string | null> = [];
  for (let row = 0; row < table.count; row += 1) {
    const start = read(row * width);
    const end = read((row + 1) * width);
    if (end < start || end > values.byteLength)
      return (findings.push(`${where}: string offsets not ascending within values at row ${row}`), null);
    let text: string;
    try {
      text = decoder.decode(values.subarray(start, end));
    } catch {
      return (findings.push(`${where}: row ${row} is not UTF-8`), null);
    }
    cells.push(definition.noData !== undefined && text === definition.noData ? null : text);
  }
  if (read(table.count * width) !== values.byteLength) findings.push(`${where}: last string offset is not the values byteLength`);
  return cells;
}

/**
 * Every breach of the two extensions in `json`/`bin`, one line each; an empty
 * list means a conformant file.
 */
export function metadataFindings(json: GltfJson, bin: Uint8Array): string[] {
  const findings: string[] = [];
  const used = new Set(json.extensionsUsed ?? []);

  for (const [nodeIndex, node] of (json.nodes ?? []).entries()) {
    if (node.extensions?.['EXT_mesh_features'] !== undefined)
      findings.push(`nodes[${nodeIndex}]: EXT_mesh_features is a primitive extension, not a node one`);
  }
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    if (mesh.extensions?.['EXT_mesh_features'] !== undefined)
      findings.push(`meshes[${meshIndex}]: EXT_mesh_features is a primitive extension, not a mesh one`);
  }

  const raw = json.extensions?.['EXT_structural_metadata'];
  const metadata = raw === undefined ? null : structuralMetadataSchema.safeParse(raw);
  if (metadata && !metadata.success) {
    for (const issue of metadata.error.issues.slice(0, 10))
      findings.push(`EXT_structural_metadata.${issue.path.join('.')}: ${issue.message}`);
  }
  const tables = metadata?.success ? (metadata.data.propertyTables ?? []) : [];
  if (raw !== undefined && !used.has('EXT_structural_metadata')) findings.push('EXT_structural_metadata not declared in extensionsUsed');
  if (metadata?.success) {
    for (const [tableIndex, table] of tables.entries()) {
      const definition = metadata.data.schema.classes?.[table.class];
      if (!definition) {
        findings.push(`propertyTables[${tableIndex}]: class ${table.class} is not in the schema`);
        continue;
      }
      for (const [name, property] of Object.entries(definition.properties ?? {})) {
        if (property.required === true && property.noData !== undefined)
          findings.push(`class ${table.class}.${name}: noData on a required property`);
        if (property.type === 'STRING') readStringColumn(json, bin, tableIndex, name, findings);
      }
      for (const name of Object.keys(table.properties ?? {})) {
        if (!definition.properties?.[name])
          findings.push(`propertyTables[${tableIndex}].properties.${name}: not a property of class ${table.class}`);
      }
    }
  }

  let primitivesWithFeatures = 0;
  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      const where = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      const rawFeatures = primitive.extensions?.['EXT_mesh_features'];
      if (rawFeatures === undefined) continue;
      primitivesWithFeatures += 1;
      const parsed = meshFeaturesSchema.safeParse(rawFeatures);
      if (!parsed.success) {
        findings.push(
          `${where}.EXT_mesh_features: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
        );
        continue;
      }
      const vertexCount = json.accessors?.[primitive.attributes['POSITION'] ?? -1]?.count ?? 0;
      for (const [setIndex, set] of parsed.data.featureIds.entries()) {
        const at = `${where}.featureIds[${setIndex}]`;
        if (set.propertyTable !== undefined && set.propertyTable >= tables.length)
          findings.push(`${at}: propertyTable ${set.propertyTable} does not exist`);
        if (set.texture !== undefined) continue;
        if (set.attribute === undefined) {
          if (set.featureCount !== vertexCount)
            findings.push(`${at}: implicit (vertex index) ids need featureCount = vertex count ${vertexCount}`);
          continue;
        }
        const accessorIndex = primitive.attributes[`_FEATURE_ID_${set.attribute}`];
        const accessor = accessorIndex === undefined ? undefined : json.accessors?.[accessorIndex];
        if (accessorIndex === undefined || !accessor) {
          findings.push(`${at}: no _FEATURE_ID_${set.attribute} attribute`);
          continue;
        }
        if (accessor.type !== 'SCALAR' || accessor.normalized === true)
          findings.push(`${at}: _FEATURE_ID_${set.attribute} must be SCALAR and not normalized`);
        const ids = readScalars(json, bin, accessorIndex) ?? [];
        const distinct = new Set(ids.filter((id) => id !== set.nullFeatureId));
        if (distinct.size !== set.featureCount) findings.push(`${at}: featureCount ${set.featureCount} but ${distinct.size} distinct ids`);
        const rows = set.propertyTable === undefined ? undefined : tables[set.propertyTable]?.count;
        for (const id of distinct) {
          if (!Number.isInteger(id) || id < 0) findings.push(`${at}: feature id ${id} is not a non-negative integer`);
          else if (rows !== undefined && id >= rows) findings.push(`${at}: feature id ${id} is past the table's ${rows} rows`);
        }
      }
    }
  }
  if (primitivesWithFeatures > 0 && !used.has('EXT_mesh_features')) findings.push('EXT_mesh_features not declared in extensionsUsed');
  return findings;
}

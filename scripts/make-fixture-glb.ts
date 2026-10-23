/**
 * Generates `tests/fixtures/project/obj/box-sofa@1.0.0.glb`, the only GLB the
 * repository carries.
 *
 * It lives INSIDE the fixture project (`tests/fixtures/project/`) rather
 * than in a models folder of its own: a baked project names every file by a
 * path relative to its manifest, so the one GLB has to sit where the manifest
 * says it does (a bake writes `obj/<versionId>.glb`; the fixture keeps a
 * readable name, since a file name inside the folder carries no identity) —
 * and one binary serves both the loader tests and the project fixture instead
 * of being duplicated.
 *
 * Why generated and not committed as an exported binary: concrete asset ids
 * and their bytes stay outside the viewer, and real catalogue exports are
 * 737 KB and 3.4 MB — neither belongs in git. The
 * loader still needs a REAL container to prove itself against, so this script
 * writes a minimal, deterministic one by hand: no exporter, no DOM, no
 * `Blob`/`FileReader` polyfills, and byte-identical on every run so the
 * committed file can be diffed against a fresh build (`make-fixture-glb.test.ts`).
 *
 * The shape follows the catalogue conventions so the fixture is
 * also the executable statement of them: metres, pivot at the centre of the
 * floor footprint, front towards -Z (the backrest sits at +Z), bounding box
 * equal to the archetype `dims`, and materials named for the finish slots the
 * loader binds. Two materials on purpose — `frame` is a `FinishSlot` and binds
 * by the name convention, `seat` is not and binds only through an explicit
 * `materialSlots` entry — so one fixture exercises both halves of the binding
 * rule.
 *
 * A second, textured file (`BASISU_FIXTURE_OUTPUT`) carries the same box with
 * a `KHR_texture_basisu` base colour, for the KTX2 path.
 *
 * CLI: `bun scripts/make-fixture-glb.ts` (writes both fixtures in place).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Where the fixture lives, relative to the repository root. */
export const FIXTURE_OUTPUT = 'tests/fixtures/project/obj/box-sofa@1.0.0.glb';

/**
 * The same box sofa with texture coordinates and a KTX2 base colour on its
 * `frame` behind `KHR_texture_basisu` (required, no fallback), the shape a
 * KTX2 bake ships. The image is the committed `swatch.16.ktx2` (saturated red,
 * `scripts/make-fixture-ktx2.ts`), so this file is rebuilt from committed
 * bytes alone and stays deterministic.
 */
export const BASISU_FIXTURE_OUTPUT = 'tests/fixtures/project/obj/box-sofa-basisu@1.0.0.glb';
/** The KTX2 image the basisu fixture embeds, relative to the repository root. */
export const BASISU_FIXTURE_IMAGE = 'tests/fixtures/ktx2/swatch.16.ktx2';

/** `[width, height, depth]` in metres — the bbox the loader validates against. */
export const FIXTURE_DIMS: readonly [number, number, number] = [2.1, 0.85, 0.95];

/** A fixture larger than this is not a fixture; the gate keeps binaries out of the tree. */
export const FIXTURE_SIZE_LIMIT = 10 * 1024;

/** Height the seat block ends and the backrest begins, metres. */
const SEAT_TOP = 0.42;

/** How deep the backrest is, metres, measured from the back face forwards. */
const BACK_DEPTH = 0.2;

type Box = { min: readonly [number, number, number]; max: readonly [number, number, number] };

/** The two blocks: a seat slab on the floor and a backrest along the +Z (rear) edge. */
function blocks(): readonly Box[] {
  const hx = FIXTURE_DIMS[0] / 2;
  const hz = FIXTURE_DIMS[2] / 2;
  return [
    { min: [-hx, 0, -hz], max: [hx, SEAT_TOP, hz] },
    { min: [-hx, SEAT_TOP, hz - BACK_DEPTH], max: [hx, FIXTURE_DIMS[1], hz] },
  ];
}

/** Face definitions of an axis-aligned box: outward normal plus the four corners, counter-clockwise. */
const FACES: readonly { normal: readonly [number, number, number]; corners: readonly (readonly [0 | 1, 0 | 1, 0 | 1])[] }[] = [
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
];

type Mesh = { positions: number[]; normals: number[]; uvs: number[]; indices: number[][] };

/** The four corners of every face in texture space, in the order `FACES` lists them. */
const FACE_UVS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

/** Welds the blocks into one vertex buffer with one index run per block. */
function tessellate(boxes: readonly Box[]): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[][] = [];
  for (const box of boxes) {
    const run: number[] = [];
    for (const face of FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(corner[0] ? box.max[0] : box.min[0], corner[1] ? box.max[1] : box.min[1], corner[2] ? box.max[2] : box.min[2]);
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
      }
      for (const uv of FACE_UVS) uvs.push(uv[0], uv[1]);
      run.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    indices.push(run);
  }
  return { positions, normals, uvs, indices };
}

/** Component-wise minimum and maximum of a flat `xyz` triple list, as glTF accessors declare them. */
function bounds(values: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 3) {
    for (const axis of [0, 1, 2]) {
      const value = values[index + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min, max };
}

/** Pads `length` up to the next 4-byte boundary, as every glTF chunk and buffer view must be. */
function aligned(length: number): number {
  return (length + 3) & ~3;
}

/** Reads the JSON chunk of a GLB container without a glTF parser — used by the test and by the CLI report. */
export function glbJson(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
}

/**
 * The fixture, as GLB bytes.
 *
 * Accessor 0 is the shared position buffer of BOTH blocks, so its `min`/`max`
 * are the model's bounding box — which is what makes the pivot and the
 * dimensions readable from the JSON chunk alone.
 */
export function buildFixtureGlb(basisu?: Uint8Array): Uint8Array {
  const mesh = tessellate(blocks());
  const box = bounds(mesh.positions);

  const positionBytes = mesh.positions.length * 4;
  const normalBytes = mesh.normals.length * 4;
  const indexRuns = mesh.indices.map((run) => run.length * 2);
  const indexOffsets: number[] = [];
  let cursor = positionBytes + normalBytes;
  for (const length of indexRuns) {
    indexOffsets.push(cursor - positionBytes - normalBytes);
    cursor = aligned(cursor + length);
  }
  const indexBytes = cursor - positionBytes - normalBytes;
  // The textured variant appends its texture coordinates and its image after the indices.
  const uvOffset = cursor;
  const uvBytes = basisu === undefined ? 0 : mesh.uvs.length * 4;
  const imageOffset = uvOffset + uvBytes;
  const imageBytes = basisu === undefined ? 0 : aligned(basisu.byteLength);

  const binary = new Uint8Array(imageOffset + imageBytes);
  const binaryView = new DataView(binary.buffer);
  mesh.positions.forEach((value, index) => binaryView.setFloat32(index * 4, value, true));
  mesh.normals.forEach((value, index) => binaryView.setFloat32(positionBytes + index * 4, value, true));
  mesh.indices.forEach((run, runIndex) => {
    const base = positionBytes + normalBytes + indexOffsets[runIndex]!;
    run.forEach((value, index) => binaryView.setUint16(base + index * 2, value, true));
  });
  if (basisu !== undefined) {
    mesh.uvs.forEach((value, index) => binaryView.setFloat32(uvOffset + index * 4, value, true));
    binary.set(basisu, imageOffset);
  }
  const textured = basisu !== undefined;

  const json = {
    asset: { version: '2.0', generator: 'jeex scripts/make-fixture-glb.ts', copyright: 'CC0-1.0' },
    extras: { jeexFixture: true },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'box_sofa', mesh: 0 }],
    meshes: [
      {
        name: 'box_sofa',
        primitives: mesh.indices.map((_, index) => ({
          attributes: textured ? { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 + mesh.indices.length } : { POSITION: 0, NORMAL: 1 },
          indices: 2 + index,
          material: index,
        })),
      },
    ],
    materials: [
      { name: 'seat', pbrMetallicRoughness: { baseColorFactor: [0.78, 0.73, 0.64, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      textured
        ? { name: 'frame', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 } }
        : { name: 'frame', pbrMetallicRoughness: { baseColorFactor: [0.45, 0.33, 0.22, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
    ],
    ...(textured && {
      extensionsUsed: ['KHR_texture_basisu'],
      extensionsRequired: ['KHR_texture_basisu'],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      textures: [{ sampler: 0, extensions: { KHR_texture_basisu: { source: 0 } } }],
      images: [{ bufferView: 4, mimeType: 'image/ktx2' }],
    }),
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.positions.length / 3, type: 'VEC3', min: box.min, max: box.max },
      { bufferView: 1, componentType: 5126, count: mesh.normals.length / 3, type: 'VEC3' },
      ...mesh.indices.map((run, index) => ({
        bufferView: 2,
        byteOffset: indexOffsets[index]!,
        componentType: 5123,
        count: run.length,
        type: 'SCALAR',
      })),
      ...(textured ? [{ bufferView: 3, componentType: 5126, count: mesh.uvs.length / 2, type: 'VEC2' }] : []),
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: normalBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes + normalBytes, byteLength: indexBytes, target: 34963 },
      ...(textured
        ? [
            { buffer: 0, byteOffset: uvOffset, byteLength: uvBytes, target: 34962 },
            { buffer: 0, byteOffset: imageOffset, byteLength: basisu.byteLength },
          ]
        : []),
    ],
    buffers: [{ byteLength: binary.byteLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(aligned(jsonBytes.byteLength)).fill(0x20);
  jsonChunk.set(jsonBytes);
  const binaryChunk = new Uint8Array(aligned(binary.byteLength));
  binaryChunk.set(binary);

  const total = 12 + 8 + jsonChunk.byteLength + 8 + binaryChunk.byteLength;
  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonChunk, 20);
  view.setUint32(20 + jsonChunk.byteLength, binaryChunk.byteLength, true);
  view.setUint32(24 + jsonChunk.byteLength, 0x004e4942, true);
  glb.set(binaryChunk, 28 + jsonChunk.byteLength);
  return glb;
}

/** The basisu fixture, built from the committed KTX2 image. */
export function buildBasisuFixtureGlb(): Uint8Array {
  return buildFixtureGlb(new Uint8Array(readFileSync(resolve(import.meta.dirname, '..', BASISU_FIXTURE_IMAGE))));
}

if (import.meta.main) {
  for (const [output, bytes] of [
    [FIXTURE_OUTPUT, buildFixtureGlb()],
    [BASISU_FIXTURE_OUTPUT, buildBasisuFixtureGlb()],
  ] as const) {
    const path = resolve(import.meta.dirname, '..', output);
    if (bytes.byteLength > FIXTURE_SIZE_LIMIT) {
      console.error(`make-fixture-glb: ${bytes.byteLength} bytes exceeds the ${FIXTURE_SIZE_LIMIT}-byte fixture limit`);
      process.exit(1);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    console.log(`make-fixture-glb: wrote ${output} (${bytes.byteLength} bytes)`);
  }
}

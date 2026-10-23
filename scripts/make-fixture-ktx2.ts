/**
 * Generates the KTX2 (Basis Universal) fixtures under `tests/fixtures/ktx2/`.
 *
 * The browser has no KTX2 encoder, so the tests cannot make these on the fly
 * the way the WebP tests encode their PNGs: the files are committed, and this
 * script is how they were made. It is NOT part of any check tier; run it by
 * hand after changing a picture below, with KTX-Software's `ktx` tool:
 *
 *   bun scripts/make-fixture-ktx2.ts <path-to-ktx>
 *
 * The encoder settings are the ones an asset bake uses for each kind of map:
 * colour as ETC1S (BasisLZ) in sRGB with BT.709 primaries, normal and data
 * maps as UASTC with Zstd in linear with unspecified primaries, every file with
 * its full mip chain, in KTX's default orientation (`KTXorientation` "rd": the
 * first row of the file is the TOP of the picture, as in glTF). The pictures
 * are deliberately coarse, so each property a test pins (which way is up,
 * which way a normal leans, which channel is which) survives block
 * compression as a large difference.
 *
 * `scripts/make-fixture-ktx2.test.ts` keeps the committed files honest: each
 * is a Basis KTX2 of the size its name says, and small.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

/** Where the fixtures live, relative to the repository root. */
export const KTX2_FIXTURE_DIR = 'tests/fixtures/ktx2';

/** A fixture larger than this is not a fixture. */
export const KTX2_FIXTURE_SIZE_LIMIT = 4 * 1024;

type Rgb = readonly [number, number, number];

/** What a map holds, which decides its encoder settings. */
type MapKind = 'colour' | 'linear';

/** One fixture: its file name, edge in pixels, kind and picture (`x` right, `y` down). */
type Fixture = { name: string; size: number; kind: MapKind; pixel: (x: number, y: number, size: number) => Rgb };

/** The committed fixtures. */
export const KTX2_FIXTURES: readonly Fixture[] = [
  // The top quarter white, the rest black: which way is up on a wall.
  { name: 'orientation.128.ktx2', size: 128, kind: 'colour', pixel: (_, y, size) => (y < size / 4 ? [255, 255, 255] : [0, 0, 0]) },
  // OpenGL tangent space (0, 0.6, 0.8) encoded as 0.5 + n / 2: a normal that leans towards the top of the picture.
  { name: 'normal-up.128.ktx2', size: 128, kind: 'linear', pixel: () => [128, 204, 230] },
  // A plain white colour map to light the normal map with.
  { name: 'white.128.ktx2', size: 128, kind: 'colour', pixel: () => [255, 255, 255] },
  // The three maps of a scan at 256 px, flat: what a project's room surface downloads.
  { name: 'albedo.256.ktx2', size: 256, kind: 'colour', pixel: () => [128, 96, 64] },
  { name: 'normal.256.ktx2', size: 256, kind: 'linear', pixel: () => [128, 128, 255] },
  { name: 'arm.256.ktx2', size: 256, kind: 'linear', pixel: () => [255, 200, 0] },
  // The base colour of the KHR_texture_basisu furniture fixture: saturated red.
  { name: 'swatch.16.ktx2', size: 16, kind: 'colour', pixel: () => [220, 20, 20] },
];

/** The `ktx create` options of one kind, before the input and output files. */
export function ktxCreateArgs(kind: MapKind): string[] {
  const codec =
    kind === 'colour'
      ? [
          '--format',
          'R8G8B8A8_SRGB',
          '--assign-tf',
          'srgb',
          '--assign-primaries',
          'bt709',
          '--encode',
          'basis-lz',
          '--clevel',
          '4',
          '--qlevel',
          '192',
        ]
      : [
          '--format',
          'R8G8B8_UNORM',
          '--assign-tf',
          'linear',
          '--assign-primaries',
          'none',
          '--encode',
          'uastc',
          '--uastc-quality',
          '2',
          '--zstd',
          '18',
        ];
  return ['create', ...codec, '--generate-mipmap', '--mipmap-wrap', 'wrap', '--fail-on-color-conversions'];
}

/** One PNG chunk: length, type, data and the CRC over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

/** An 8-bit RGB PNG of `fixture`'s picture, with no colour chunk (the encoder is told the transfer function). */
export function fixturePng(fixture: Fixture): Uint8Array {
  const { size } = fixture;
  const raw = new Uint8Array(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x += 1) raw.set(fixture.pixel(x, y, size), row + 1 + x * 3);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

if (import.meta.main) {
  const ktx = process.argv[2];
  if (ktx === undefined) {
    console.error('usage: bun scripts/make-fixture-ktx2.ts <path-to-ktx>');
    process.exit(2);
  }
  const outDir = resolve(import.meta.dirname, '..', KTX2_FIXTURE_DIR);
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'jeex-ktx2-fixtures-'));
  try {
    for (const fixture of KTX2_FIXTURES) {
      const png = join(scratch, `${fixture.name}.png`);
      const out = join(scratch, fixture.name);
      writeFileSync(png, fixturePng(fixture));
      const run = spawnSync(ktx, [...ktxCreateArgs(fixture.kind), png, out], { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`make-fixture-ktx2: ktx create failed for ${fixture.name}: ${run.stderr}`);
      const bytes = readFileSync(out);
      if (bytes.byteLength > KTX2_FIXTURE_SIZE_LIMIT) throw new Error(`make-fixture-ktx2: ${fixture.name} is ${bytes.byteLength} bytes`);
      writeFileSync(join(outDir, fixture.name), bytes);
      console.log(`make-fixture-ktx2: wrote ${KTX2_FIXTURE_DIR}/${fixture.name} (${bytes.byteLength} bytes)`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

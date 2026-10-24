/**
 * Generates the HDRI fixtures under `tests/fixtures/hdri/`: a 1K gain-map
 * (Ultra HDR) JPEG environment, a small AVIF display sky of the same
 * panorama, and a sidecar JSON with the sun facts a host would store for it
 * and the reference radiance the browser tests compare the decode with.
 *
 * The browser has no gain-map or AVIF encoder, so the tests cannot make these
 * on the fly: the files are committed, and this script is how they were made.
 * It is NOT part of any check tier; run it by hand after changing the
 * panorama below, with libultrahdr's `ultrahdr_app` built with
 * `-DUHDR_WRITE_XMP=ON` and ImageMagick 7 built with AVIF support:
 *
 *   bun scripts/make-fixture-hdri.ts <path-to-ultrahdr_app> <path-to-magick>
 *
 * The panorama is procedural and deliberately asymmetric, so a test can tell
 * a rotation, a mirror and a flip apart: a blue sky darker at the zenith than
 * at the horizon, a dark ground, a sun at `FIXTURE_SUN` and a saturated red
 * marker 90° clockwise of the sun (seen from above). The sun is handled the
 * way a library import handles a real one: its share of horizontal
 * irradiance is computed from the unclamped sky, then everything within
 * `SUN_CONE_DEG` of it is replaced by a bounded glow before encoding, so the
 * encoded file holds a bright but finite spot and the analytic sun carries
 * the rest.
 *
 * Mapping: three's equirectangular convention, `u = atan2(z, x) / 2π + 0.5`,
 * `v = asin(y) / π + 0.5`, the first row of the file at the top. Sun azimuths
 * are clockwise from +Z towards +X (`90° − atan2(z, x)`).
 *
 * Metadata: three r186's `UltraHDRLoader` reads the gain-map parameters from
 * the `hdrgm` XMP packet; it does not recognise libultrahdr 2's ISO 21496-1
 * block (it compares the namespace two bytes too early), so the encoder must
 * write XMP, which takes a single-channel gain map (`-M 0`). The same holds
 * for every environment file a host serves.
 *
 * `scripts/make-fixture-hdri.test.ts` keeps the committed files honest.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Where the fixtures live, relative to the repository root. */
export const HDRI_FIXTURE_DIR = 'tests/fixtures/hdri';

/** The committed files. */
export const HDRI_FIXTURE_FILES = Object.freeze({ environment: 'sky-1k.jpg', sky: 'sky-256.avif', sidecar: 'sky.json' });

/** Size limits of the committed files, bytes. */
export const HDRI_ENVIRONMENT_SIZE_LIMIT = 48 * 1024;
export const HDRI_SKY_SIZE_LIMIT = 8 * 1024;

/** The panorama's sun: azimuth clockwise from +Z towards +X, elevation, linear colour, normal irradiance. */
export const FIXTURE_SUN = Object.freeze({
  azimuthDeg: 54,
  elevationDeg: 40,
  colourLinear: [1, 0.93, 0.8] as const,
  normalIrradiance: 2.5,
});

/** Half angle of the cone the import step clamps around the sun, degrees. */
export const SUN_CONE_DEG = 6;
/** Peak radiance of the glow left in the cone, and its width, degrees. */
const GLOW_PEAK = 6;
const GLOW_SIGMA_DEG = 2;

const WIDTH = 1024;
const HEIGHT = 512;
const SKY_WIDTH = 256;
const SKY_HEIGHT = 128;
const DEG = Math.PI / 180;

type Vec = { x: number; y: number; z: number };
type Rgb = readonly [number, number, number];

/** The unit direction of pixel `(i, j)`'s centre in a `width` × `height` panorama. */
export function panoramaDirection(i: number, j: number, width: number, height: number): Vec {
  const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
  const elevation = (0.5 - (j + 0.5) / height) * Math.PI;
  return { x: Math.cos(elevation) * Math.cos(phi), y: Math.sin(elevation), z: Math.cos(elevation) * Math.sin(phi) };
}

function fromAngles(azimuthCwDeg: number, elevationDeg: number): Vec {
  const a = azimuthCwDeg * DEG;
  const e = elevationDeg * DEG;
  return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: Math.cos(a) * Math.cos(e) };
}

const SUN_DIRECTION = fromAngles(FIXTURE_SUN.azimuthDeg, FIXTURE_SUN.elevationDeg);
const MARKER_DIRECTION = fromAngles(FIXTURE_SUN.azimuthDeg + 90, 12);

const angleTo = (a: Vec, b: Vec): number => Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))) / DEG;

/** The sky without its sun: gradient, ground and the red marker. Linear radiance. */
function skyRadiance(d: Vec): [number, number, number] {
  if (d.y < 0) return [0.06, 0.055, 0.05];
  const t = Math.sqrt(d.y);
  const horizon: Rgb = [0.55, 0.6, 0.68];
  const zenith: Rgb = [0.12, 0.2, 0.42];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) out[c] = horizon[c]! + (zenith[c]! - horizon[c]!) * t;
  // A rectangle 20° wide and 10° high around the marker's direction.
  const azimuth = (Math.atan2(d.x, d.z) / DEG + 360) % 360;
  const markerAzimuth = (FIXTURE_SUN.azimuthDeg + 90) % 360;
  const elevation = Math.asin(d.y) / DEG;
  const da = Math.abs(((azimuth - markerAzimuth + 540) % 360) - 180);
  if (da < 10 && elevation > 7 && elevation < 17) return [1.6, 0.04, 0.03];
  return out;
}

/** What the encoded panorama holds in direction `d`: the sky, and the bounded glow inside the sun cone. */
export function proceduralRadiance(d: Vec): Rgb {
  const sky = skyRadiance(d);
  const angle = angleTo(d, SUN_DIRECTION);
  if (angle > SUN_CONE_DEG) return sky;
  const glow = GLOW_PEAK * Math.exp(-(angle * angle) / (2 * GLOW_SIGMA_DEG * GLOW_SIGMA_DEG));
  return [
    sky[0] + glow * FIXTURE_SUN.colourLinear[0],
    sky[1] + glow * FIXTURE_SUN.colourLinear[1],
    sky[2] + glow * FIXTURE_SUN.colourLinear[2],
  ];
}

const luminance = (rgb: Rgb): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/** Solid angle of a pixel centred at elevation `e` in a `width` × `height` panorama. */
const pixelSolidAngle = (elevation: number, width: number, height: number): number =>
  ((2 * Math.PI) / width) * (Math.PI / height) * Math.cos(elevation);

/** Measurements of the encoded panorama and the sun's facts. */
export function measure(): {
  radiance: Float32Array;
  skyMeanLuminance: number;
  skyHorizontalIrradiance: number;
  coneResidual: number;
  share: number;
} {
  const radiance = new Float32Array(WIDTH * HEIGHT * 4);
  let skySum = 0;
  let skyCount = 0;
  let outside = 0;
  let cone = 0;
  let coneSky = 0;
  for (let j = 0; j < HEIGHT; j += 1) {
    for (let i = 0; i < WIDTH; i += 1) {
      const d = panoramaDirection(i, j, WIDTH, HEIGHT);
      const value = proceduralRadiance(d);
      const at = (j * WIDTH + i) * 4;
      radiance[at] = value[0];
      radiance[at + 1] = value[1];
      radiance[at + 2] = value[2];
      radiance[at + 3] = 1;
      const inCone = angleTo(d, SUN_DIRECTION) <= SUN_CONE_DEG;
      if (!inCone && angleTo(d, MARKER_DIRECTION) > 15) {
        skySum += luminance(value);
        skyCount += 1;
      }
      if (d.y <= 0) continue;
      const weight = d.y * pixelSolidAngle(Math.asin(d.y), WIDTH, HEIGHT);
      if (inCone) {
        cone += luminance(value) * weight;
        coneSky += luminance(skyRadiance(d)) * weight;
      } else {
        outside += luminance(value) * weight;
      }
    }
  }
  // The unclamped cone held the sky and the sun; the share is the cone's part of all horizontal irradiance.
  const sunLuminance = luminance(FIXTURE_SUN.colourLinear) / Math.max(...FIXTURE_SUN.colourLinear);
  const unclampedCone = coneSky + FIXTURE_SUN.normalIrradiance * sunLuminance * Math.sin(FIXTURE_SUN.elevationDeg * DEG);
  return {
    radiance,
    skyMeanLuminance: skySum / skyCount,
    skyHorizontalIrradiance: outside,
    coneResidual: cone,
    share: unclampedCone / (unclampedCone + outside),
  };
}

const toHalf = (values: Float32Array): Uint8Array => {
  const half = new Float16Array(values.length);
  half.set(values);
  return new Uint8Array(half.buffer);
};

/** The sky for the windows: ACES-fitted tone mapping, sRGB, box-filtered down to `SKY_WIDTH` × `SKY_HEIGHT`, as a binary PPM. */
function displayPpm(radiance: Float32Array): Uint8Array {
  const aces = (x: number): number => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
  const srgb = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  const step = WIDTH / SKY_WIDTH;
  const out = new Uint8Array(SKY_WIDTH * SKY_HEIGHT * 3);
  for (let j = 0; j < SKY_HEIGHT; j += 1) {
    for (let i = 0; i < SKY_WIDTH; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let dj = 0; dj < step; dj += 1)
          for (let di = 0; di < step; di += 1) sum += radiance[((j * step + dj) * WIDTH + i * step + di) * 4 + c]!;
        out[(j * SKY_WIDTH + i) * 3 + c] = Math.round(srgb(aces(sum / (step * step))) * 255);
      }
    }
  }
  const header = new TextEncoder().encode(`P6\n${SKY_WIDTH} ${SKY_HEIGHT}\n255\n`);
  const ppm = new Uint8Array(header.length + out.length);
  ppm.set(header);
  ppm.set(out, header.length);
  return ppm;
}

function run(tool: string, args: string[]): string {
  const result = spawnSync(tool, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`make-fixture-hdri: ${tool} ${args.join(' ')} failed: ${result.stderr}${result.stdout}`);
  return `${result.stdout}${result.stderr}`;
}

if (import.meta.main) {
  const [ultrahdr, magick] = process.argv.slice(2);
  if (ultrahdr === undefined || magick === undefined) {
    console.error('usage: bun scripts/make-fixture-hdri.ts <path-to-ultrahdr_app> <path-to-magick>');
    process.exit(2);
  }
  const outDir = resolve(import.meta.dirname, '..', HDRI_FIXTURE_DIR);
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'jeex-hdri-fixtures-'));
  try {
    const facts = measure();
    const raw = join(scratch, 'sky.raw');
    writeFileSync(raw, toHalf(facts.radiance));
    const environment = join(scratch, HDRI_FIXTURE_FILES.environment);
    // Linear half-float input, BT.709 both intents, base and gain map quality 85, gain map at half size, one channel (XMP).
    const uhdrArgs = [
      ...['-m', '0', '-p', raw, '-a', '4', '-t', '0', '-C', '0', '-c', '0', '-M', '0'],
      ...['-w', String(WIDTH), '-h', String(HEIGHT), '-q', '85', '-Q', '85', '-s', '2', '-z', environment],
    ];
    run(ultrahdr, uhdrArgs);
    const ppm = join(scratch, 'sky.ppm');
    writeFileSync(ppm, displayPpm(facts.radiance));
    const sky = join(scratch, HDRI_FIXTURE_FILES.sky);
    run(magick, [ppm, '-strip', '-quality', '60', sky]);
    const versions = {
      magick: run(magick, ['-version']).split('\n')[0]!.trim(),
      ultrahdr: 'libultrahdr ultrahdr_app (see the encoder arguments)',
    };
    const sidecar = {
      width: WIDTH,
      height: HEIGHT,
      sun: {
        azimuthDeg: FIXTURE_SUN.azimuthDeg,
        elevationDeg: FIXTURE_SUN.elevationDeg,
        colourLinear: [...FIXTURE_SUN.colourLinear],
        horizontalIrradianceShare: Number(facts.share.toFixed(4)),
      },
      reference: {
        skyMeanLuminance: Number(facts.skyMeanLuminance.toFixed(5)),
        skyHorizontalIrradiance: Number(facts.skyHorizontalIrradiance.toFixed(5)),
        coneResidual: Number(facts.coneResidual.toFixed(5)),
        sunConeDeg: SUN_CONE_DEG,
        note: 'luminance-weighted, Rec. 709; sky mean excludes the sun cone and 15° around the marker; irradiances over the upper hemisphere',
      },
      encoder: { ultrahdr: uhdrArgs.filter((arg) => !arg.startsWith('/')), magick: ['-strip', '-quality', '60'], versions },
    };
    for (const [name, bytes] of [
      [HDRI_FIXTURE_FILES.environment, readFileSync(environment)],
      [HDRI_FIXTURE_FILES.sky, readFileSync(sky)],
      [HDRI_FIXTURE_FILES.sidecar, Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`)],
    ] as const) {
      writeFileSync(join(outDir, name), bytes);
      console.log(`make-fixture-hdri: wrote ${HDRI_FIXTURE_DIR}/${name} (${bytes.byteLength} bytes)`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

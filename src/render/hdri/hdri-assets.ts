/**
 * Fetches and decodes a host's sky (`lighting.hdri`): the gain-map
 * environment, prefiltered for lighting, and the display sky for the windows.
 * Travels in the walk chunk (`render/walk-post.ts` re-exports it).
 *
 * Environment: one small adapter over three's `UltraHDRLoader`. The bytes are
 * fetched here with the caller's signal (the loader takes none) and handed to
 * `parse`; three r186 throws the asynchronous decode error of the embedded
 * images from inside its own `.catch`, where no caller can catch it, so the
 * adapter points that one error callback (`_applyGainmapToSDR`'s last
 * argument) at its own rejection. Re-check the hook on every three upgrade.
 * The decoded half floats are measured once (`hdri-calibration.ts`), turned
 * into a PMREM, and released with the generator.
 *
 * Sky: the browser decodes it off the main thread (`createImageBitmap`),
 * flipped at decode because three ignores `flipY` for an `ImageBitmap`, with
 * no colour conversion; the bitmap is closed with the texture.
 *
 * Invariant: a load settles exactly once. A failure or an abort of either
 * file aborts the other and leaves no texture, target or bitmap behind.
 * No retry.
 */

import * as THREE from 'three';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';
import type { HdriEntry } from '../../lighting/hdri-entry.js';
import { LIGHTING_STANDARD } from '../../lighting/lighting-standard.js';
import {
  hdriSunIntensity,
  hdriSunNormalIrradiance,
  measureSkyIrradiance,
  panoramaSunDirection,
  type SkyIrradiance,
} from '../../lighting/hdri-calibration.js';

/** The prefiltered environment of one HDRI and what its sun is. */
export type HdriEnvironment = {
  /** Cube-UV PMREM texture, for `scene.environment` and capture backgrounds. */
  readonly texture: THREE.Texture;
  /** Edge of the PMREM's largest cube face, texels. */
  readonly cubeSize: number;
  /** The decoded sky's horizontal irradiance, outside and inside the sun cone (decoded units). */
  readonly sky: SkyIrradiance;
  /** `scene.environmentIntensity` of the HDRI. */
  readonly gain: number;
  /** The analytic sun's `DirectionalLight` intensity. */
  readonly sunIntensity: number;
  dispose(): void;
};

/** The display sky of one HDRI. */
export type HdriSkyTexture = { readonly texture: THREE.Texture; dispose(): void };

/** Both files of one HDRI. */
export type HdriPair = { readonly environment: HdriEnvironment; readonly sky: HdriSkyTexture; dispose(): void };

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** The loader's private decode step and its callbacks, as three r186 declares them. */
type GainMapStep = (
  metadata: unknown,
  sdr: Uint8Array,
  gainMap: Uint8Array,
  onSuccess: (data: Uint16Array, width: number, height: number) => void,
  onError: (error: unknown) => void,
) => void;

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

async function fetchOk(fetcher: Fetch, url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`HDRI file answered HTTP ${String(response.status)}`);
  return response;
}

/** Decodes a gain-map JPEG to half floats; every synchronous and asynchronous error rejects. */
function decodeGainMap(buffer: ArrayBuffer): Promise<{ data: Uint16Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const loader = new UltraHDRLoader();
    loader.setDataType(THREE.HalfFloatType);
    const hooks = loader as unknown as { _applyGainmapToSDR: GainMapStep };
    const step = hooks._applyGainmapToSDR;
    hooks._applyGainmapToSDR = (metadata, sdr, gainMap, onSuccess) =>
      step.call(loader, metadata, sdr, gainMap, onSuccess, (error) => reject(asError(error)));
    try {
      // r186 hands over `data`; its type declarations still call the field `hdrBuffer`.
      loader.parse(buffer, (texture) => resolve(texture as unknown as { data: Uint16Array; width: number; height: number }));
    } catch (error) {
      reject(asError(error));
    }
  });
}

/** Fetches, decodes, measures and prefilters the environment of `entry`. */
export async function loadHdriEnvironment(
  renderer: THREE.WebGLRenderer,
  entry: HdriEntry,
  signal: AbortSignal,
  fetcher: Fetch = fetch,
): Promise<HdriEnvironment> {
  const response = await fetchOk(fetcher, entry.environmentUrl, signal);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  const decoded = await decodeGainMap(buffer);
  signal.throwIfAborted();
  const { hdri } = LIGHTING_STANDARD;
  const { sun } = entry;
  const sky = measureSkyIrradiance({
    data: decoded.data,
    width: decoded.width,
    height: decoded.height,
    sun: panoramaSunDirection(sun.azimuthDeg, sun.elevationDeg),
    coneDeg: hdri.sunConeDeg,
  });
  const gain = hdri.environmentGain * hdri.loaderCompensation;
  const sunIntensity = hdriSunIntensity(
    hdriSunNormalIrradiance(sky, sun.horizontalIrradianceShare, sun.elevationDeg),
    gain,
    sun.colourLinear,
  );
  const equirect = new THREE.DataTexture(decoded.data, decoded.width, decoded.height, THREE.RGBAFormat, THREE.HalfFloatType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.minFilter = THREE.LinearFilter;
  equirect.magFilter = THREE.LinearFilter;
  equirect.generateMipmaps = false;
  // As the loader's own `load` sets it: the decoded rows run from the top of the picture.
  equirect.flipY = true;
  equirect.needsUpdate = true;
  const generator = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget;
  try {
    target = generator.fromEquirectangular(equirect);
  } finally {
    generator.dispose();
    equirect.dispose();
  }
  if (signal.aborted) {
    target.dispose();
    signal.throwIfAborted();
  }
  target.texture.name = 'HdriEnvironment';
  return { texture: target.texture, cubeSize: target.height / 4, sky, gain, sunIntensity, dispose: () => target.dispose() };
}

/** Fetches and decodes the display sky of `entry`. */
export async function loadHdriSky(entry: HdriEntry, signal: AbortSignal, fetcher: Fetch = fetch): Promise<HdriSkyTexture> {
  const response = await fetchOk(fetcher, entry.skyUrl, signal);
  const blob = await response.blob();
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none' });
  if (signal.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  const texture = new THREE.Texture(bitmap);
  texture.name = 'HdriSky';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return {
    texture,
    dispose: () => {
      texture.dispose();
      bitmap.close();
    },
  };
}

/** Both files at once; one failure aborts the other, releases what was made and rejects once. */
export async function loadHdriPair(
  renderer: THREE.WebGLRenderer,
  entry: HdriEntry,
  signal: AbortSignal,
  fetcher: Fetch = fetch,
): Promise<HdriPair> {
  const both = new AbortController();
  const forward = (): void => both.abort(signal.reason);
  if (signal.aborted) forward();
  else signal.addEventListener('abort', forward, { once: true });
  const fail = (error: unknown): never => {
    both.abort(error);
    throw error;
  };
  const environment = loadHdriEnvironment(renderer, entry, both.signal, fetcher).catch(fail);
  const sky = loadHdriSky(entry, both.signal, fetcher).catch(fail);
  try {
    const [settledEnvironment, settledSky] = await Promise.allSettled([environment, sky]);
    if (settledEnvironment.status === 'fulfilled' && settledSky.status === 'fulfilled') {
      const pair = { environment: settledEnvironment.value, sky: settledSky.value };
      return {
        ...pair,
        dispose: () => {
          pair.environment.dispose();
          pair.sky.dispose();
        },
      };
    }
    if (settledEnvironment.status === 'fulfilled') settledEnvironment.value.dispose();
    if (settledSky.status === 'fulfilled') settledSky.value.dispose();
    throw settledEnvironment.status === 'rejected' ? settledEnvironment.reason : (settledSky as PromiseRejectedResult).reason;
  } finally {
    signal.removeEventListener('abort', forward);
  }
}

/**
 * Loads a light bake: its sidecar, the shell GLB it was made for and its
 * atlas pages, judged in that order so nothing is uploaded for a bake that
 * does not fit.
 *
 * The sidecar is judged first, and a caller's `checkSidecar` runs on it before
 * the shell file is fetched; the shell's bytes must hash (SHA-256) to the
 * sidecar's `shellHash`, since a bake applied to any other shell would light
 * the wrong surfaces; only then are the pages fetched and decoded. Level files
 * are resolved next to the sidecar.
 *
 * Invariant: on any failure every page and image already loaded is released;
 * on success the caller owns the result and calls `dispose` once it is done.
 */

import type { LightBake } from './light-bake.js';
import { LightBakeError } from './light-bake-error.js';
import { judgeLightBake } from './light-bake.schema.js';
import { fetchBlob, loadLightmapPage, type FetchBytes, type LightmapPage } from './lightmap-page.js';

/** A loaded bake: the judged sidecar, the verified shell bytes and the pages. */
export type LoadedLightBake = {
  readonly bake: LightBake;
  readonly shell: ArrayBuffer;
  readonly pages: readonly LightmapPage[];
  dispose(): void;
};

/** `sha256:<hex>` of `bytes`. */
export async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A further check of the judged sidecar and the verified shell bytes, run
 * before any page is fetched; it throws a `LightBakeError` to refuse.
 */
export type ShellCheck = (bake: LightBake, shell: ArrayBuffer) => Promise<void>;

/** The caller's further checks; each throws a `LightBakeError` to refuse. */
export type LoadChecks = {
  /** Runs on the judged sidecar before the shell file is fetched. */
  readonly checkSidecar?: (bake: LightBake) => void;
  readonly checkShell?: ShellCheck;
};

/** Loads the bake whose sidecar is `sidecarUrl` for the shell at `shellUrl`. */
export async function loadLightBake(
  sidecarUrl: URL,
  shellUrl: URL,
  fetchBytes: FetchBytes = fetchBlob,
  checks: LoadChecks = {},
): Promise<LoadedLightBake> {
  let document: unknown;
  try {
    document = JSON.parse(await (await fetchBytes(sidecarUrl)).text());
  } catch (error) {
    throw new LightBakeError('sidecar', `light bake sidecar ${sidecarUrl.pathname} could not be read`, { cause: error });
  }
  const verdict = judgeLightBake(document);
  if (!verdict.ok) throw new LightBakeError('sidecar', verdict.message);
  const bake = verdict.value;
  checks.checkSidecar?.(bake);

  let shell: ArrayBuffer;
  let hash: string;
  try {
    shell = await (await fetchBytes(shellUrl)).arrayBuffer();
    hash = await sha256Of(shell);
  } catch (error) {
    throw new LightBakeError('shell', `light bake shell ${shellUrl.pathname} could not be read`, { cause: error });
  }
  if (hash !== bake.shellHash)
    throw new LightBakeError('shell', `light bake ${bake.bakeId} was made for another shell`, {
      detail: { expected: bake.shellHash, actual: hash },
    });
  await checks.checkShell?.(bake, shell);

  const pages: LightmapPage[] = [];
  const dispose = (): void => {
    for (const page of pages.splice(0)) page.dispose();
  };
  try {
    for (const page of bake.pages) pages.push(await loadLightmapPage(page, bake.contract.mips.lodLimit, sidecarUrl, fetchBytes));
  } catch (error) {
    dispose();
    throw error;
  }
  return { bake, shell, pages, dispose };
}

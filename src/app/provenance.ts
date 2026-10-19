/**
 * What every rendered artefact carries with it: the sidecar that says where
 * the picture came from, and the caption that says so on the picture itself.
 *
 * California AB 723 (in force 2026-01-01) and CRMLS 11.5.2 require an altered
 * or generated listing image to be disclosed and shown beside the unaltered
 * original. A viewer that owns the
 * geometry can satisfy that by construction rather than by policy: the
 * original is the same document without the paint (`render/offscreen-scene.ts`),
 * and the disclosure is not a checkbox a user might forget but a field of
 * every artefact this library emits.
 *
 * Invariant: `disclosure` is a CONSTANT. A JEEX artefact is a rendering of a
 * 3D model and never a photograph, so there is no value of any option that
 * makes the sidecar say otherwise; `capture.disclosure.caption` decides only
 * whether the sentence is also burnt into the pixels.
 */

import { VIEWER_VERSION } from '../shared/version.js';
import { ViewerLibError } from '../shared/errors.js';
import type { SceneState } from '../render/offscreen-scene.js';
import type { CameraPose, SceneData, SchemaVersion } from '../scene/types.js';

/** What produced the artefact; a constant, so a consumer can key on it. */
const GENERATOR = 'jeex-viewer';
/** The one disclosure this library can honestly make. */
const DISCLOSURE = 'rendered-3d';

/** Caption geometry at 1×, in CSS pixels; every number scales with the capture's pixel ratio. */
const CAPTION_FONT_PX = 14;
const CAPTION_PADDING_PX = 8;
/** Opacity of the band the caption sits on, so it reads over any picture. */
const CAPTION_BAND_ALPHA = 0.6;

/** The sidecar of one rendered artefact. */
export type Provenance = {
  generator: typeof GENERATOR;
  /** The library version that rendered it (`shared/version.ts`). */
  version: string;
  sceneId: string;
  /** The committed revision the picture is of; two artefacts of one `rev` agree. */
  rev: number;
  schemaVersion: SchemaVersion;
  state: SceneState;
  kind: 'still' | 'panorama' | 'plan' | 'frame';
  /** ISO 8601, UTC. */
  createdAt: string;
  disclosure: typeof DISCLOSURE;
  /** Where the camera stood, for a still or a frame. */
  camera?: CameraPose | undefined;
  /** The room a panorama was taken in, or the room a still is of. */
  roomId?: string | undefined;
};

/**
 * The sidecar for one artefact of `scene` at revision `rev`.
 *
 * `extra` is spread FIRST on purpose: what this function decides — the
 * generator, the version, the identity of the document, the disclosure — is
 * not overridable, and what it does not decide (the camera, the room) is
 * exactly what a caller is here to add.
 */
export function provenanceFor(
  scene: SceneData,
  rev: number,
  kind: Provenance['kind'],
  state: SceneState,
  extra?: Partial<Provenance>,
): Provenance {
  const base: Provenance = {
    generator: GENERATOR,
    version: VIEWER_VERSION,
    sceneId: scene.id,
    rev,
    schemaVersion: scene.schemaVersion,
    state,
    kind,
    createdAt: new Date().toISOString(),
    disclosure: DISCLOSURE,
  };
  return extra === undefined ? base : { ...extra, ...base };
}

/**
 * A copy of `blob` with the disclosure caption along its bottom edge.
 *
 * `OffscreenCanvas`, not a canvas from a document: this module is handed a
 * blob and no DOM node, and reaching for the global `document` is what an
 * embeddable library may not do. It also
 * makes the stamp usable from a worker, which is where a batch of frames
 * belongs.
 */
export async function stampCaption(blob: Blob, text: string, pixelRatio: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new ViewerLibError('internal', 'capture: no 2D context to stamp the disclosure caption with');
    context.drawImage(bitmap, 0, 0);
    const scale = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    const font = Math.round(CAPTION_FONT_PX * scale);
    const padding = Math.round(CAPTION_PADDING_PX * scale);
    const band = font + padding * 2;
    context.fillStyle = `rgba(0, 0, 0, ${String(CAPTION_BAND_ALPHA)})`;
    context.fillRect(0, bitmap.height - band, bitmap.width, band);
    context.fillStyle = '#ffffff';
    context.font = `${String(font)}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    context.fillText(text, padding, bitmap.height - band / 2);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/**
 * The binary glTF container, judged before `GLTFLoader` is handed the bytes.
 *
 * A GLB is untrusted data (a project folder, a catalogue URL, a dev server answering
 * an unknown path with its index page). Two things go wrong when the loader is
 * the first to read it:
 *
 * - a broken container fails deep inside three.js with a `RangeError` or a
 *   `TypeError` whose text says nothing a host can act on;
 * - the loader is TOLERANT where the resource gate needs it strict: it takes
 *   the LAST `JSON` chunk and a `BIN` chunk from anywhere, while the pre-parse
 *   scan in `model-source.ts` reads the first. A container carrying a second
 *   JSON document would have the scan judge one document and the loader load
 *   another.
 *
 * So the structure glTF 2.0 §4.4 prescribes is checked here, and anything else
 * is refused as `scene-load` with a machine-readable `detail.reason`: a 12-byte
 * header with the `glTF` magic and version 2, a total length equal to the bytes
 * that arrived, chunks that fit inside it, exactly one `JSON` chunk and it
 * first, a `BIN` chunk only in second place, and chunks of any other type
 * after those — ignored, as the specification requires of a client. The JSON
 * chunk must parse to an object whose `images`/`buffers` are what the
 * resource scan reads (`glb-container.schema.ts`).
 *
 * The message names the model URL (host-supplied, like every fetch URL in the
 * library's errors) and never a value read out of the bytes.
 */

import { ViewerLibError } from '../shared/errors.js';
import { isGlbDocumentShape } from './glb-container.schema.js';

/** Why a container was refused; `detail.reason` of the `scene-load` error. */
export type GlbReason =
  | 'glb-header'
  | 'glb-magic'
  | 'glb-version'
  | 'glb-length'
  | 'glb-chunk'
  | 'glb-json-first'
  | 'glb-chunk-order'
  | 'glb-json';

/** One `images[]` or `buffers[]` entry, as far as the resource scan reads it. */
export type GlbResource = { readonly uri?: string | undefined };

/**
 * The two fields of the JSON document that name a network fetch
 * (`model-source.ts`); `glb-container.schema.ts` proves the shape, and
 * `glb-container.schema.test.ts` proves the two agree.
 */
export type GlbDocument = {
  readonly images?: readonly GlbResource[] | undefined;
  readonly buffers?: readonly GlbResource[] | undefined;
};

const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const SENTENCES: Readonly<Record<GlbReason, string>> = {
  'glb-header': 'is too short to be a GLB container',
  'glb-magic': 'is not a GLB container',
  'glb-version': 'is not a glTF 2.0 container',
  'glb-length': 'is not as long as its header says',
  'glb-chunk': 'has a chunk that runs past the end of the container',
  'glb-json-first': 'does not start with its JSON chunk',
  'glb-chunk-order': 'has its chunks out of the glTF 2.0 order',
  'glb-json': 'has a JSON chunk that is not a glTF document',
};

function refuse(url: string, reason: GlbReason, cause?: unknown): never {
  throw new ViewerLibError('scene-load', `model ${url} ${SENTENCES[reason]}`, {
    detail: { url, reason },
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * The container's JSON document, or a `scene-load` refusal naming what is
 * wrong with it. The document returned is the one `GLTFLoader` will parse: a
 * container for which the two could differ does not get this far.
 */
export function readGlbContainer(bytes: ArrayBuffer, url: string): GlbDocument {
  if (bytes.byteLength < HEADER_BYTES) refuse(url, 'glb-header');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== MAGIC) refuse(url, 'glb-magic');
  if (view.getUint32(4, true) !== 2) refuse(url, 'glb-version');
  const total = view.getUint32(8, true);
  if (total !== bytes.byteLength) refuse(url, 'glb-length');

  let json: Uint8Array | undefined;
  let offset = HEADER_BYTES;
  for (let index = 0; offset < total; index += 1) {
    if (offset + CHUNK_HEADER_BYTES > total) refuse(url, 'glb-chunk');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + CHUNK_HEADER_BYTES;
    if (length > total - start) refuse(url, 'glb-chunk');
    if (index === 0 && type !== CHUNK_JSON) refuse(url, 'glb-json-first');
    if (index > 0 && type === CHUNK_JSON) refuse(url, 'glb-chunk-order');
    if (index !== 1 && type === CHUNK_BIN) refuse(url, 'glb-chunk-order');
    if (index === 0) json = new Uint8Array(bytes, start, length);
    offset = start + length;
  }
  if (json === undefined) refuse(url, 'glb-json-first');

  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(json));
  } catch (cause) {
    refuse(url, 'glb-json', cause);
  }
  // A judgement, never a transform: the document handed on is the one the
  // bytes held (the loader parses the same bytes), not `result.data`.
  if (!isGlbDocumentShape(document)) refuse(url, 'glb-json');
  return document as GlbDocument;
}

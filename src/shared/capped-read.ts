/**
 * A response body read off its STREAM under a byte cap: the one reader the
 * GLB models and the room-surface textures share.
 *
 * `Content-Length` is the server's claim about a body it has not sent yet, and
 * a chunked response carries none, so the bytes are counted as they arrive and
 * the stream is cancelled the moment the count passes the cap. A response with
 * no readable stream (a test fake) falls back to `arrayBuffer()`, which is
 * honest about what it can promise: nothing was streamed, so nothing was
 * capped, and the size is still judged afterwards.
 *
 * Lowest layer: no `three`, no DOM; `Response` and `ReadableStream` are
 * platform globals.
 */

import { ViewerLibError } from './errors.js';

/** The body passed its cap: `bytes` were read when the read stopped. A `scene-load` refusal like any other. */
export class ByteLimitError extends ViewerLibError {
  readonly limit: number;
  readonly bytes: number;

  constructor(limit: number, bytes: number) {
    super('scene-load', `response body is over ${limit} bytes`, { detail: { limit, bytes } });
    this.name = 'ByteLimitError';
    this.limit = limit;
    this.bytes = bytes;
  }
}

/**
 * The response body as bytes, refusing anything over `limit` with a
 * `ByteLimitError`. `onChunk` hears the size of every chunk as it arrives, so
 * a caller can keep a budget of its own across many reads. `signal` aborting
 * cancels the stream and rejects with its reason, even while a read waits on
 * a body that has stopped sending.
 */
export async function readCapped(
  response: Response,
  limit: number,
  onChunk?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body) {
    const buffer = await response.arrayBuffer();
    onChunk?.(buffer.byteLength);
    if (buffer.byteLength > limit) throw new ByteLimitError(limit, buffer.byteLength);
    return buffer;
  }
  const reader = body.getReader();
  // The abort listener lives exactly as long as this read.
  const lifetime = new AbortController();
  const aborted = abortOf(signal, lifetime.signal, () => void reader.cancel().catch(() => undefined));
  try {
    return await readChunks(reader, limit, aborted, onChunk, signal);
  } finally {
    lifetime.abort();
  }
}

/** The chunks of `reader`, joined, under `limit`; `aborted` rejects the wait for the next one. */
async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
  aborted: Promise<never> | null,
  onChunk?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await (aborted === null ? reader.read() : Promise.race([aborted, reader.read()]));
    // An abort between two reads (a chunk callback spent the caller's budget)
    // has cancelled the stream, whose next read reports `done`: not a whole body.
    if (signal?.aborted) throw signal.reason;
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    onChunk?.(value.byteLength);
    if (total > limit) {
      await reader.cancel();
      throw new ByteLimitError(limit, total);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/**
 * A promise that rejects with `signal`'s reason when it aborts, after
 * which `onAbort` runs; `null` without a signal. Never resolves; its listener goes
 * when `lifetime` aborts.
 */
function abortOf(signal: AbortSignal | undefined, lifetime: AbortSignal, onAbort: () => void): Promise<never> | null {
  if (signal === undefined) return null;
  return new Promise<never>((_, reject) => {
    const fire = (): void => {
      // Rejected BEFORE the stream is cancelled: a cancel settles the waiting
      // read as `done`, which must not pass for a whole body.
      reject(signal.reason instanceof Error ? signal.reason : new Error('read aborted'));
      onAbort();
    };
    if (signal.aborted) fire();
    else signal.addEventListener('abort', fire, { once: true, signal: lifetime });
  });
}

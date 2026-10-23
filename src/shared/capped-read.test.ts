import { describe, expect, test } from 'bun:test';
import { ByteLimitError, readCapped } from './capped-read.js';

/** A response whose body streams `chunks` and declares no `Content-Length`. */
function streamed(chunks: readonly number[]): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = chunks[index++];
      if (size === undefined) controller.close();
      else controller.enqueue(new Uint8Array(size).fill(7));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body), cancelled: () => cancelled };
}

describe('readCapped', () => {
  test('reads a body under the limit whole', async () => {
    const { response } = streamed([3, 4]);
    const bytes = await readCapped(response, 10);
    expect(bytes.byteLength).toBe(7);
    expect(new Uint8Array(bytes)[6]).toBe(7);
  });

  test('a body exactly at the limit is accepted', async () => {
    expect((await readCapped(streamed([5, 5]).response, 10)).byteLength).toBe(10);
  });

  test('a stream over the limit with no Content-Length is cancelled and refused with the bytes read', async () => {
    const { response, cancelled } = streamed([6, 6, 6]);
    let thrown: unknown;
    try {
      await readCapped(response, 10);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ByteLimitError);
    expect((thrown as ByteLimitError).limit).toBe(10);
    expect((thrown as ByteLimitError).bytes).toBe(12);
    expect(cancelled()).toBe(true);
  });

  test('every chunk is reported as it arrives, so a caller can keep its own count', async () => {
    const seen: number[] = [];
    await readCapped(streamed([2, 3]).response, 10, (bytes) => seen.push(bytes));
    expect(seen).toEqual([2, 3]);
  });

  test('a response without a stream is read whole and still judged', async () => {
    const fake = { body: null, arrayBuffer: async () => new ArrayBuffer(11) } as unknown as Response;
    await expect(readCapped(fake, 10)).rejects.toBeInstanceOf(ByteLimitError);
  });
});

describe('readCapped under a signal', () => {
  test('an abort mid-stream cancels the stream and rejects with the signal reason', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const reading = readCapped(new Response(body), 10, undefined, controller.signal);
    controller.abort(new Error('deadline'));
    await expect(reading).rejects.toThrow('deadline');
    expect(cancelled).toBe(true);
  });
});

test('an abort from inside a chunk callback rejects rather than passing a cut body for a whole one', async () => {
  const controller = new AbortController();
  const { response } = streamed([5, 5]);
  await expect(readCapped(response, 100, () => controller.abort(new Error('budget')), controller.signal)).rejects.toThrow('budget');
});

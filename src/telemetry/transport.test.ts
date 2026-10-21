import { afterEach, describe, expect, test } from 'bun:test';
import { sendTelemetry } from './transport.js';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

describe('sendTelemetry', () => {
  test('posts the body with the fixed options and no headers', () => {
    const calls: Array<[unknown, RequestInit | undefined]> = [];
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    sendTelemetry('https://telemetry.example/v1', '{"a":1}');
    expect(calls).toEqual([
      [
        'https://telemetry.example/v1',
        {
          method: 'POST',
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: 'cors',
          cache: 'no-store',
          redirect: 'error',
          body: '{"a":1}',
        },
      ],
    ]);
    expect(calls[0]?.[1]).not.toHaveProperty('headers');
  });

  test('a rejection, a synchronous throw and a missing fetch are all swallowed', async () => {
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled += 1;
    };
    process.on('unhandledRejection', onUnhandled);
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(() => sendTelemetry('https://t.example/', '{}')).not.toThrow();
    globalThis.fetch = (() => {
      throw new TypeError('keepalive body too large');
    }) as unknown as typeof fetch;
    expect(() => sendTelemetry('https://t.example/', '{}')).not.toThrow();
    globalThis.fetch = undefined as unknown as typeof fetch;
    expect(() => sendTelemetry('https://t.example/', '{}')).not.toThrow();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toBe(0);
  });
});

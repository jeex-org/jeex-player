import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  keyValue,
  KTX2_MODEL_ETC1S,
  KTX2_MODEL_UASTC,
  KTX2_TRANSFER_SRGB,
  ktx2MapProblem,
  readKtx2Facts,
  type Ktx2Facts,
} from './ktx2-container.js';

const fixture = (name: string): ArrayBuffer => {
  const bytes = readFileSync(resolve(import.meta.dirname, '../../tests/fixtures/ktx2', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe('readKtx2Facts', () => {
  test('reads an ETC1S colour map: size, payload, sRGB, mip chain; the encoder states no orientation for the default', () => {
    const facts = readKtx2Facts(fixture('orientation.128.ktx2'))!;
    expect(facts).toMatchObject({
      vkFormat: 0,
      width: 128,
      height: 128,
      faces: 1,
      colourModel: KTX2_MODEL_ETC1S,
      transfer: KTX2_TRANSFER_SRGB,
    });
    expect(facts.levels).toBe(8);
    expect(facts.orientation).toBeUndefined();
  });

  test('reads a UASTC data map as linear', () => {
    const facts = readKtx2Facts(fixture('normal-up.128.ktx2'))!;
    expect(facts.colourModel).toBe(KTX2_MODEL_UASTC);
    expect(facts.transfer).not.toBe(KTX2_TRANSFER_SRGB);
  });

  test('refuses bytes that are not a KTX2 container', () => {
    expect(readKtx2Facts(new ArrayBuffer(12))).toBeNull();
    const webp = new Uint8Array(100);
    webp.set(new TextEncoder().encode('RIFF'));
    expect(readKtx2Facts(webp.buffer)).toBeNull();
  });

  test('refuses a container whose descriptor runs past the end', () => {
    const bytes = new Uint8Array(fixture('white.128.ktx2'));
    new DataView(bytes.buffer).setUint32(52, 1 << 20, true);
    expect(readKtx2Facts(bytes.buffer)).toBeNull();
  });
});

describe('keyValue', () => {
  /** One key/value entry: its length, `key\0value\0`, padded to four bytes. */
  const entry = (key: string, value: string): number[] => {
    const body = [...new TextEncoder().encode(`${key}\0${value}\0`)];
    const padded = [...body, ...Array.from({ length: (4 - (body.length % 4)) % 4 }, () => 0)];
    return [body.length, 0, 0, 0, ...padded];
  };

  test('finds a key after another entry and strips its terminating zero', () => {
    const list = new Uint8Array([...entry('KTXwriter', 'test'), ...entry('KTXorientation', 'ru')]);
    expect(keyValue(list, 'KTXorientation')).toBe('ru');
    expect(keyValue(list, 'KTXswizzle')).toBeUndefined();
  });

  test('stops at an entry that runs past the list', () => {
    const list = new Uint8Array([200, 0, 0, 0, 1, 2, 3, 4]);
    expect(keyValue(list, 'KTXorientation')).toBeUndefined();
  });
});

describe('ktx2MapProblem', () => {
  const good: Ktx2Facts = readKtx2Facts(fixture('albedo.256.ktx2'))!;

  test('a Basis map of the named size passes', () => {
    expect(ktx2MapProblem(good, 256)).toBeNull();
    expect(ktx2MapProblem(readKtx2Facts(fixture('normal.256.ktx2'))!, 256)).toBeNull();
  });

  test('names each refusal', () => {
    expect(ktx2MapProblem(good, 512)).toBe('is 256 x 256, not 512 x 512');
    expect(ktx2MapProblem({ ...good, vkFormat: 37 }, 256)).toBe('is not a Basis Universal texture');
    expect(ktx2MapProblem({ ...good, colourModel: 1 }, 256)).toBe('is not an ETC1S or UASTC payload');
    expect(ktx2MapProblem({ ...good, supercompression: 2 }, 256)).toBe('is not an ETC1S or UASTC payload');
    expect(ktx2MapProblem({ ...good, faces: 6 }, 256)).toBe('is not a single 2D image');
    expect(ktx2MapProblem({ ...good, layers: 2 }, 256)).toBe('is not a single 2D image');
    expect(ktx2MapProblem({ ...good, orientation: 'ru' }, 256)).toBe('states orientation ru, not rd');
  });

  test('a file that states no orientation is read as the default', () => {
    expect(ktx2MapProblem({ ...good, orientation: undefined }, 256)).toBeNull();
  });
});

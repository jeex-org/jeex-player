/**
 * The few facts of a KTX2 container the viewer judges before it hands the
 * bytes to the Basis transcoder: its shape, its payload, its transfer
 * function and its stated orientation.
 *
 * A KTX2 file starts with a fixed header (KTX 2.0 specification, section 3),
 * a Data Format Descriptor whose basic block names the colour model and the
 * transfer function, and a key/value list where `KTXorientation` lives. This
 * reader takes exactly those, refuses anything it cannot read, and never
 * looks at the image data: a room map that is the wrong shape is refused
 * before a worker spends time on it. Pure: bytes in, facts or `null` out.
 */

/** The twelve identifier bytes every KTX2 file opens with. */
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Bytes of the fixed header up to and including the supercompression global data's length. */
const HEADER_BYTES = 80;

/** The descriptor's colour model of a Basis Universal payload (Khronos Data Format 1.3). */
export const KTX2_MODEL_ETC1S = 163;
export const KTX2_MODEL_UASTC = 166;
/** `supercompressionScheme` values. */
export const KTX2_SUPERCOMPRESSION_NONE = 0;
export const KTX2_SUPERCOMPRESSION_BASISLZ = 1;
export const KTX2_SUPERCOMPRESSION_ZSTD = 2;
/** `transferFunction` of an sRGB-encoded payload. */
export const KTX2_TRANSFER_SRGB = 2;

/** What the header, the descriptor and the key/value list say. */
export type Ktx2Facts = {
  readonly vkFormat: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly layers: number;
  readonly faces: number;
  readonly levels: number;
  readonly supercompression: number;
  readonly colourModel: number;
  readonly transfer: number;
  /** `KTXorientation` without its terminating zero, or `undefined` when the file states none. */
  readonly orientation: string | undefined;
};

/** The facts of `bytes`, or `null` when they are not a readable KTX2 container. */
export function readKtx2Facts(bytes: ArrayBuffer): Ktx2Facts | null {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const view = new DataView(bytes);
  for (const [index, byte] of IDENTIFIER.entries()) if (view.getUint8(index) !== byte) return null;
  const u32 = (offset: number): number => view.getUint32(offset, true);
  const dfdOffset = u32(48);
  const dfdLength = u32(52);
  const kvdOffset = u32(56);
  const kvdLength = u32(60);
  // The descriptor's total size (4 bytes), then the basic block's two header words, then its first byte fields.
  if (dfdLength < 16 || dfdOffset + dfdLength > bytes.byteLength) return null;
  if (kvdOffset + kvdLength > bytes.byteLength) return null;
  const block = dfdOffset + 4;
  return {
    vkFormat: u32(12),
    width: u32(20),
    height: u32(24),
    depth: u32(28),
    layers: u32(32),
    faces: u32(36),
    levels: u32(40),
    supercompression: u32(44),
    colourModel: view.getUint8(block + 8),
    transfer: view.getUint8(block + 10),
    orientation: keyValue(new Uint8Array(bytes, kvdOffset, kvdLength), 'KTXorientation'),
  };
}

/** The value stored under `wanted` in a key/value list, as text without trailing zeros. */
export function keyValue(list: Uint8Array, wanted: string): string | undefined {
  const view = new DataView(list.buffer, list.byteOffset, list.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= list.byteLength) {
    const length = view.getUint32(offset, true);
    const start = offset + 4;
    if (start + length > list.byteLength) return undefined;
    const entry = list.subarray(start, start + length);
    const zero = entry.indexOf(0);
    if (zero !== -1 && decoder.decode(entry.subarray(0, zero)) === wanted) {
      return decoder.decode(entry.subarray(zero + 1)).replace(/\0+$/, '');
    }
    // Every entry is padded to a multiple of four bytes.
    offset = start + ((length + 3) & ~3);
  }
  return undefined;
}

/** Why `facts` are not a room map of `size` pixels, or `null` when they are. */
export function ktx2MapProblem(facts: Ktx2Facts, size: number): string | null {
  if (facts.vkFormat !== 0) return 'is not a Basis Universal texture';
  const etc1s = facts.colourModel === KTX2_MODEL_ETC1S && facts.supercompression === KTX2_SUPERCOMPRESSION_BASISLZ;
  const uastc =
    facts.colourModel === KTX2_MODEL_UASTC &&
    (facts.supercompression === KTX2_SUPERCOMPRESSION_NONE || facts.supercompression === KTX2_SUPERCOMPRESSION_ZSTD);
  if (!etc1s && !uastc) return 'is not an ETC1S or UASTC payload';
  if (facts.depth > 1 || facts.layers > 1 || facts.faces !== 1) return 'is not a single 2D image';
  if (facts.width !== size || facts.height !== size) return `is ${facts.width} x ${facts.height}, not ${size} x ${size}`;
  if (facts.orientation !== undefined && facts.orientation !== 'rd') return `states orientation ${facts.orientation}, not rd`;
  return null;
}

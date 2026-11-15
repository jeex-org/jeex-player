/**
 * The layouts of the walk lighting's two textures: the room probes' 2D array
 * (six layers a room, one per cube face, with a mip chain from 128 to 4
 * texels) and the packed atlas every light-probe grid is copied into.
 *
 * Packed atlas: each grid gets one block of `(nx + 2) x 7 (ny + 2) x (nz + 2)`
 * texels: its seven SH sub-volumes stacked along y, each with a one-texel
 * border on x and y (copies of the edge texels) and three's own padding
 * slice at each end of z. Blocks are laid out in shelves along x, one shelf
 * as high as the tallest block, a new shelf when a block would pass the
 * width limit.
 *
 * Invariant: for `maxBoxes` room grids of the largest resolution a room box
 * may ask for, plus the exterior grid, the atlas stays within WebGL 2's
 * guaranteed `MAX_3D_TEXTURE_SIZE`, and the probe array within its
 * guaranteed `MAX_ARRAY_TEXTURE_LAYERS` (pinned by `probe-layout.test.ts`).
 *
 * Pure module: no `three`, no DOM.
 */

/** What WebGL 2 guarantees every device: array layers and the edge of a 3D texture. */
export const WEBGL2_MINIMUMS = Object.freeze({ arrayLayers: 256, size3d: 256 });

/** Edge of a probe face at the array's largest level, texels. */
export const PROBE_FACE_SIZE = 128;
/** Levels of the probe array: 128, 64, 32, 16, 8 and 4 texels, one per level of a probe's PMREM. */
const LEVELS = 6;
/** RGBA16F. */
const PROBE_TEXEL_BYTES = 8;
/** RGBA32F, the type of three's own grid atlas, which the blocks are copied from. */
const GRID_TEXEL_BYTES = 16;

export type ProbeArrayLayout = { faceSize: number; levels: number; layers: number; bytes: number };

/** The probe array for `rooms` rooms: six layers a room, every level allocated. */
export function probeArrayLayout(rooms: number): ProbeArrayLayout {
  const layers = Math.max(1, rooms) * 6;
  let texels = 0;
  for (let level = 0; level < LEVELS; level += 1) texels += (PROBE_FACE_SIZE >> level) ** 2;
  return { faceSize: PROBE_FACE_SIZE, levels: LEVELS, layers, bytes: layers * texels * PROBE_TEXEL_BYTES };
}

type Resolution = { readonly x: number; readonly y: number; readonly z: number };

export type GridAtlasLayout = {
  width: number;
  height: number;
  depth: number;
  /** Each grid's block origin, in texels (its z origin is 0). */
  slots: { x: number; y: number }[];
  bytes: number;
};

/** The packed atlas for grids of `resolutions`, in order. */
export function gridAtlasLayout(resolutions: readonly Resolution[]): GridAtlasLayout {
  const shelfHeight = Math.max(...resolutions.map((r) => 7 * (r.y + 2)));
  const slots: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let width = 0;
  for (const r of resolutions) {
    const blockWidth = r.x + 2;
    if (x > 0 && x + blockWidth > WEBGL2_MINIMUMS.size3d) {
      x = 0;
      y += shelfHeight;
    }
    slots.push({ x, y });
    x += blockWidth;
    width = Math.max(width, x);
  }
  const height = y + shelfHeight;
  const depth = Math.max(...resolutions.map((r) => r.z + 2));
  return { width, height, depth, slots, bytes: width * height * depth * GRID_TEXEL_BYTES };
}

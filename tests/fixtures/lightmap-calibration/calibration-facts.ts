/**
 * Facts of the light-bake calibration fixture (`tests/fixtures/lightmap-calibration/`).
 *
 * The folder is a bake of the calibration room made by the light-bake tool
 * (Blender 5.2 Cycles, 512 samples, 4 bounces, OIDN): `shell.glb`, its
 * `sidecar.json` and the ten lossless WebP RGBM levels of its one 512 page.
 * Four edits from the tool's output, nothing else: the GLB's generator string
 * is neutral (and the sidecar's `shellHash` is the SHA-256 of these exact
 * bytes), the sidecar's device list is neutral, and the sidecar lists the
 * corner lamp in `lamps` and names the live policy in the vocabulary the
 * player implements (`live.keep`, `live.disable`), the two fields the
 * player's contract adds or changes.
 *
 * The room: 4 m (x) by 3 m (z) by 2.6 m, glTF frame +Y up; floor, ceiling and
 * four walls lightmapped; a 1.2 m window in the front wall (z = 0) with a sun
 * at 35 degrees; a point lamp in the back left corner (in the bake's direct
 * term B, so it is a baked lamp); an unbaked 0.8 m block on the floor; and an
 * upward 2 m plate 0.9 m above the ceiling that sees only a uniform sky of
 * radiance 1 (its lightmap reads 1, which calibrates the intensity pi).
 *
 * `GOLDEN_LEVELS` was decoded independently of any browser (libwebp 1.5):
 * each level's SHA-256 over its RGBA bytes, row 0 first, and a few texels
 * `[x, y, r, g, b, m]` per level, small M values and asymmetric positions
 * included.
 */

/** Entity ids of the meshes, by role (UUID v7, minted by the bake tool). */
export const CALIBRATION_NODES = {
  floor: '01a1681e-1f1b-77dc-bf9e-f33804e97334',
  ceiling: '01a1681e-1f1d-7486-9997-fceaa8573e1d',
  wallFront: '01a1681e-1f1f-7705-946c-06cf96ac0f9f',
  wallBack: '01a1681e-1f21-75df-af9d-54123b4b300f',
  wallLeft: '01a1681e-1f23-7008-a579-f712dbe15836',
  wallRight: '01a1681e-1f26-7403-86a8-b6cc9802c4dd',
  plate: '01a1681e-1f28-7402-afeb-55cf05fba85a',
  block: '01a1681e-1f2a-7791-9b17-4b922ebce65f',
} as const;

/** The scene's facts the measurements need, in metres, glTF frame. */
export const CALIBRATION_ROOM = {
  size: [4, 2.6, 3] as const,
  /** The window's corners on the front wall (z = 0). */
  window: [
    [1.4, 0.9, 0],
    [2.6, 0.9, 0],
    [2.6, 2.1, 0],
    [1.4, 2.1, 0],
  ] as const,
  /** The block's low corner and edge. */
  block: { low: [1.6, 0, 1.1] as const, edge: 0.8 },
  /** The plate: height, its x and z extents, and its linear albedo. */
  plate: { y: 3.5, x: [1, 3] as const, z: [0.5, 2.5] as const, albedo: 0.5 },
  floorAlbedo: [0.35, 0.3, 0.25] as const,
  skyRadiance: 1,
} as const;

/** The baked corner lamp: its placement id (listed in the sidecar's `lamps`), position, power in watts and linear colour. */
export const CALIBRATION_LAMP = {
  id: '01a16825-acf5-7011-8f24-6e96e2c80636',
  position: [0.7, 1.6, 2.4] as const,
  power: 60,
  color: [1, 0.9, 0.8] as const,
} as const;

/** Golden decoded bytes of levels 0..3 of page 0: `[x, y, r, g, b, m]`, row 0 at the top. */
export const GOLDEN_LEVELS: readonly {
  level: number;
  width: number;
  height: number;
  sha256: string;
  texels: readonly (readonly number[])[];
}[] = [
  {
    level: 0,
    width: 512,
    height: 512,
    sha256: '81c96535b8d414401d18c7c74d6d799c2af7d6822b84851e9cd7a815f17e72c7',
    texels: [
      [174, 5, 116, 120, 145, 2],
      [173, 6, 220, 230, 209, 2],
      [91, 73, 255, 228, 203, 3],
      [92, 73, 255, 228, 203, 3],
      [36, 104, 255, 215, 187, 42],
      [12, 12, 250, 208, 179, 15],
      [160, 20, 246, 222, 206, 7],
      [200, 60, 253, 212, 184, 47],
      [30, 300, 255, 254, 254, 32],
      [400, 200, 249, 208, 181, 16],
      [139, 175, 255, 223, 198, 159],
    ],
  },
  {
    level: 1,
    width: 256,
    height: 256,
    sha256: '779eaef10abf12c06b30f34c75aeceadb7f26c3912e6ff65d360d8d77949d06f',
    texels: [
      [84, 2, 174, 156, 146, 2],
      [168, 2, 230, 208, 192, 2],
      [46, 36, 255, 228, 203, 3],
      [85, 64, 180, 160, 149, 3],
      [18, 52, 254, 215, 187, 42],
      [6, 6, 253, 210, 182, 15],
      [80, 10, 246, 222, 206, 7],
      [100, 30, 255, 214, 186, 46],
      [15, 150, 254, 254, 254, 32],
      [200, 100, 249, 208, 180, 16],
      [70, 87, 254, 223, 197, 159],
    ],
  },
  {
    level: 2,
    width: 128,
    height: 128,
    sha256: '95142b6054afda59964c734bf042f7571dcf5b045724be5796835244c68e19b5',
    texels: [
      [42, 1, 246, 219, 202, 2],
      [126, 28, 217, 188, 169, 2],
      [84, 1, 210, 189, 175, 3],
      [126, 1, 240, 211, 192, 3],
      [9, 26, 253, 214, 186, 42],
      [3, 3, 242, 201, 173, 16],
      [40, 5, 245, 222, 206, 7],
      [50, 15, 254, 213, 185, 45],
      [7, 75, 254, 254, 254, 32],
      [100, 50, 247, 206, 179, 16],
      [35, 43, 253, 222, 196, 157],
    ],
  },
  {
    level: 3,
    width: 64,
    height: 64,
    sha256: 'e01689cce0ad4bafac6a4ca1d0c7fed734370e3b2271248f7091819d50717c18',
    texels: [
      [0, 0, 159, 132, 115, 2],
      [53, 16, 142, 120, 107, 2],
      [19, 0, 248, 219, 200, 3],
      [20, 0, 224, 200, 184, 3],
      [4, 13, 252, 213, 185, 42],
      [1, 1, 246, 204, 176, 15],
      [20, 2, 232, 209, 194, 7],
      [25, 7, 254, 215, 186, 47],
      [3, 37, 254, 254, 254, 32],
      [50, 25, 243, 203, 176, 16],
      [17, 21, 253, 222, 196, 152],
    ],
  },
];

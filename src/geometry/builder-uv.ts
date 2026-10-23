/**
 * Pure geometry helpers for the wall builder: face UVs and the prism of one
 * `FaceQuad`, expressed in face-local coordinates.
 *
 * Face-local frame (right-hand rule does NOT hold — it is deliberately mirrored
 * so that `+z` points into the wall, which is how wall slabs are authored):
 * - `x` runs along the face from its own start (the face's `t`, in metres);
 * - `y` runs up from the floor;
 * - `z` runs from the face plane INTO the wall body, i.e. along `-face.normal`.
 *
 * Invariant: UVs are in METRES (`u = face.t0 + t`, `v = y`). The tile size lives
 * in the material as `texture.repeat = 1/tile`, never as a per-mesh repeat
 * count, so the pattern stays continuous across the opening cuts of one face
 * and across faces of the same wall.
 *
 * Pure module: no `three`, no DOM.
 */

import type { FaceQuad } from '../plan/plan-openings.js';
import type { Vec2, Vec3 } from '../scene/types.js';

/** UV of a face point, in metres. `t0` is the face's own offset along the wall. */
export function faceUV(t0: number, t: number, y: number): { u: number; v: number } {
  return { u: t0 + t, v: y };
}

type PrismMesh = {
  /** 24 vertices, four per face (front, back, start, end, bottom, top), xyz interleaved, in face-local coordinates. */
  positions: number[];
  /** 24 UVs in metres, uv interleaved. */
  uvs: number[];
  /** 12 triangles wound so that every face points out of the solid. */
  indices: number[];
};

type Corner = readonly [number, number, number];

/**
 * Closed box of one wall quad: the face rectangle extruded by `depth` into the
 * wall. `faceT0` shifts the UVs so the quad keeps its place in the face's own
 * `u` parameterisation (a pier that starts at `t = 1.6` gets `u = faceT0 + 1.6`).
 *
 * Every face of the box has its own four vertices and its own metre UVs. The
 * front and the back read the face's `(u, v)`; a reveal strip — the jambs, the
 * sill and the head of an opening — unfolds from the edge it shares with the
 * front, so its texture carries on round the corner at the front's density
 * instead of a whole tile smeared across a few centimetres of depth.
 *
 * Winding note: the local frame is mirrored (`+z` into the wall), so mapping
 * these vertices through `placeFaceLocal` reverses orientation. The indices
 * below are wound for the WORLD result — the front plane (`z = 0`) then faces
 * along `+face.normal`, i.e. into the room. The front's two triangles come
 * first and the back's next, which `shell-builder`'s arc normals rely on.
 */
export function quadPrism(quad: FaceQuad, faceT0: number, depth: number): PrismMesh {
  const { t0, t1, y0, y1 } = quad;
  const d = depth;
  // Each face: its four corners and the UV of a point on it.
  const faces: readonly { corners: readonly Corner[]; uv: (x: number, y: number, z: number) => [number, number] }[] = [
    // front (face plane, towards the room) and back (inside the wall)
    {
      corners: [
        [t0, y0, 0],
        [t1, y0, 0],
        [t1, y1, 0],
        [t0, y1, 0],
      ],
      uv: (x, y) => [faceT0 + x, y],
    },
    {
      corners: [
        [t0, y0, d],
        [t1, y0, d],
        [t1, y1, d],
        [t0, y1, d],
      ],
      uv: (x, y) => [faceT0 + x, y],
    },
    // start (-x) and end (+x) caps: the jambs
    {
      corners: [
        [t0, y0, 0],
        [t0, y1, 0],
        [t0, y1, d],
        [t0, y0, d],
      ],
      uv: (_, y, z) => [faceT0 + t0 - z, y],
    },
    {
      corners: [
        [t1, y0, 0],
        [t1, y0, d],
        [t1, y1, d],
        [t1, y1, 0],
      ],
      uv: (_, y, z) => [faceT0 + t1 + z, y],
    },
    // bottom and top: the sill and the head
    {
      corners: [
        [t0, y0, 0],
        [t0, y0, d],
        [t1, y0, d],
        [t1, y0, 0],
      ],
      uv: (x, _, z) => [faceT0 + x, y0 - z],
    },
    {
      corners: [
        [t0, y1, 0],
        [t1, y1, 0],
        [t1, y1, d],
        [t0, y1, d],
      ],
      uv: (x, _, z) => [faceT0 + x, y1 + z],
    },
  ];
  // Two triangles per face, over its own four corners; the back face winds the other way round.
  const TRIANGLES = [
    [0, 1, 2, 0, 2, 3],
    [0, 2, 1, 0, 3, 2],
    [0, 1, 2, 0, 2, 3],
    [0, 1, 2, 0, 2, 3],
    [0, 1, 2, 0, 2, 3],
    [0, 1, 2, 0, 2, 3],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, index) => {
    const base = index * 4;
    for (const [x, y, z] of face.corners) {
      positions.push(x, y, z);
      uvs.push(...face.uv(x, y, z));
    }
    for (const corner of TRIANGLES[index]!) indices.push(base + corner);
  });
  return { positions, uvs, indices };
}

/** A baseboard box in its own frame: centred on the origin, its length along x, its depth along z. */
export type BoardFrame = {
  /** The face `u` of the board's centre, so a board keeps its place in the face's parameterisation. */
  readonly centreU: number;
  readonly height: number;
  readonly depth: number;
};

/**
 * The metre UV of a baseboard vertex, from its position and normal in the
 * board's own frame (before it is placed): the front and the back run along
 * the face and up the height, the top and the bottom along the face and
 * across the depth, the two ends across the depth and up the height.
 */
export function boardUV(position: Vec3, normal: Vec3, board: BoardFrame): [number, number] {
  const along = board.centreU + position.x;
  const up = position.y + board.height / 2;
  const across = position.z + board.depth / 2;
  if (Math.abs(normal.y) > 0.5) return [along, across];
  if (Math.abs(normal.x) > 0.5) return [across, up];
  return [along, up];
}

/**
 * Face-local point to world. `start` is the first point of the face polyline
 * (or of the polyline segment for arc faces), `tangent` its unit direction in
 * plan, `normal` the unit face normal pointing towards the room.
 */
export function placeFaceLocal(
  local: { x: number; y: number; z: number },
  start: Vec2,
  tangent: Vec2,
  normal: Vec2,
): { x: number; y: number; z: number } {
  return {
    x: start.x + tangent.x * local.x - normal.x * local.z,
    y: local.y,
    z: start.z + tangent.z * local.x - normal.z * local.z,
  };
}

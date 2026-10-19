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
import type { Vec2 } from '../scene/types.js';

/** UV of a face point, in metres. `t0` is the face's own offset along the wall. */
export function faceUV(t0: number, t: number, y: number): { u: number; v: number } {
  return { u: t0 + t, v: y };
}

type PrismMesh = {
  /** 8 corner vertices, xyz interleaved, in face-local coordinates. */
  positions: number[];
  /** 8 UVs in metres, uv interleaved. */
  uvs: number[];
  /** 12 triangles wound so that every face points out of the solid. */
  indices: number[];
};

/**
 * Closed box of one wall quad: the face rectangle extruded by `depth` into the
 * wall. `faceT0` shifts the UVs so the quad keeps its place in the face's own
 * `u` parameterisation (a pier that starts at `t = 1.6` gets `u = faceT0 + 1.6`).
 *
 * Winding note: the local frame is mirrored (`+z` into the wall), so mapping
 * these vertices through `placeFaceLocal` reverses orientation. The indices
 * below are wound for the WORLD result — the front plane (`z = 0`) then faces
 * along `+face.normal`, i.e. into the room.
 */
export function quadPrism(quad: FaceQuad, faceT0: number, depth: number): PrismMesh {
  const { t0, t1, y0, y1 } = quad;
  const corners: Array<[number, number, number]> = [
    [t0, y0, 0],
    [t1, y0, 0],
    [t1, y1, 0],
    [t0, y1, 0],
    [t0, y0, depth],
    [t1, y0, depth],
    [t1, y1, depth],
    [t0, y1, depth],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [x, y, z] of corners) {
    positions.push(x, y, z);
    // All eight corners share the front-plane UV: the four reveal strips are at
    // most half a wall thickness deep, so stretching them costs nothing visible
    // and keeps the prism at eight vertices.
    const uv = faceUV(faceT0, x, y);
    uvs.push(uv.u, uv.v);
  }
  const indices = [
    0,
    1,
    2,
    0,
    2,
    3, // front  (face plane, towards the room)
    4,
    6,
    5,
    4,
    7,
    6, // back   (inside the wall)
    0,
    3,
    7,
    0,
    7,
    4, // start end cap (-x)
    1,
    5,
    6,
    1,
    6,
    2, // end cap (+x)
    0,
    4,
    5,
    0,
    5,
    1, // bottom
    3,
    2,
    6,
    3,
    6,
    7, // top
  ];
  return { positions, uvs, indices };
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

/**
 * Geometry cache, world-unit UV baking and the shared parts every object-bank
 * builder is assembled from.
 *
 * Invariant: geometries are shared. `GeometryCache` hands the same
 * `BufferGeometry` to every mesh with the same dimensions - across objects and
 * across variant swaps - so a scene of forty items uploads a handful of
 * buffers. Shared geometry is owned by the cache: no caller may dispose it
 * (the selection glow reuses these very buffers for its hulls).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { FinishRegistry } from './asset-finishes.js';
import type { ResolvedAsset } from './asset-resolver.js';

export type RectSpec = { width: number; height: number; radius: number };

/** One corner of a hand-built solid, `[x, y, z]` in metres. */
type Vec3 = readonly [number, number, number];

/**
 * A leaf blade, described in units of ITS OWN LENGTH.
 *
 * The geometry is always one unit long, from its base at the origin to its tip
 * at `y = 1`, and the caller scales the mesh to the real leaf. That is what
 * keeps a crown of forty leaves of forty different sizes on ONE shared buffer:
 * a blade keyed by metres would be a new buffer per leaf.
 *
 * The two halves are built as separate vertex strips, so they share no normals
 * across the midrib and the `crease` reads as a fold rather than as a smooth
 * dome - the same reason `frustum` is non-indexed.
 */
export type BladeSpec = {
  /** Half-width at the widest point, as a fraction of the length. */
  width: number;
  /** Where along the length the blade is widest, `0 < waist < 1`. */
  waist: number;
  /**
   * How blunt the outline is: `1` tapers to a point at each end, below `1`
   * holds the blade broad and then rounds it off. The one number between a
   * palm leaflet's spear and a Strelitzia paddle's rounded tip.
   */
  blunt: number;
  /** How far the edges fold back from the midrib, as a fraction of the length. */
  crease: number;
  /** How far the tip bends back out of the blade's plane, as a fraction of the length. */
  curl: number;
  /** Depth of the mid-blade pinch that makes an outline lyrate; `0` is a plain oval. */
  pinch: number;
  /** Amplitude of the wavy edge, as a fraction of the local half-width. */
  wave: number;
  /** Ribs along the length, at least two. */
  rows: number;
  /** Columns across ONE half of the blade, at least one. */
  cols: number;
};

/** Where along the length a lyrate outline pinches in, as a fraction of the length. */
const PINCH_AT = 0.44;
/** How wide that pinch is, as a fraction of the length. */
const PINCH_SPREAD = 0.19;
/**
 * How many full waves a wavy edge runs over the blade's length. Deliberately
 * not a multiple of a half: a whole number would put the wave's NODES on the
 * ribs of a coarsely sampled blade and flatten the edge it is there to ripple,
 * so a spec that sets `wave` also wants four or more `rows` per wave.
 */
const WAVE_TURNS = 2.2;
/**
 * Half-width of the rib where the blade meets its stalk, as a fraction of the
 * blade's own half-width.
 *
 * Not cosmetic: a base rib of width zero collapses to a single point, and its
 * corner vertex then belongs to nothing but degenerate facets, so
 * `computeVertexNormals` leaves it with a zero normal and the blade's root
 * shades black. A real blade meets its stalk with some width anyway.
 */
const STALK_WIDTH_FRACTION = 0.05;

/**
 * The shape every object-bank builder has: reads only its resolved asset —
 * `dims`, `finishes`, `options` — and the shared `BuildKit`, returns a group.
 * Lives here (not in `asset-builders.ts`, which assembles the builders into
 * `BUILDERS`) so the four `asset-builders-*` part modules can import it
 * without a cycle back through the file that imports all of them.
 */
export type Builder = (asset: ResolvedAsset, kit: BuildKit) => THREE.Group;

export type BuildKit = {
  /** Material for a finish slot; anything that is not a slot is read as a finish UUID (a fixed accent, `FINISH.leather_tan`). */
  finish(slot: string): THREE.Material;
  /** Same material rendered double-sided - for open shades, basins and leaves. */
  finishDouble(slot: string): THREE.Material;
  rounded(width: number, height: number, depth: number, radius?: number, segments?: number): THREE.BufferGeometry;
  box(width: number, height: number, depth: number): THREE.BufferGeometry;
  /**
   * Box whose top face has its own width, depth and centre, so the cheeks
   * slope - a canopy, a plinth, a shade. `topZ` shifts the top face along Z,
   * which is how a wall-hung canopy keeps a vertical back.
   */
  frustum(
    bottomWidth: number,
    bottomDepth: number,
    topWidth: number,
    topDepth: number,
    height: number,
    topZ?: number,
  ): THREE.BufferGeometry;
  cylinder(radiusTop: number, radiusBottom: number, height: number, segments?: number): THREE.BufferGeometry;
  cylinderOpen(radiusTop: number, radiusBottom: number, height: number, segments?: number): THREE.BufferGeometry;
  sphere(radius: number, segments?: number): THREE.BufferGeometry;
  torus(radius: number, tube: number, tubular?: number, arc?: number): THREE.BufferGeometry;
  ring(outer: RectSpec, inner: RectSpec, depth: number): THREE.BufferGeometry;
  circleRing(outer: number, inner: number, depth: number): THREE.BufferGeometry;
  /**
   * Leaf blade of unit length, scaled per mesh to the real leaf (`BladeSpec`).
   * Double-sided finishes only: a blade has no thickness.
   */
  blade(spec: BladeSpec): THREE.BufferGeometry;
  /**
   * Tube swept along a Catmull-Rom curve through `points` - an arching stem, a
   * petiole, a leaning trunk. `taper` is the radius factor at the LAST point,
   * so a trunk thins as it rises; `1` keeps the radius constant.
   */
  tube(
    points: ReadonlyArray<readonly [number, number, number]>,
    radius: number,
    tubular?: number,
    radial?: number,
    taper?: number,
  ): THREE.BufferGeometry;
  /** Solid of revolution for turned parts: `profile` pairs are `[radius, y]`, bottom to top. */
  lathe(profile: ReadonlyArray<readonly [number, number]>, segments?: number): THREE.BufferGeometry;
  /** Flat disc facing +Z - mirror glass, round accents. */
  circle(radius: number, segments?: number): THREE.BufferGeometry;
  /** Flat rectangle facing +Z. */
  plane(width: number, height: number): THREE.BufferGeometry;
  /**
   * Registers a cleanup for a resource this build created outside the caches -
   * a live reflection render target, for example - so the loader's `dispose`
   * frees it instead of leaking one per rebuild.
   */
  ownDispose(dispose: () => void): void;
};

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** Caches geometries across every asset in a scene so repeated furniture shares buffers. */
export class GeometryCache {
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  private take(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const geometry = make();
    this.cache.set(key, geometry);
    return geometry;
  }

  rounded(width: number, height: number, depth: number, radius = 0.02, segments = 1): THREE.BufferGeometry {
    const safe = Math.min(radius, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4);
    const key = `rb:${round4(width)}:${round4(height)}:${round4(depth)}:${round4(safe)}:${segments}`;
    return this.take(key, () => bakeWorldUv(new RoundedBoxGeometry(width, height, depth, segments, Math.max(0.001, safe))));
  }

  box(width: number, height: number, depth: number): THREE.BufferGeometry {
    return this.take(`b:${round4(width)}:${round4(height)}:${round4(depth)}`, () =>
      bakeWorldUv(new THREE.BoxGeometry(width, height, depth)),
    );
  }

  /**
   * Rectangular frustum, built non-indexed so `computeVertexNormals` gives every
   * facet one flat normal and the arrises stay crisp. The alternatives all lose
   * the edge: a 4-segment cylinder or lathe shares its seam normals and
   * smooth-shades the four cheeks into a warped cone, and a stack of boxes reads
   * as stairs. `topZ` offsets the top face along Z, so a face can be left
   * vertical while the other three slope.
   */
  frustum(bottomWidth: number, bottomDepth: number, topWidth: number, topDepth: number, height: number, topZ = 0): THREE.BufferGeometry {
    const key = `fr:${round4(bottomWidth)}:${round4(bottomDepth)}:${round4(topWidth)}:${round4(topDepth)}:${round4(height)}:${round4(topZ)}`;
    return this.take(key, () => {
      const bx = bottomWidth / 2;
      const bz = bottomDepth / 2;
      const tx = topWidth / 2;
      const tz = topDepth / 2;
      const hy = height / 2;
      // Corners named by the face they belong to and their sign in X and Z.
      const bottomBackLeft: Vec3 = [-bx, -hy, -bz];
      const bottomBackRight: Vec3 = [bx, -hy, -bz];
      const bottomFrontRight: Vec3 = [bx, -hy, bz];
      const bottomFrontLeft: Vec3 = [-bx, -hy, bz];
      const topBackLeft: Vec3 = [-tx, hy, topZ - tz];
      const topBackRight: Vec3 = [tx, hy, topZ - tz];
      const topFrontRight: Vec3 = [tx, hy, topZ + tz];
      const topFrontLeft: Vec3 = [-tx, hy, topZ + tz];
      // Each quad is wound counter-clockwise seen from outside the solid.
      const quads: ReadonlyArray<readonly [Vec3, Vec3, Vec3, Vec3]> = [
        [bottomBackLeft, bottomBackRight, bottomFrontRight, bottomFrontLeft],
        [topBackLeft, topFrontLeft, topFrontRight, topBackRight],
        [bottomFrontLeft, bottomFrontRight, topFrontRight, topFrontLeft],
        [bottomBackRight, bottomBackLeft, topBackLeft, topBackRight],
        [bottomFrontRight, bottomBackRight, topBackRight, topFrontRight],
        [bottomBackLeft, bottomFrontLeft, topFrontLeft, topBackLeft],
      ];
      const positions = new Float32Array(quads.length * 6 * 3);
      let cursor = 0;
      for (const [a, b, c, d] of quads) {
        for (const corner of [a, b, c, a, c, d]) {
          positions[cursor] = corner[0];
          positions[cursor + 1] = corner[1];
          positions[cursor + 2] = corner[2];
          cursor += 3;
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      return bakeWorldUv(geometry);
    });
  }

  cylinder(radiusTop: number, radiusBottom: number, height: number, segments = 16): THREE.BufferGeometry {
    const key = `c:${round4(radiusTop)}:${round4(radiusBottom)}:${round4(height)}:${segments}`;
    return this.take(key, () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments));
  }

  cylinderOpen(radiusTop: number, radiusBottom: number, height: number, segments = 20): THREE.BufferGeometry {
    const key = `co:${round4(radiusTop)}:${round4(radiusBottom)}:${round4(height)}:${segments}`;
    return this.take(key, () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, true));
  }

  lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 16): THREE.BufferGeometry {
    const key = `lat:${profile.map(([r, y]) => `${round4(r)},${round4(y)}`).join(';')}:${segments}`;
    return this.take(key, () => {
      const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0004, r), y));
      return new THREE.LatheGeometry(points, segments);
    });
  }

  circle(radius: number, segments = 32): THREE.BufferGeometry {
    const key = `ci:${round4(radius)}:${segments}`;
    return this.take(key, () => bakeWorldUv(new THREE.CircleGeometry(radius, segments)));
  }

  plane(width: number, height: number): THREE.BufferGeometry {
    return this.take(`p:${round4(width)}:${round4(height)}`, () => bakeWorldUv(new THREE.PlaneGeometry(width, height)));
  }

  sphere(radius: number, segments = 16): THREE.BufferGeometry {
    return this.take(
      `s:${round4(radius)}:${segments}`,
      () => new THREE.SphereGeometry(radius, segments, Math.max(6, Math.round(segments * 0.7))),
    );
  }

  torus(radius: number, tube: number, tubular = 24, arc = Math.PI * 2): THREE.BufferGeometry {
    const key = `t:${round4(radius)}:${round4(tube)}:${tubular}:${round4(arc)}`;
    return this.take(key, () => new THREE.TorusGeometry(radius, tube, 6, tubular, arc));
  }

  ring(outer: RectSpec, inner: RectSpec, depth: number): THREE.BufferGeometry {
    const key = `r:${round4(outer.width)}:${round4(outer.height)}:${round4(outer.radius)}:${round4(inner.width)}:${round4(inner.height)}:${round4(inner.radius)}:${round4(depth)}`;
    return this.take(key, () => {
      const shape = roundedRect(outer.width, outer.height, outer.radius);
      shape.holes.push(roundedRect(inner.width, inner.height, inner.radius));
      return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 5, steps: 1 });
    });
  }

  circleRing(outer: number, inner: number, depth: number): THREE.BufferGeometry {
    const key = `cr:${round4(outer)}:${round4(inner)}:${round4(depth)}`;
    return this.take(key, () => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48, steps: 1 });
    });
  }

  /**
   * Leaf blade of unit length; see `BladeSpec` for why it is not built in
   * metres. The outline, the fold and the tip curl are all analytic, so a
   * species is a handful of named numbers rather than a hand-drawn spline.
   */
  blade(spec: BladeSpec): THREE.BufferGeometry {
    const rows = Math.max(2, Math.round(spec.rows));
    const cols = Math.max(1, Math.round(spec.cols));
    const key = `bl:${round4(spec.width)}:${round4(spec.waist)}:${round4(spec.blunt)}:${round4(spec.crease)}:${round4(spec.curl)}:${round4(spec.pinch)}:${round4(spec.wave)}:${rows}:${cols}`;
    return this.take(key, () => bladeGeometry(spec, rows, cols));
  }

  tube(points: ReadonlyArray<readonly [number, number, number]>, radius: number, tubular = 8, radial = 5, taper = 1): THREE.BufferGeometry {
    const path = points.map(([x, y, z]) => `${round4(x)},${round4(y)},${round4(z)}`).join(';');
    const key = `tu:${path}:${round4(radius)}:${tubular}:${radial}:${round4(taper)}`;
    return this.take(key, () => tubeGeometry(points, radius, tubular, radial, taper));
  }

  size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
  }
}

/**
 * Rewrites UVs in world units (metres) by box projection, so a finish tiles at
 * its real physical size regardless of how large the mesh is. Materials then
 * set `repeat = 1 / tile`, which is why a cabinet door and a table top show the
 * same grain scale.
 */
function bakeWorldUv(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return geometry;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (nx >= ny && nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else if (ny >= nx && ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Half-width of a blade at `t` along its length, in units of the length.
 *
 * `sin(pi * t^shoulder)` is zero at both ends and peaks exactly at `waist`,
 * which is the one number that separates a palm leaflet (widest low down) from
 * a fiddle-leaf blade (widest near the tip). The pinch and the wave then
 * modulate that envelope.
 */
function bladeHalfWidth(spec: BladeSpec, t: number): number {
  if (t <= 0) return spec.width * STALK_WIDTH_FRACTION;
  const shoulder = Math.log(0.5) / Math.log(Math.min(0.98, Math.max(0.02, spec.waist)));
  let half = spec.width * Math.pow(Math.sin(Math.PI * Math.pow(t, shoulder)), spec.blunt);
  if (spec.pinch !== 0) half *= 1 - spec.pinch * Math.exp(-(((t - PINCH_AT) / PINCH_SPREAD) ** 2));
  if (spec.wave !== 0) half *= 1 + spec.wave * Math.sin(t * WAVE_TURNS * Math.PI * 2);
  return Math.max(0, half);
}

function bladeGeometry(spec: BladeSpec, rows: number, cols: number): THREE.BufferGeometry {
  const perSide = rows * (cols + 1);
  const positions = new Float32Array(perSide * 2 * 3);
  const indices: number[] = [];
  let cursor = 0;
  for (const side of [1, -1]) {
    const base = side === 1 ? 0 : perSide;
    for (let row = 0; row < rows; row += 1) {
      const t = row / (rows - 1);
      const half = bladeHalfWidth(spec, t);
      // The fold deepens with the local half-width, so the narrow tip is not
      // creased as hard as the broad middle of the blade.
      const foldScale = spec.width === 0 ? 0 : half / spec.width;
      for (let col = 0; col <= cols; col += 1) {
        const u = col / cols;
        positions[cursor] = side * u * half;
        positions[cursor + 1] = t;
        positions[cursor + 2] = -spec.crease * u * foldScale - spec.curl * t * t;
        cursor += 3;
      }
    }
    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const a = base + row * (cols + 1) + col;
        const b = a + cols + 1;
        const c = a + 1;
        const d = b + 1;
        // The two halves mirror in X, so they need opposite winding to keep
        // every facet's normal on the same face of the blade.
        if (side === 1) indices.push(a, c, b, c, d, b);
        else indices.push(a, b, c, c, b, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return bakeWorldUv(geometry);
}

function tubeGeometry(
  points: ReadonlyArray<readonly [number, number, number]>,
  radius: number,
  tubular: number,
  radial: number,
  taper: number,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const geometry = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  if (taper !== 1) {
    // `TubeGeometry` lays its vertices out ring by ring, `radial + 1` per ring,
    // each ring centred on `curve.getPointAt(ring / tubular)` - so a taper is
    // the ring's offset from that centre, scaled.
    const position = geometry.getAttribute('position');
    const centre = new THREE.Vector3();
    const vertex = new THREE.Vector3();
    for (let ring = 0; ring <= tubular; ring += 1) {
      curve.getPointAt(ring / tubular, centre);
      const factor = 1 + (taper - 1) * (ring / tubular);
      for (let spoke = 0; spoke <= radial; spoke += 1) {
        const index = ring * (radial + 1) + spoke;
        vertex.fromBufferAttribute(position, index).sub(centre).multiplyScalar(factor).add(centre);
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return bakeWorldUv(geometry);
}

function roundedRect(width: number, height: number, radius: number): THREE.Shape {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** Bridges the geometry cache and the finish registry into the kit builders receive. */
export function makeBuildKit(
  geometries: GeometryCache,
  finishes: FinishRegistry,
  slots: Record<string, string>,
  track: (dispose: () => void) => void = () => {},
): BuildKit {
  const material = (slot: string): THREE.Material => finishes.get(slots[slot] ?? slot);
  return {
    finish: material,
    // The registry owns the double-sided clones: a per-kit cache lived exactly
    // one asset load and leaked one material per double-sided slot per swap.
    finishDouble: (slot) => finishes.getDouble(slots[slot] ?? slot),
    rounded: (w, h, d, radius, segments) => geometries.rounded(w, h, d, radius, segments),
    box: (w, h, d) => geometries.box(w, h, d),
    frustum: (bw, bd, tw, td, h, topZ) => geometries.frustum(bw, bd, tw, td, h, topZ),
    cylinder: (rt, rb, h, segments) => geometries.cylinder(rt, rb, h, segments),
    cylinderOpen: (rt, rb, h, segments) => geometries.cylinderOpen(rt, rb, h, segments),
    sphere: (radius, segments) => geometries.sphere(radius, segments),
    torus: (r, tube, tubular, arc) => geometries.torus(r, tube, tubular, arc),
    ring: (outer, inner, depth) => geometries.ring(outer, inner, depth),
    circleRing: (outer, inner, depth) => geometries.circleRing(outer, inner, depth),
    blade: (spec) => geometries.blade(spec),
    tube: (points, radius, tubular, radial, taper) => geometries.tube(points, radius, tubular, radial, taper),
    lathe: (profile, segments) => geometries.lathe(profile, segments),
    circle: (radius, segments) => geometries.circle(radius, segments),
    plane: (width, height) => geometries.plane(width, height),
    ownDispose: (dispose) => track(dispose),
  };
}

/* ------------------------------------------------------------ shared parts */

export type Place = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number };

export function put(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, place: Place = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(place.x ?? 0, place.y ?? 0, place.z ?? 0);
  mesh.rotation.set(place.rx ?? 0, place.ry ?? 0, place.rz ?? 0);
  mesh.scale.set(place.sx ?? 1, place.sy ?? 1, place.sz ?? 1);
  group.add(mesh);
  return mesh;
}

/** Square tapered leg - four radial segments rotated so the faces sit square to the object. */
export function taperedLeg(
  group: THREE.Group,
  kit: BuildKit,
  slot: string,
  topRadius: number,
  bottomRadius: number,
  height: number,
  x: number,
  z: number,
  sides = 4,
): void {
  put(group, kit.cylinder(topRadius, bottomRadius, height, sides), kit.finish(slot), {
    x,
    y: height / 2,
    z,
    ry: sides === 4 ? Math.PI / 4 : 0,
  });
}

/**
 * A turned leg from a nominal-height `[radius, y]` profile, scaled per mesh to
 * the real height (`sy` only, so radii keep their shape): one cached geometry
 * serves every size variant of the archetype. The profile's LAST point is its
 * nominal height.
 */
export function turnedLeg(
  group: THREE.Group,
  kit: BuildKit,
  profile: ReadonlyArray<readonly [number, number]>,
  slot: string,
  x: number,
  z: number,
  height: number,
): void {
  const nominal = profile.at(-1)?.[1] ?? 1;
  put(group, kit.lathe(profile, 12), kit.finish(slot), { x, z, sy: height / nominal }).name = 'leg';
}

/** Horizontal (or vertical) bar pull with two standoffs. */
export function barHandle(
  group: THREE.Group,
  kit: BuildKit,
  slot: string,
  length: number,
  x: number,
  y: number,
  z: number,
  vertical = false,
): void {
  const material = kit.finish(slot);
  const bar = put(group, kit.cylinder(0.008, 0.008, length, 8), material, { x, y, z: z + 0.026 });
  bar.rotation.z = vertical ? 0 : Math.PI / 2;
  for (const offset of [-length / 2 + 0.02, length / 2 - 0.02]) {
    const stand = put(group, kit.cylinder(0.006, 0.006, 0.026, 6), material, {
      x: vertical ? x : x + offset,
      y: vertical ? y + offset : y,
      z: z + 0.013,
    });
    stand.rotation.x = Math.PI / 2;
  }
}

/** Reveal left between two neighbouring cabinet leaves, metres - a real 4 mm shadow gap. */
export const LEAF_REVEAL = 0.004;

/** How deep a shaker centre panel sits behind the rim around it, metres. */
const PANEL_INSET = 0.0025;

/**
 * One cabinet leaf - door or drawer front - built shaker style: a rim at the
 * full leaf depth around a centre panel recessed by `PANEL_INSET`.
 *
 * The recess is what makes a front read as a front. A white door on a white
 * carcass has no colour to give it away, so the only cues left are the 4 mm
 * reveal around the leaf and the shadow line the rim casts onto the panel;
 * a plain slab in the same finish disappears into the box.
 *
 * Leaves too small for a rim (thin drawer fronts) fall back to a plain slab.
 */
export function shakerFront(
  group: THREE.Group,
  kit: BuildKit,
  slot: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): void {
  const material = kit.finish(slot);
  const rim = Math.min(0.062, width * 0.22, height * 0.22);
  if (rim < 0.024) {
    put(group, kit.rounded(width, height, depth, Math.min(0.006, depth / 3)), material, { x, y, z });
    return;
  }
  const innerWidth = width - rim * 2;
  const innerHeight = height - rim * 2;
  put(group, kit.ring({ width, height, radius: 0.005 }, { width: innerWidth, height: innerHeight, radius: 0.004 }, depth), material, {
    x,
    y,
    z: z - depth / 2,
  });
  // Slightly oversized so its edges hide inside the rim instead of leaving a crack.
  put(group, kit.box(innerWidth + 0.005, innerHeight + 0.005, depth - PANEL_INSET), material, { x, y, z: z - PANEL_INSET / 2 });
}

export function knobHandle(group: THREE.Group, kit: BuildKit, slot: string, x: number, y: number, z: number): void {
  const material = kit.finish(slot);
  const stem = put(group, kit.cylinder(0.006, 0.006, 0.022, 6), material, { x, y, z: z + 0.011 });
  stem.rotation.x = Math.PI / 2;
  put(group, kit.cylinder(0.017, 0.013, 0.016, 10), material, { x, y, z: z + 0.03, rx: Math.PI / 2 });
}

/**
 * Gooseneck mixer tap: a column, a half-torus arcing over, and the outlet
 * turned back down. `reach` is the horizontal distance from column to outlet,
 * so the spout lands in the basin.
 */
export function mixerTap(
  group: THREE.Group,
  kit: BuildKit,
  slot: string,
  x: number,
  deck: number,
  z: number,
  reach: number,
  tube = 0.014,
): void {
  const material = kit.finish(slot);
  const radius = reach / 2;
  const columnHeight = radius * 0.85;
  const column = put(group, kit.cylinder(tube, tube * 1.3, columnHeight, 10), material, { x, y: deck + columnHeight / 2, z: z - radius });
  const arc = put(group, kit.torus(radius, tube, 14, Math.PI), material, { x, y: deck + columnHeight, z });
  arc.rotation.y = Math.PI / 2;
  const spout = put(group, kit.cylinder(tube * 0.85, tube * 0.85, 0.03, 10), material, {
    x,
    y: deck + columnHeight - 0.015,
    z: z + radius,
  });
  // Named so a fixture's facts can be checked against its body without the
  // tap: the arc is the one thing that rises above a basin or a rim.
  for (const part of [column, arc, spout]) part.name = 'tap';
}

/**
 * Undermount basin cut into a worktop, with a drain.
 *
 * The bowl takes the `ceramic` slot, not `accent`: on a dark kitchen the accent
 * is the hob glass, and a sink finished in it reads as a second hob.
 */
export function sinkBasin(group: THREE.Group, kit: BuildKit, x: number, deck: number, z: number, width: number, depth: number): void {
  const bowl = kit.finish('ceramic');
  put(group, kit.rounded(width, 0.09, depth, 0.028), bowl, { x, y: deck - 0.043, z });
  put(group, kit.rounded(width - 0.05, 0.02, depth - 0.05, 0.02), bowl, { x, y: deck + 0.002, z });
  put(group, kit.cylinder(0.035, 0.03, 0.008, 14), kit.finish('metal'), { x, y: deck + 0.012, z });
}

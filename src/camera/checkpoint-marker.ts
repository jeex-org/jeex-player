/**
 * One tour camera's glyph: a DSLR-style camera — a body with a raised prism hump on
 * top, a grip on its right, a shutter nub on the grip, and a lens barrel with
 * an accent ring and a lighter glass disc in front — and a frustum pyramid
 * whose APEX sits at the glass and opens forward at the tour's real field of
 * view; on the floor a disc and a translucent field-of-view wedge along the
 * yaw; a dashed stem that joins the two so the height reads.
 *
 * Procedural and cheap: the graphite parts are ONE merged geometry (body,
 * hump, grip, nub, barrel), lit Lambert in a mid graphite so the shape reads
 * from above and from the side; the ring and the glass are one mesh each; a
 * thin dark edge outline is always on, the accent outline only on the active
 * camera.
 *
 * Why a body with a lens and an apex-at-lens pyramid: a forward-pointing cone
 * is the universal glyph for a pin or an arrow, so a bare frustum reads as
 * pointing the wrong way; a pyramid whose apex sits at the lens reads as a
 * camera looking forward. Blender and three's own `CameraHelper` draw exactly
 * this.
 *
 * Structure: `root` stands on the floor under the camera and never rotates;
 * `head` rides at the camera's height with the YXZ (yaw, then pitch) rotation;
 * `rig` inside it carries everything the size floor scales (`setScale`) — the
 * body, its x-ray twin, the outline, the lens and the frustum; `footprint` on
 * the floor turns with the yaw only. The floor parts therefore never tilt with
 * the pitch, as a single rotated group would.
 *
 * Two passes: every body is drawn depth-tested AND as an x-ray ghost (~30 %
 * opacity, `depthFunc: GreaterDepth` — drawn exactly where something nearer
 * hides it), so a camera behind or inside a wall still shows where the author
 * can grab it, and a visible body is not tinted by its own ghost.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TourCheckpoint } from '../scene/types.js';

export const ACCENT = 0xdfbd7d;
const ACCENT_HOVER = 0xfff0c8;
/** Mid graphite, not near-black: a lit body that keeps its shading at the 28 px floor. */
const BODY_COLOUR = 0x4d565a;
const BODY_HOVER = 0x657074;
/** The front glass: lighter than the body, cool. */
const GLASS_COLOUR = 0xa9bfcc;
/** The always-on edge outline of an inactive camera. */
const EDGE_COLOUR = 0x1b2022;
const FOOTPRINT_COLOUR = 0x8fa3a0;
const GHOST_OK = 0x3fbf6f;
const GHOST_BAD = 0xd9534f;

/** Camera body extents, metres (width × height × depth); the grip and the hump stand on it. */
export const BODY_WIDTH_M = 0.2;
const BODY_HEIGHT_M = 0.12;
const BODY_DEPTH_M = 0.09;
/** The grip on the photographer's right (the head's −X), standing a little proud of the front. */
const GRIP_WIDTH_M = 0.05;
const GRIP_DEPTH_M = 0.11;
/** The prism hump: a square frustum on top, its base and top widths and its height. */
const HUMP_BASE_M = 0.075;
const HUMP_TOP_M = 0.045;
const HUMP_HEIGHT_M = 0.04;
const NUB_RADIUS_M = 0.012;
const NUB_HEIGHT_M = 0.012;
const LENS_RADIUS_M = 0.042;
const LENS_LENGTH_M = 0.085;
const RING_LENGTH_M = 0.014;
const GLASS_RADIUS_M = 0.034;
/** The frustum's apex, on the glass, metres ahead of the body centre. */
const LENS_FRONT_M = BODY_DEPTH_M / 2 + LENS_LENGTH_M;
/** How far the frustum reaches ahead of the lens, metres. */
const FRUSTUM_DEPTH_M = 0.6;
const FRUSTUM_EDGE_RADIUS_M = 0.006;
const DISC_RADIUS_M = 0.12;
/** The floor wedge's reach, metres; its tip is the yaw drag handle. */
export const WEDGE_RADIUS_M = 0.8;
/** Height of the floor parts above the floor, metres — clear of z-fighting with the floor finish. */
const FLOOR_LIFT_M = 0.012;

/** Half the body's height, metres — where the stem meets it. */
const BODY_HALF_HEIGHT_M = BODY_HEIGHT_M / 2;
/** The glyph's top above its centre, the hump included, metres — the height arrow and the badge start above it. */
export const GLYPH_TOP_M = BODY_HALF_HEIGHT_M + HUMP_HEIGHT_M;

/** How a marker is drawn this frame. */
export type MarkerState = {
  readonly active: boolean;
  /** The pointer is over the body (or the footprint). */
  readonly hovered: boolean;
  /** A move drag over a spot the tour cannot stand on: tinted red. */
  readonly invalid: boolean;
};

/** Horizontal field of view for a vertical one at `aspect`, radians. */
export function horizontalFov(verticalRad: number, aspect: number): number {
  return 2 * Math.atan(Math.tan(verticalRad / 2) * aspect);
}

/**
 * The frustum's four far corners in the head's frame (+Z forward, +Y up,
 * +X — left of the camera's own view in three's right-handed frame, which is
 * symmetric here), for a horizontal/vertical field of view.
 */
export function frustumCorners(horizontalRad: number, verticalRad: number, depth = FRUSTUM_DEPTH_M): THREE.Vector3[] {
  const w = Math.tan(horizontalRad / 2) * depth;
  const h = Math.tan(verticalRad / 2) * depth;
  const z = LENS_FRONT_M + depth;
  return [new THREE.Vector3(-w, -h, z), new THREE.Vector3(w, -h, z), new THREE.Vector3(w, h, z), new THREE.Vector3(-w, h, z)];
}

/** Thin cylinders along each segment, merged — a 1 px `LineSegments` frustum is invisible at viewing distance. */
function edgeGeometry(segments: ReadonlyArray<readonly [THREE.Vector3, THREE.Vector3]>, radius: number): THREE.BufferGeometry {
  const parts = segments.map(([a, b]) => {
    const length = a.distanceTo(b);
    const cylinder = new THREE.CylinderGeometry(radius, radius, length, 5, 1, true);
    const direction = new THREE.Vector3().subVectors(b, a).normalize();
    cylinder.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction));
    cylinder.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return cylinder;
  });
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const part of parts) part.dispose();
  return merged;
}

/** The pyramid's edges: apex to each corner, then the base rectangle. */
function frustumEdges(corners: readonly THREE.Vector3[]): Array<[THREE.Vector3, THREE.Vector3]> {
  const apex = new THREE.Vector3(0, 0, LENS_FRONT_M);
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = corners.map((corner) => [apex, corner]);
  for (let index = 0; index < corners.length; index += 1) edges.push([corners[index]!, corners[(index + 1) % corners.length]!]);
  return edges;
}

/** A geometry as a plain non-indexed triangle list, so differently built parts merge. */
function plain(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.index) return geometry;
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
}

/** The body box alone: also the x-ray twin, because a twin of the whole non-convex glyph would ghost its own barrel through the body. */
function bodyBoxGeometry(): THREE.BufferGeometry {
  return new RoundedBoxGeometry(BODY_WIDTH_M, BODY_HEIGHT_M, BODY_DEPTH_M, 2, 0.018);
}

/**
 * The graphite parts in the head's frame (+Z forward, +Y up, −X the
 * photographer's right), merged into one geometry: body, prism hump, grip,
 * shutter nub, lens barrel. The outline's shape.
 */
export function cameraBodyGeometry(): THREE.BufferGeometry {
  return mergedParts([bodyBoxGeometry(), ...cameraParts()]);
}

/** The graphite parts beyond the box (hump, grip, nub, barrel), merged: drawn after the x-ray pass. */
function cameraPartsGeometry(): THREE.BufferGeometry {
  return mergedParts(cameraParts());
}

function mergedParts(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geometries.map((part) => plain(part));
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const part of parts) part.dispose();
  return merged;
}

function cameraParts(): THREE.BufferGeometry[] {
  const grip = new RoundedBoxGeometry(GRIP_WIDTH_M, BODY_HEIGHT_M * 0.96, GRIP_DEPTH_M, 2, 0.016);
  const gripX = -(BODY_WIDTH_M - GRIP_WIDTH_M) / 2 - 0.004;
  grip.translate(gripX, -0.002, (GRIP_DEPTH_M - BODY_DEPTH_M) / 2);
  // Four radial segments turned 45°: a square frustum, the pentaprism housing.
  const hump = new THREE.CylinderGeometry(HUMP_TOP_M / Math.SQRT2, HUMP_BASE_M / Math.SQRT2, HUMP_HEIGHT_M, 4, 1);
  hump.rotateY(Math.PI / 4);
  hump.translate(0, BODY_HALF_HEIGHT_M + HUMP_HEIGHT_M / 2 - 0.004, 0.004);
  const nub = new THREE.CylinderGeometry(NUB_RADIUS_M, NUB_RADIUS_M, NUB_HEIGHT_M, 10);
  nub.translate(gripX, BODY_HALF_HEIGHT_M + NUB_HEIGHT_M / 2 - 0.002, GRIP_DEPTH_M / 2 - 0.028);
  const barrel = new THREE.CylinderGeometry(LENS_RADIUS_M, LENS_RADIUS_M * 1.04, LENS_LENGTH_M, 20);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, -0.006, BODY_DEPTH_M / 2 + LENS_LENGTH_M / 2);
  return [grip, hump, nub, barrel];
}

/** The floor wedge: a circle sector of `fov` along +Z, lying on the floor. */
function wedgeGeometry(horizontalRad: number): THREE.BufferGeometry {
  // CircleGeometry lies in XY; rotating it onto the floor sends +Y to -Z, so
  // the sector centred on -90° is the one that opens along +Z.
  const geometry = new THREE.CircleGeometry(WEDGE_RADIUS_M, 18, -Math.PI / 2 - horizontalRad / 2, horizontalRad);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class CameraMarker {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  private readonly rig = new THREE.Group();
  private readonly footprint = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly frustum: THREE.Mesh;
  private readonly wedge: THREE.Mesh;
  private readonly stem: THREE.Line;
  private readonly outline: THREE.Mesh;
  private readonly outlineMaterial: THREE.MeshBasicMaterial;
  /** Whether the outline is the active accent one (not the thin dark edge). */
  private accented = false;
  private readonly bodyMaterial: THREE.MeshLambertMaterial;
  private readonly xrayMaterial: THREE.MeshBasicMaterial;
  private readonly lensMaterial: THREE.MeshBasicMaterial;
  private readonly glassMaterial: THREE.MeshLambertMaterial;
  /** The graphite of the parts beyond the box: the body's colour, queued after the x-ray pass. */
  private readonly partsMaterial: THREE.MeshLambertMaterial;
  private readonly frustumMaterial: THREE.MeshBasicMaterial;
  private readonly footMaterial: THREE.MeshBasicMaterial;
  private readonly stemMaterial: THREE.LineDashedMaterial;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** The field of view the frustum and the wedge were last built for, rounded; rebuilt only when it changes. */
  private fovKey = '';
  private height = -1;
  private readonly ghost: boolean;

  /**
   * `ghost` is the click-to-place preview: the same glyph, drawn on top in
   * the navigability tint, with no x-ray twin (it IS all x-ray).
   */
  constructor(id: string, ghost = false) {
    this.ghost = ghost;
    // The ghost is not a document camera: nothing that lists cameras by this key may see it.
    if (!ghost) this.root.userData['checkpointId'] = id;
    this.root.name = ghost ? 'checkpointGhost' : `checkpoint:${id}`;
    this.bodyMaterial = this.track(new THREE.MeshLambertMaterial({ color: BODY_COLOUR }));
    // Drawn only where something NEARER already wrote depth (`GreaterDepth`):
    // the ghost of a camera behind a wall, never a tint over a visible body.
    this.xrayMaterial = this.track(
      new THREE.MeshBasicMaterial({
        color: FOOTPRINT_COLOUR,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        depthFunc: THREE.GreaterDepth,
      }),
    );
    this.lensMaterial = this.track(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 1 }));
    this.frustumMaterial = this.track(new THREE.MeshBasicMaterial({ color: ACCENT }));
    this.footMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: FOOTPRINT_COLOUR, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.stemMaterial = this.track(new THREE.LineDashedMaterial({ color: FOOTPRINT_COLOUR, dashSize: 0.07, gapSize: 0.05 }));

    // Draw order is what keeps the ghost honest on a non-convex glyph: the
    // opaque pass draws the body BOX only; the x-ray twin of that same box
    // (renderOrder 5) then ghosts it where the SCENE hides it; the hump, the
    // grip, the barrel, the ring and the glass draw after it (renderOrder 6,
    // opaque in look, in the transparent queue for the order), so the twin
    // never sees them and never paints its tint over the camera's own parts.
    const boxGeometry = this.keep(plain(bodyBoxGeometry()));
    this.body = new THREE.Mesh(boxGeometry, ghost ? this.xrayMaterial : this.bodyMaterial);
    this.rig.add(this.body);
    this.partsMaterial = this.track(new THREE.MeshLambertMaterial({ color: BODY_COLOUR, transparent: true, opacity: 1 }));
    const parts = new THREE.Mesh(this.keep(cameraPartsGeometry()), ghost ? this.xrayMaterial : this.partsMaterial);
    parts.renderOrder = 6;
    this.rig.add(parts);
    if (!ghost) {
      const xray = new THREE.Mesh(boxGeometry, this.xrayMaterial);
      xray.renderOrder = 5;
      xray.name = 'xray';
      this.rig.add(xray);
    }
    const bodyGeometry = this.keep(cameraBodyGeometry());
    // The outline: the body's back faces, a little larger — a thin dark edge
    // on every camera, a wider accent silhouette on the active one, without a
    // post-processing pass.
    this.outlineMaterial = this.track(new THREE.MeshBasicMaterial({ color: EDGE_COLOUR, side: THREE.BackSide }));
    this.outline = new THREE.Mesh(bodyGeometry, this.outlineMaterial);
    this.outline.scale.setScalar(1.06);
    this.outline.visible = !ghost;
    this.rig.add(this.outline);

    // The accent ring near the front of the barrel, and the glass disc in front of it.
    const ringGeometry = this.keep(new THREE.CylinderGeometry(LENS_RADIUS_M * 1.12, LENS_RADIUS_M * 1.12, RING_LENGTH_M, 20));
    ringGeometry.rotateX(Math.PI / 2);
    ringGeometry.translate(0, -0.006, LENS_FRONT_M - RING_LENGTH_M / 2 - 0.006);
    const ring = new THREE.Mesh(ringGeometry, this.lensMaterial);
    ring.renderOrder = 6;
    this.rig.add(ring);
    const glassGeometry = this.keep(new THREE.CircleGeometry(GLASS_RADIUS_M, 20));
    glassGeometry.translate(0, -0.006, LENS_FRONT_M + 0.001);
    this.glassMaterial = this.track(
      new THREE.MeshLambertMaterial({ color: GLASS_COLOUR, emissive: 0x24343c, transparent: true, opacity: 1 }),
    );
    const glass = new THREE.Mesh(glassGeometry, ghost ? this.xrayMaterial : this.glassMaterial);
    glass.renderOrder = 6;
    this.rig.add(glass);

    this.frustum = new THREE.Mesh(this.keep(new THREE.BufferGeometry()), this.frustumMaterial);
    this.frustum.visible = false;
    this.rig.add(this.frustum);
    this.head.add(this.rig);
    this.root.add(this.head);

    const disc = new THREE.Mesh(this.keep(new THREE.CircleGeometry(DISC_RADIUS_M, 24).rotateX(-Math.PI / 2)), this.footMaterial);
    this.wedge = new THREE.Mesh(this.keep(new THREE.BufferGeometry()), this.footMaterial);
    this.footprint.position.y = FLOOR_LIFT_M;
    this.footprint.add(disc, this.wedge);
    this.root.add(this.footprint);

    this.stem = new THREE.Line(this.keep(new THREE.BufferGeometry()), this.stemMaterial);
    this.root.add(this.stem);

    if (ghost) {
      for (const material of [this.xrayMaterial, this.lensMaterial, this.frustumMaterial, this.footMaterial, this.stemMaterial]) {
        material.depthTest = false;
      }
      this.xrayMaterial.depthFunc = THREE.LessEqualDepth;
      this.root.renderOrder = 9;
      this.root.traverse((object) => {
        object.renderOrder = 9;
      });
      this.frustum.visible = true;
    }
  }

  /** Applies a pose, the field of view (radians, horizontal and vertical) and the state. */
  sync(checkpoint: TourCheckpoint, fov: { horizontal: number; vertical: number }, state: MarkerState): void {
    this.root.position.set(checkpoint.position.x, 0, checkpoint.position.z);
    this.head.position.y = checkpoint.position.y;
    this.head.rotation.order = 'YXZ';
    this.head.rotation.set(-checkpoint.pitch, checkpoint.yaw, 0);
    this.footprint.rotation.y = checkpoint.yaw;
    if (this.height !== checkpoint.position.y) this.setStem(checkpoint.position.y);
    const key = `${fov.horizontal.toFixed(3)}:${fov.vertical.toFixed(3)}`;
    if (key !== this.fovKey) this.setFov(fov.horizontal, fov.vertical, key);
    this.applyState(state);
  }

  /** The size floor: `scale` ≥ 1 enlarges the body, lens and frustum about the camera point. */
  setScale(scale: number): void {
    this.rig.scale.setScalar(scale);
  }

  /** Whether the frustum and the outline are showing (the active look), for tests. */
  get emphasised(): boolean {
    return this.frustum.visible && (this.ghost || this.accented);
  }

  /** The lens's current colour, hex — what a test reads for «active carries the accent». */
  get lensColour(): number {
    return this.lensMaterial.color.getHex();
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
  }

  private applyState(state: MarkerState): void {
    if (this.ghost) {
      const tint = state.invalid ? GHOST_BAD : GHOST_OK;
      for (const material of [this.xrayMaterial, this.lensMaterial, this.frustumMaterial, this.footMaterial]) material.color.setHex(tint);
      this.stemMaterial.color.setHex(tint);
      return;
    }
    this.accented = state.active;
    this.outlineMaterial.color.setHex(state.active ? ACCENT : EDGE_COLOUR);
    this.outline.scale.setScalar(state.active ? 1.14 : 1.06);
    this.frustum.visible = state.active;
    this.bodyMaterial.color.setHex(state.hovered ? BODY_HOVER : BODY_COLOUR);
    this.partsMaterial.color.setHex(state.hovered ? BODY_HOVER : BODY_COLOUR);
    this.lensMaterial.color.setHex(state.hovered && state.active ? ACCENT_HOVER : ACCENT);
    const foot = state.invalid ? GHOST_BAD : state.active ? ACCENT : FOOTPRINT_COLOUR;
    this.footMaterial.color.setHex(foot);
    this.footMaterial.opacity = state.active ? 0.42 : 0.3;
    this.stemMaterial.color.setHex(foot);
    this.xrayMaterial.color.setHex(foot);
  }

  private setStem(height: number): void {
    this.height = height;
    const geometry = this.stem.geometry;
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, FLOOR_LIFT_M, 0, 0, Math.max(FLOOR_LIFT_M, height - BODY_HALF_HEIGHT_M), 0], 3),
    );
    this.stem.computeLineDistances();
  }

  private setFov(horizontal: number, vertical: number, key: string): void {
    this.fovKey = key;
    const frustum = edgeGeometry(frustumEdges(frustumCorners(horizontal, vertical)), FRUSTUM_EDGE_RADIUS_M);
    this.replace(this.frustum, frustum);
    this.replace(this.wedge, wedgeGeometry(horizontal));
  }

  private replace(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): void {
    const old = mesh.geometry;
    const index = this.geometries.indexOf(old);
    if (index >= 0) this.geometries.splice(index, 1);
    old.dispose();
    mesh.geometry = this.keep(geometry);
  }

  private track<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private keep<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }
}

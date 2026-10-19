/**
 * The active camera's 3D handles: the
 * HEIGHT arrow standing above the body, the YAW ring lying on the floor around
 * the footprint, and the PITCH slider — a
 * screen-aligned vertical track beside the body with a knob at the camera's
 * pitch. An arc in the look plane was edge-on from exactly where an author
 * stands; a billboard never is. Which handles a mode offers is
 * the overlay's call (`place`'s `handles`): `plan3d` draws no height and no
 * pitch, a top view shows neither truthfully.
 *
 * Both handles keep a CONSTANT SCREEN SIZE: they are built in pixel units and
 * scaled every frame by the world size of one pixel at the point they stand on
 * (`place`). The arrow's base sits `HEIGHT_GAP_PX` above the body's top, so the
 * body's own centre is never the height handle (otherwise dragging the body
 * would lift it). The overlay projects the same layout for picking
 * (`handleLayout`, `ringPoints`), so what is drawn is what is grabbed.
 *
 * Drawn on top (`depthTest: false`), because a handle inside a wall that
 * cannot be seen cannot be grabbed with intent.
 */

import * as THREE from 'three';
import { HEIGHT_GAP_PX, HEIGHT_LENGTH_PX, PITCH_GAP_PX, PITCH_LENGTH_PX, RING_RADIUS_PX, type HandleKind } from './checkpoint-picking.js';
import { ACCENT } from './checkpoint-marker.js';
import { TOUR_PITCH_LIMIT_RAD, type TourCheckpoint } from '../scene/types.js';

const HOVER = 0xfff0c8;
/** The pitch knob: dark, so it reads on the accent track and on a light floor alike. */
const KNOB = 0x1c2523;
/** Points of the ring polyline the picking measures against. */
export const RING_POINTS = 48;
/** Ring and arrow thickness, px. */
const TUBE_PX = 2.5;
const TIP_RADIUS_PX = 8;
const TIP_LENGTH_PX = 16;
/** The pitch slider's knob radius and the level tick's half width, px. */
const KNOB_RADIUS_PX = 8;
/**
 * How far the active camera's accent outline reaches past the glyph, as a
 * share of its size (the outline is the glyph at 1.14, `checkpoint-marker.ts`,
 * plus a margin): the handles start beyond it, or a close view merges them
 * into the outline.
 */
const OUTLINE_REACH = 1.2;
const TICK_HALF_PX = 7;

/** The world size of one screen pixel at the two places the handles stand. */
export type HandleScale = {
  /** Metres per pixel at the camera's own point. */
  readonly head: number;
  /** Metres per pixel at the camera's floor point. */
  readonly floor: number;
  /** The glyph's drawn top above its centre in pixels, the prism hump included (after the size floor). */
  readonly bodyHalfPx: number;
  /** Half the body's drawn width in pixels (after the size floor): the pitch slider stands this far plus a gap aside. */
  readonly bodyHalfWidthPx: number;
  /** The drawing camera's screen right and screen up, unit world vectors: the pitch slider's billboard frame. */
  readonly right: Point3;
  readonly up: Point3;
};

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Where the handles stand for `checkpoint` at `scale`, in world space — the
 * ONE layout the gizmo draws and the overlay projects for picking.
 */
export function handleLayout(
  checkpoint: TourCheckpoint,
  scale: HandleScale,
): {
  base: Point3;
  tip: Point3;
  centre: { x: number; z: number };
  ringRadius: number;
  pitch: { centre: Point3; top: Point3; bottom: Point3 };
} {
  const { x, y, z } = checkpoint.position;
  const baseY = y + (scale.bodyHalfPx * OUTLINE_REACH + HEIGHT_GAP_PX) * scale.head;
  // Beside the body on screen, never above (the arrow) or below (the stem and
  // the footprint): screen right of the body, centred on its height.
  const aside = (scale.bodyHalfWidthPx * OUTLINE_REACH + PITCH_GAP_PX) * scale.head;
  const half = (PITCH_LENGTH_PX / 2) * scale.head;
  const along = (metres: number): Point3 => ({
    x: x + scale.right.x * aside + scale.up.x * metres,
    y: y + scale.right.y * aside + scale.up.y * metres,
    z: z + scale.right.z * aside + scale.up.z * metres,
  });
  return {
    base: { x, y: baseY, z },
    tip: { x, y: baseY + HEIGHT_LENGTH_PX * scale.head, z },
    centre: { x, z },
    ringRadius: RING_RADIUS_PX * scale.floor,
    pitch: { centre: along(0), top: along(half), bottom: along(-half) },
  };
}

/** The ring as `RING_POINTS` world points on the floor. */
export function ringPoints(centre: { x: number; z: number }, radius: number): Point3[] {
  return Array.from({ length: RING_POINTS }, (_, index) => {
    const angle = (index / RING_POINTS) * Math.PI * 2;
    return { x: centre.x + Math.sin(angle) * radius, y: 0, z: centre.z + Math.cos(angle) * radius };
  });
}

export class Gizmo {
  readonly group = new THREE.Group();
  private readonly arrow = new THREE.Group();
  private readonly ring = new THREE.Group();
  /** The pitch slider in pixel units, its local Y the screen's up (`place` turns it to face the view). */
  private readonly slider = new THREE.Group();
  private readonly knob: THREE.Mesh;
  private readonly arrowMaterial: THREE.MeshBasicMaterial;
  private readonly sliderMaterial: THREE.MeshBasicMaterial;
  private readonly knobMaterial: THREE.MeshBasicMaterial;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** Scratch for the slider's billboard basis: `place` runs every frame while a camera is active. */
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor() {
    this.group.visible = false;
    this.group.name = 'checkpointGizmo';
    this.arrowMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, depthWrite: false, transparent: true });
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: ACCENT,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });

    // The arrow in pixel units, base at the origin, pointing up.
    const shaftLength = HEIGHT_LENGTH_PX - TIP_LENGTH_PX;
    const shaft = this.keep(new THREE.CylinderGeometry(TUBE_PX, TUBE_PX, shaftLength, 8));
    shaft.translate(0, shaftLength / 2, 0);
    const tip = this.keep(new THREE.ConeGeometry(TIP_RADIUS_PX, TIP_LENGTH_PX, 12));
    tip.translate(0, shaftLength + TIP_LENGTH_PX / 2, 0);
    // A small cone pointing DOWN at the base: the arrow reads «up and down».
    const foot = this.keep(new THREE.ConeGeometry(TIP_RADIUS_PX * 0.75, TIP_LENGTH_PX * 0.7, 12));
    foot.rotateX(Math.PI);
    foot.translate(0, TIP_LENGTH_PX * 0.35, 0);
    this.arrow.add(
      new THREE.Mesh(shaft, this.arrowMaterial),
      new THREE.Mesh(tip, this.arrowMaterial),
      new THREE.Mesh(foot, this.arrowMaterial),
    );

    // The ring in pixel units, flat on the floor.
    const torus = this.keep(new THREE.TorusGeometry(RING_RADIUS_PX, TUBE_PX, 6, 72));
    torus.rotateX(Math.PI / 2);
    this.ring.add(new THREE.Mesh(torus, this.ringMaterial));

    // The pitch slider: a track, a tick at level, and the knob at the pitch.
    this.sliderMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, depthWrite: false, transparent: true });
    const track = this.keep(new THREE.CylinderGeometry(TUBE_PX, TUBE_PX, PITCH_LENGTH_PX, 8));
    const tick = this.keep(new THREE.BoxGeometry(TICK_HALF_PX * 2, TUBE_PX, TUBE_PX));
    this.knobMaterial = new THREE.MeshBasicMaterial({ color: KNOB, depthTest: false, depthWrite: false, transparent: true });
    this.knob = new THREE.Mesh(this.keep(new THREE.SphereGeometry(KNOB_RADIUS_PX, 16, 12)), this.knobMaterial);
    // A rim in the accent around the dark knob.
    const rim = new THREE.Mesh(this.keep(new THREE.TorusGeometry(KNOB_RADIUS_PX, TUBE_PX * 0.8, 6, 24)), this.sliderMaterial);
    this.knob.add(rim);
    this.slider.add(new THREE.Mesh(track, this.sliderMaterial), new THREE.Mesh(tick, this.sliderMaterial), this.knob);

    this.group.add(this.arrow, this.ring, this.slider);
    this.group.traverse((object) => {
      object.renderOrder = 10;
    });
    // The knob over its own track.
    this.knob.traverse((object) => {
      object.renderOrder = 11;
    });
  }

  /** Stands the handles `handles` names on `checkpoint` at this frame's pixel scale. */
  place(checkpoint: TourCheckpoint, scale: HandleScale, handles: ReadonlySet<HandleKind>): void {
    const layout = handleLayout(checkpoint, scale);
    this.group.visible = true;
    this.arrow.visible = handles.has('height');
    this.arrow.position.set(layout.base.x, layout.base.y, layout.base.z);
    this.arrow.scale.setScalar(scale.head);
    this.ring.visible = handles.has('yaw');
    this.ring.position.set(layout.centre.x, 0.015, layout.centre.z);
    this.ring.scale.setScalar(scale.floor);
    this.slider.visible = handles.has('pitch');
    this.slider.position.set(layout.pitch.centre.x, layout.pitch.centre.y, layout.pitch.centre.z);
    this.slider.scale.setScalar(scale.head);
    this.right.set(scale.right.x, scale.right.y, scale.right.z);
    this.up.set(scale.up.x, scale.up.y, scale.up.z);
    this.back.crossVectors(this.right, this.up);
    this.slider.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.right, this.up, this.back));
    // The knob along the track: level at the middle, the pitch limit at an end. Not picked, so not in the layout.
    this.knob.position.y = Math.max(-1, Math.min(1, checkpoint.pitch / TOUR_PITCH_LIMIT_RAD)) * (PITCH_LENGTH_PX / 2);
  }

  /** Brightens the handle under the pointer; `null` restores them all. */
  hover(kind: HandleKind | null): void {
    this.arrowMaterial.color.setHex(kind === 'height' ? HOVER : ACCENT);
    this.ringMaterial.color.setHex(kind === 'yaw' ? HOVER : ACCENT);
    this.sliderMaterial.color.setHex(kind === 'pitch' ? HOVER : ACCENT);
  }

  clear(): void {
    this.group.visible = false;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.arrowMaterial.dispose();
    this.ringMaterial.dispose();
    this.sliderMaterial.dispose();
    this.knobMaterial.dispose();
    this.group.clear();
  }

  private keep<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }
}

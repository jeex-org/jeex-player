/**
 * The tube the placement overlay draws along the tour-checkpoint trajectory
 * (`checkpoint-overlay.ts`), apart from the overlay because it is pure
 * geometry: the walk `tour-route.checkpointPathOf` lays from camera to camera
 * through the doorways, taken as the polyline it is — exactly what
 * `tourRouteOf` hands the player, which rides a checkpoint route without
 * filleting it — so what the author SEES is bit-for-bit the curve the tour
 * RIDES.
 */

import * as THREE from 'three';
import { checkpointPathOf } from '../scene/tour-route.js';
import { clamp } from '../shared/math.js';
import type { TourCheckpoint } from '../scene/types.js';
import type { TourNavigation } from '../navigation/tour-legs.js';

/**
 * A straight-line curve over the sampled tour path, for `TubeGeometry`.
 * The samples already ARE the curve; this only walks them.
 */
class SampledCurve extends THREE.Curve<THREE.Vector3> {
  private readonly points: THREE.Vector3[];

  constructor(points: THREE.Vector3[]) {
    super();
    this.points = points;
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const last = this.points.length - 1;
    const f = clamp(t, 0, 1) * last;
    const index = Math.min(Math.floor(f), last - 1);
    return target.copy(this.points[index]!).lerp(this.points[index + 1]!, f - index);
  }
}

/**
 * The trajectory tube through `checkpoints`, or `null` when they make no
 * trajectory (fewer than two, or all on one spot). `navigation` is the
 * committed plan's walkable space — the same one the director hands the tour —
 * without which the tube is the bare spline through the cameras. The caller
 * owns the mesh: its geometry and material are disposed with it.
 */
export function trajectoryTube(checkpoints: readonly TourCheckpoint[], colour: number, navigation?: TourNavigation): THREE.Mesh | null {
  if (checkpoints.length < 2) return null;
  const { path } = checkpointPathOf(checkpoints, navigation);
  if (path.length < 2) return null;
  const points = path.map((point) => new THREE.Vector3(point.x, point.y, point.z));
  const curve = new SampledCurve(points);
  // One tube segment per path sample (a decimetre), capped for long flats.
  const geometry = new THREE.TubeGeometry(curve, Math.min(800, Math.max(64, points.length)), 0.04, 8, false);
  const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, depthWrite: false });
  const tube = new THREE.Mesh(geometry, material);
  tube.renderOrder = 5;
  return tube;
}

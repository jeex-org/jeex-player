/**
 * Where a walker jumped into a room stands and looks: the mini-map's answer in
 * walk when no route through the doors gets there (`CameraDirector.travelToRoom`).
 * It stands on the room's clear standing point (`roomStandingPoint`) at eye
 * height, facing the room camera's aim, or on along the look it had when the
 * room camera aims at the very spot.
 */

import * as THREE from 'three';
import { roomStandingPoint } from '../navigation/room-graph.js';
import { EYE_HEIGHT_M, type Obstacle } from '../navigation/navigation.js';
import type { SolvedPlan } from '../plan/plan-solver.js';
import type { CameraPose, SceneData } from '../scene/types.js';

export function roomJumpPose(
  plan: SolvedPlan,
  scene: SceneData,
  roomId: string,
  obstacles: readonly Obstacle[],
  current: CameraPose,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const point = roomStandingPoint(plan, scene, roomId, obstacles);
  const position = new THREE.Vector3(point.x, EYE_HEIGHT_M, point.z);
  const look = scene.roomCameras[roomId]?.target;
  if (look && Math.hypot(look.x - point.x, look.z - point.z) > 1e-3)
    return { position, target: new THREE.Vector3(look.x, EYE_HEIGHT_M, look.z) };
  const ahead = new THREE.Vector3(current.target.x - current.position.x, 0, current.target.z - current.position.z).normalize();
  return { position, target: position.clone().add(ahead) };
}

/**
 * Six tour cameras through the demo apartment (`demo/scene-data.ts`): living
 * room, kitchen, hall, bedroom, the study beside it and the guest bedroom,
 * with a different look at each — the tour-motion fixture. The route turns
 * back at the kitchen, the bedroom and the study (dead ends off the walk
 * between them), passes several doorways and the corridor hall, and changes
 * pitch at every camera.
 */

import type { TourCheckpoint } from '../scene/types.js';
import { SIX_CAMERAS } from './tour-six-cameras-ids.js';

export const sixCameraTour: readonly TourCheckpoint[] = [
  { id: SIX_CAMERAS.living, position: { x: 3.95, y: 1.55, z: 6.9 }, yaw: 0.5, pitch: -0.3 },
  { id: SIX_CAMERAS.kitchen, position: { x: 1.2, y: 1.5, z: 1.2 }, yaw: -Math.PI / 2, pitch: -0.4 },
  { id: SIX_CAMERAS.hall, position: { x: 9.0, y: 1.6, z: 4.45 }, yaw: Math.PI / 2, pitch: 0 },
  { id: SIX_CAMERAS.bed, position: { x: 8.2, y: 1.6, z: 7.6 }, yaw: Math.PI, pitch: -0.2 },
  { id: SIX_CAMERAS.room, position: { x: 11.8, y: 1.5, z: 6.6 }, yaw: -2.5, pitch: -0.35 },
  { id: SIX_CAMERAS.guest, position: { x: 9.6, y: 1.6, z: 2.5 }, yaw: 2.8, pitch: -0.1 },
];

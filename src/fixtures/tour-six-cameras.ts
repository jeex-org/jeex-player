/**
 * Six tour cameras through the demo apartment (`demo/scene-data.ts`): living
 * room, kitchen, hall, bedroom, the room beside it and the study, with a
 * different look at each — the tour-motion fixture. The
 * route turns back at the kitchen, the bedroom and the room beside it (dead
 * ends), passes several doorways and a short corridor, and changes pitch at
 * every camera.
 */

import type { TourCheckpoint } from '../scene/types.js';
import { SIX_CAMERAS } from './tour-six-cameras-ids.js';

export const sixCameraTour: readonly TourCheckpoint[] = [
  { id: SIX_CAMERAS.living, position: { x: 4.4, y: 1.55, z: 2.4 }, yaw: 0.5, pitch: -0.3 },
  { id: SIX_CAMERAS.kitchen, position: { x: 1.1, y: 1.5, z: 5.2 }, yaw: -Math.PI / 2, pitch: -0.4 },
  { id: SIX_CAMERAS.hall, position: { x: 6.5, y: 1.6, z: 6.5 }, yaw: Math.PI / 2, pitch: 0 },
  { id: SIX_CAMERAS.bed, position: { x: 11.9, y: 1.6, z: 8.4 }, yaw: Math.PI, pitch: -0.2 },
  { id: SIX_CAMERAS.room, position: { x: 12, y: 1.5, z: 5.2 }, yaw: -2.5, pitch: -0.35 },
  { id: SIX_CAMERAS.study, position: { x: 8, y: 1.6, z: 3.5 }, yaw: 2.8, pitch: -0.1 },
];

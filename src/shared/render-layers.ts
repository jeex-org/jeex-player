/**
 * Every render layer the player uses besides three's default layer 0, in one
 * table, so two features never pick the same number.
 *
 * A camera draws an object only when they share a layer, and three's
 * raycaster tests layer 0 alone by default, so an object off layer 0 is never
 * drawn by a camera that did not ask for its layer and never picked.
 *
 * Pure module: no `three`, no DOM.
 */

/**
 * The walk floor ring. Only the viewer's own camera enables it
 * (`app/viewer-stage.ts`): a still, a panorama or any other capture renders
 * with a camera of its own on layer 0 and never shows the cursor that happened
 * to be under the pointer.
 */
export const FLOOR_RING_LAYER = 1;

/**
 * Casters that block the sun without ever being seen: the closed ceiling slabs
 * (`geometry/ceiling-casters.ts`) and whatever the dollhouse cuts away. No
 * camera enables this layer for drawing; the shadow pass alone does
 * (`render/shadow-layer-pass.ts`).
 */
export const SHADOW_ONLY_LAYER = 2;

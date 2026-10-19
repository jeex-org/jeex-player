/**
 * The three sections that describe the PLAN's own entities: plan nodes,
 * scene-local material overrides, and rooms.
 *
 * Invariant: `checkNodes` is the ONE writer of `ctx.nodePoints` and
 * `checkRooms` the ONE writer of `ctx.roomIds`, so a wall can only reference a
 * node this file has already accepted, and every later section's "unknown
 * room" check reads the set this file filled.
 *
 * Pure module: no `three`, no DOM.
 */

import { isFiniteVec2, requireFinishFamily, type ValidationContext } from './context.js';
import { ROOM_KINDS, isMemberOf } from '../schema-sets.js';

/** Plan nodes: the id grammar and finite coordinates. */
export function checkNodes(ctx: ValidationContext): void {
  for (const [index, node] of ctx.scene.nodes.entries()) {
    const path = `nodes[${index}]`;
    if (!node || typeof node !== 'object') ctx.fail('node-not-object', path, 'Plan nodes must be objects');
    const id = ctx.claim('plan node', node.id, `${path}.id`);
    if (!isFiniteVec2(node.p)) ctx.fail('node-coordinates-invalid', `${path}.p`, `Plan node ${id} has invalid coordinates`);
    ctx.nodePoints.set(id, node.p);
  }
}

/**
 * Scene-local material overrides: shape plus the shared id registry.
 *
 * `SceneData.materials[]` means "extra ids this scene defines", not "every id
 * this scene may use" (`material-catalogue.resolveFinish`), so this checks the
 * declarations and nothing about what references them.
 */
export function checkMaterials(ctx: ValidationContext): void {
  for (const [index, material] of ctx.materials.entries()) {
    const path = `materials[${index}]`;
    if (!material || typeof material !== 'object') ctx.fail('material-not-object', path, 'Scene materials must be objects');
    const id = ctx.claim('material', material.id, `${path}.id`);
    if (typeof material.name !== 'string' || !material.name) {
      ctx.fail('material-name-missing', `${path}.name`, `Material ${id} needs a name`);
    }
    if (typeof material.color !== 'string' || !material.color) {
      ctx.fail('material-colour-missing', `${path}.color`, `Material ${id} needs a color`);
    }
    if (typeof material.roughness !== 'number' || !Number.isFinite(material.roughness)) {
      ctx.fail('material-roughness-invalid', `${path}.roughness`, `Material ${id} has an invalid roughness`);
    }
    if (material.metalness !== undefined && !Number.isFinite(material.metalness)) {
      ctx.fail('material-metalness-invalid', `${path}.metalness`, `Material ${id} has an invalid metalness`);
    }
  }
}

/** Rooms: id, name, an interior anchor, a known kind, a floor finish, and the outline a source may have supplied. */
export function checkRooms(ctx: ValidationContext): void {
  for (const [index, room] of ctx.scene.rooms.entries()) {
    const path = `rooms[${index}]`;
    if (!room || typeof room !== 'object') ctx.fail('room-not-object', path, 'Rooms must be objects');
    const id = ctx.claim('room', room.id, `${path}.id`);
    ctx.roomIds.add(id);
    if (typeof room.name !== 'string' || !room.name) ctx.fail('room-name-missing', `${path}.name`, `Room ${id} needs a name`);
    if (!isFiniteVec2(room.anchor)) ctx.fail('room-anchor-invalid', `${path}.anchor`, `Room ${id} has an invalid anchor`);
    if (room.kind !== undefined && !isMemberOf(ROOM_KINDS, room.kind)) {
      ctx.fail('room-kind-unknown', `${path}.kind`, `Room ${id} has unknown kind ${String(room.kind)}`, { kind: room.kind });
    }
    // A source-supplied outline replaces the graph face this room has none of,
    // so it must be a real ring: anything the solver would hand on as a room
    // polygon is checked here rather than by whatever reads it later.
    const outline: unknown = room.polygon;
    if (outline !== undefined && (!Array.isArray(outline) || outline.length < 3 || !outline.every((point) => isFiniteVec2(point)))) {
      ctx.fail('room-polygon-invalid', `${path}.polygon`, `Room ${id} outline must be at least three finite points`);
    }
    requireFinishFamily(ctx, room.floorMaterial, 'floor', `Room ${id} floor material`, `${path}.floorMaterial`);
  }
}

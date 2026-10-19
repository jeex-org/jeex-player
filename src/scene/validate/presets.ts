/**
 * Interior presets (`SceneData.interiors`) — the LAST section, because it
 * replays real operations and everything an operation may name must already be
 * sound.
 *
 * The shape checks are ordinary; the interesting one is the DRY RUN. Every
 * preset is applied to a throwaway deep copy through the very appliers
 * `SceneModel.apply` uses, so a preset that names a room, asset, opening,
 * finish or variant the scene does not have fails validation of the SCENE
 * instead of failing at click time, and the two can never disagree about what
 * an operation means. The copy is discarded, so the validated scene is
 * untouched.
 *
 * Pure module: no `three`, no DOM.
 */

import { draftOf } from '../../shared/committed.js';
import { OpError, applyOp } from '../scene-ops.js';
import { requireFinishFamily, type ValidationContext } from './context.js';
import type { InteriorPreset, SceneOp } from '../types.js';

/**
 * The operations that create an entity under a caller-minted UUID. A preset
 * may not carry one: applying it would claim the UUID, and the dry run of the
 * very document that results would then refuse the same op as `duplicate_id`,
 * so the preset could never be committed. A preset dresses what exists.
 */
const CREATING_OPS: ReadonlySet<string> = new Set<SceneOp['op']>([
  'add_node',
  'add_wall',
  'split_wall',
  'add_room',
  'add_opening',
  'place_object',
]);

export function checkInteriorPresets(ctx: ValidationContext): void {
  const presets: readonly InteriorPreset[] | undefined = ctx.scene.interiors;
  if (presets === undefined) return;
  if (!Array.isArray(presets)) ctx.fail('interiors-not-array', 'interiors', 'Scene interiors must be an array');
  for (const [index, preset] of presets.entries()) {
    const path = `interiors[${index}]`;
    if (!preset || typeof preset !== 'object') ctx.fail('interior-preset-not-object', path, 'Interior presets must be objects');
    const id = ctx.claim('interior preset', preset.id, `${path}.id`);
    if (typeof preset.name !== 'string' || !preset.name) {
      ctx.fail('interior-preset-name-missing', `${path}.name`, `Interior preset ${id} needs a name`);
    }
    if (!Array.isArray(preset.swatch) || preset.swatch.length !== 2) {
      ctx.fail('interior-preset-swatch-invalid', `${path}.swatch`, `Interior preset ${id} needs a swatch of exactly two finish ids`);
    }
    requireFinishFamily(ctx, preset.swatch[0], 'floor', `Interior preset ${id} swatch floor`, `${path}.swatch[0]`);
    requireFinishFamily(ctx, preset.swatch[1], 'wall', `Interior preset ${id} swatch wall`, `${path}.swatch[1]`);
    if (!Array.isArray(preset.ops) || preset.ops.length === 0) {
      ctx.fail('interior-preset-ops-missing', `${path}.ops`, `Interior preset ${id} needs at least one operation`);
    }
    for (const [opIndex, op] of preset.ops.entries()) {
      const name: unknown = (op as { op?: unknown } | null)?.op;
      if (typeof name === 'string' && CREATING_OPS.has(name)) {
        ctx.fail('interior-preset-op-creates', `${path}.ops[${opIndex}]`, `Interior preset ${id} may not create entities (${name})`, {
          op: name,
        });
      }
    }
    dryRun(ctx, preset, id, path);
  }
}

/** Applies one preset to a private copy; a refusal becomes the scene's refusal. */
function dryRun(ctx: ValidationContext, preset: InteriorPreset, id: string, path: string): void {
  const draft = draftOf(ctx.scene);
  for (const [opIndex, op] of preset.ops.entries()) {
    try {
      applyOp(draft, op, ctx.registries);
    } catch (error) {
      const message = error instanceof OpError || error instanceof Error ? error.message : String(error);
      ctx.fail(
        'interior-preset-op-failed',
        `${path}.ops[${opIndex}]`,
        `Interior preset ${id} has an operation that cannot apply: ${message}`,
        {
          op: (op as { op?: unknown }).op ?? null,
        },
      );
    }
  }
}

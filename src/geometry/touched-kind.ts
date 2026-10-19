/**
 * One dispatch shape over a commit's touched entities (`scene/ops/context.ts`'s
 * `TouchedEntity` union), so `app/viewer-editor.ts` and
 * `geometry/scene-builder.ts` — the two consumers of `SceneModel.apply`'s
 * `touched` array — fold over the SAME table shape instead of each growing
 * its own `switch`.
 *
 * The union is the scene layer's; this module only adds the per-kind table
 * one layer up, in `geometry/`, which both consumers already import downward
 * from. Every handler receives its member already narrowed, so it reads the
 * room UUID, the `FaceKey` or the placement id as a field.
 */

import { faceText, type TouchedEntity } from '../scene/scene-ops.js';

type TouchedKind = TouchedEntity['kind'];

/** The member of the union a `kind` names. */
type TouchedOf<K extends TouchedKind> = Extract<TouchedEntity, { readonly kind: K }>;

/**
 * A dispatch table over every kind, one handler each — a caller writes a
 * table instead of a `switch`. `Ctx` is whatever state the caller's handlers
 * need to read or accumulate into.
 */
export type TouchedHandlers<Ctx> = { readonly [K in TouchedKind]: (ctx: Ctx, entity: TouchedOf<K>) => void };

/** Runs the handler of each entity's kind for every entity in `touched`, in order. */
export function dispatchTouched<Ctx>(ctx: Ctx, touched: readonly TouchedEntity[], handlers: TouchedHandlers<Ctx>): void {
  for (const entity of touched) {
    // The mapped type pairs each kind with its own member, which TypeScript
    // cannot correlate through an index; `entity.kind` selects exactly that pair.
    const handler = handlers[entity.kind] as (ctx: Ctx, entity: TouchedEntity) => void;
    handler(ctx, entity);
  }
}

/** A touched entity for a log or an error line: its kind and the ids it carries. */
export function touchedText(entity: TouchedEntity): string {
  switch (entity.kind) {
    case 'floor':
    case 'walls':
      return `${entity.kind} ${entity.room}`;
    case 'face':
      return `face ${faceText(entity.face)}`;
    case 'asset':
    case 'opening':
      return `${entity.kind} ${entity.id}`;
    case 'camera':
      return typeof entity.target === 'object' ? `camera ${entity.target.room}` : `camera ${entity.target}`;
    case 'shell':
    case 'facade':
    case 'navigation':
    case 'autotour':
    case 'tourCheckpoints':
      return entity.kind;
  }
}

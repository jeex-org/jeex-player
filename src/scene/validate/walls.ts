/**
 * Walls and their openings: the section that carries most of the schema's
 * geometry rules.
 *
 * Split three ways on purpose — a wall's own fields, one opening's fields, and
 * the pairwise "no two openings overlap" — so no single function carries a
 * nested loop of dozens of `fail()` guards.
 *
 * Invariant: an opening is checked against the wall's TRUE centreline length
 * (arc length for a curved wall), not its chord, so the same opening is legal
 * on a straight wall and illegal on the arc that is shorter than it.
 *
 * Pure module: no `three`, no DOM.
 */

import { EPS, arcFromChord, arcLength, dist } from '../../plan/plan-geometry.js';
import { CEILING_OPENING_MARGIN, OPENING_EDGE_MARGIN } from '../../plan/plan-openings.js';
import { fail, type ValidationContext } from './context.js';
import { OPENING_HINGES, OPENING_SHAPES, OPENING_SWINGS, WALL_ROLES, isMemberOf, isOpeningType } from '../schema-sets.js';
import { WALL_LIMITS, isDoorLike, type Opening, type Vec2, type Wall, type WallArc } from '../types.js';

/** Centreline length of a wall, validating its arc on the way. */
function centrelineLength(wallId: string, path: string, a: Vec2, b: Vec2, arc: WallArc | undefined): number {
  const chord = dist(a, b);
  if (!arc) return chord;
  if (!Number.isFinite(arc.radius) || !(arc.radius > 0)) {
    fail('arc-radius-invalid', `${path}.arc.radius`, `Wall ${wallId} has an invalid arc radius ${arc.radius}`, { radius: arc.radius });
  }
  if (arc.radius < chord / 2 - EPS) {
    fail(
      'arc-radius-below-half-chord',
      `${path}.arc.radius`,
      `Wall ${wallId} arc radius ${arc.radius} is below half of its chord ${(chord / 2).toFixed(3)}`,
      {
        radius: arc.radius,
        chord,
      },
    );
  }
  return arcLength(arcFromChord(a, b, arc.radius, arc.ccw));
}

/** The `t` interval one opening occupies on its wall's centreline. */
type OpeningSpan = { readonly id: string; readonly t0: number; readonly t1: number };

/**
 * One opening: its type, its fit inside the wall, its heights, and the
 * door-only fields.
 *
 * Answers with the span it occupies, so the caller can prove the openings of
 * one wall do not overlap without walking them twice.
 */
function checkOpening(ctx: ValidationContext, wall: Wall, opening: Opening, path: string, wallLength: number): OpeningSpan {
  const ceilingHeight = ctx.scene.ceilingHeight;
  if (!opening || typeof opening !== 'object') ctx.fail('opening-not-object', path, `Wall ${wall.id} has an opening that is not an object`);
  const openingId = ctx.claim('opening', opening.id, `${path}.id`);
  if (!isOpeningType(opening.type)) {
    ctx.fail('opening-type-unknown', `${path}.type`, `Opening ${openingId} has unknown type ${String(opening.type)}`, {
      type: String(opening.type),
    });
  }
  if (!Number.isFinite(opening.center) || !Number.isFinite(opening.width) || opening.width <= 0) {
    ctx.fail('opening-width-invalid', `${path}.width`, `Opening ${openingId} has invalid width`, {
      width: opening.width,
      center: opening.center,
    });
  }
  const t0 = opening.center - opening.width / 2;
  const t1 = opening.center + opening.width / 2;
  if (t0 < OPENING_EDGE_MARGIN || t1 > wallLength - OPENING_EDGE_MARGIN) {
    ctx.fail('opening-outside-wall', `${path}.center`, `Opening ${openingId} does not fit inside wall ${wall.id}`, {
      t0,
      t1,
      length: wallLength,
      margin: OPENING_EDGE_MARGIN,
    });
  }
  if (opening.sill !== undefined && !Number.isFinite(opening.sill)) {
    ctx.fail('opening-sill-invalid', `${path}.sill`, `Opening ${openingId} has a non-finite sill`);
  }
  if (opening.head !== undefined && !Number.isFinite(opening.head)) {
    ctx.fail('opening-head-invalid', `${path}.head`, `Opening ${openingId} has a non-finite head`);
  }
  const sill = opening.sill ?? 0;
  const head = opening.head ?? ceilingHeight - CEILING_OPENING_MARGIN;
  const maxHead = ceilingHeight - CEILING_OPENING_MARGIN;
  if (sill < 0 || sill >= head) {
    ctx.fail('opening-sill-head-order', `${path}.sill`, `Opening ${openingId} has invalid sill/head heights`, { sill, head });
  }
  if (head > maxHead + EPS) {
    ctx.fail(
      'opening-head-above-ceiling',
      `${path}.head`,
      `Opening ${openingId} head ${head} must stay ${CEILING_OPENING_MARGIN} m below the ceiling (${ceilingHeight} m)`,
      { head, maxHead, ceilingHeight },
    );
  }
  if (isDoorLike(opening.type) && sill !== 0) {
    ctx.fail('door-sill-not-floor', `${path}.sill`, `Door opening ${openingId} must start at the floor`, { sill });
  }
  if (opening.shape !== undefined && !isMemberOf(OPENING_SHAPES, opening.shape)) {
    ctx.fail('opening-shape-unknown', `${path}.shape`, `Opening ${openingId} has unknown shape ${String(opening.shape)}`, {
      shape: opening.shape,
    });
  }
  checkEntrance(ctx, opening, openingId, path);
  checkLeafFields(ctx, opening, openingId, path);
  checkOpeningVariant(ctx, opening, openingId, path);
  return { id: openingId, t0, t1 };
}

/**
 * `entrance: true`, at most once in the document.
 *
 * The entrance drives the entrance variant set, the UI label and the start of
 * the tour: a second one makes all three ambiguous.
 */
function checkEntrance(ctx: ValidationContext, opening: Opening, openingId: string, path: string): void {
  if (opening.entrance === undefined) return;
  if (typeof opening.entrance !== 'boolean') {
    ctx.fail('opening-entrance-not-boolean', `${path}.entrance`, `Opening ${openingId} entrance must be a boolean`);
  }
  if (!opening.entrance) return;
  if (opening.type !== 'door') {
    ctx.fail('opening-entrance-not-door', `${path}.entrance`, `Opening ${openingId} is an entrance but not a door`, {
      type: opening.type,
    });
  }
  if (ctx.entrance) {
    ctx.fail(
      'opening-second-entrance',
      `${path}.entrance`,
      `Opening ${openingId} is a second entrance door; the apartment already has ${ctx.entrance}`,
      {
        first: ctx.entrance,
      },
    );
  }
  ctx.entrance = openingId;
}

/**
 * `hinge` and `swing`: known values, and door-only.
 *
 * They steer the built leaf (`door-swing.ts`), and a leaf makes no sense on a
 * window or on a leafless passage.
 */
function checkLeafFields(ctx: ValidationContext, opening: Opening, openingId: string, path: string): void {
  if (opening.hinge !== undefined) {
    if (!isMemberOf(OPENING_HINGES, opening.hinge)) {
      ctx.fail('opening-hinge-unknown', `${path}.hinge`, `Opening ${openingId} has unknown hinge ${String(opening.hinge)}`, {
        hinge: String(opening.hinge),
      });
    }
    if (opening.type !== 'door') {
      ctx.fail('opening-hinge-not-door', `${path}.hinge`, `Opening ${openingId} is a ${opening.type} and cannot carry a hinge`, {
        type: opening.type,
      });
    }
  }
  if (opening.swing !== undefined) {
    if (!isMemberOf(OPENING_SWINGS, opening.swing)) {
      ctx.fail('opening-swing-unknown', `${path}.swing`, `Opening ${openingId} has unknown swing ${String(opening.swing)}`, {
        swing: String(opening.swing),
      });
    }
    if (opening.type !== 'door') {
      ctx.fail('opening-swing-not-door', `${path}.swing`, `Opening ${openingId} is a ${opening.type} and cannot carry a swing`, {
        type: opening.type,
      });
    }
  }
}

/** The named variant, and that it was built for this kind of opening. */
function checkOpeningVariant(ctx: ValidationContext, opening: Opening, openingId: string, path: string): void {
  if (opening.variant === undefined) return;
  const variant = ctx.registries.findOpeningVariant(opening.variant);
  if (!variant) {
    ctx.fail('opening-variant-unknown', `${path}.variant`, `Opening ${openingId} references unknown variant ${opening.variant}`, {
      variant: opening.variant,
    });
  }
  if (variant.for !== ctx.registries.variantFamily(opening.type)) {
    ctx.fail(
      'opening-variant-family',
      `${path}.variant`,
      `Opening ${openingId} variant ${opening.variant} is built for a ${variant.for}, not a ${opening.type}`,
      { variant: opening.variant, builtFor: variant.for, type: opening.type },
    );
  }
}

/** No two openings of one wall share centreline. Sorted, so one pass is enough. */
function assertNoOverlap(ctx: ValidationContext, wall: Wall, wallPath: string, spans: OpeningSpan[]): void {
  spans.sort((left, right) => left.t0 - right.t0);
  for (let i = 1; i < spans.length; i += 1) {
    const previous = spans[i - 1]!;
    const current = spans[i]!;
    if (current.t0 < previous.t1 - EPS) {
      ctx.fail('openings-overlap', `${wallPath}.openings`, `Openings ${previous.id} and ${current.id} overlap on wall ${wall.id}`, {
        first: previous.id,
        second: current.id,
      });
    }
  }
}

/** One wall: id, role, both endpoints, thickness, centreline length. */
function checkWall(ctx: ValidationContext, wall: Wall, wallPath: string): number {
  if (!wall || typeof wall !== 'object') ctx.fail('wall-not-object', wallPath, 'Walls must be objects');
  ctx.claim('wall', wall.id, `${wallPath}.id`);
  if (wall.role !== undefined && !isMemberOf(WALL_ROLES, wall.role)) {
    ctx.fail('wall-role-unknown', `${wallPath}.role`, `Wall ${wall.id} has unknown role ${String(wall.role)}`, { role: wall.role });
  }
  if (typeof wall.a !== 'string' || typeof wall.b !== 'string') {
    ctx.fail('wall-endpoints-invalid', `${wallPath}.a`, `Invalid wall ${wall.id}`);
  }
  const a = ctx.nodePoints.get(wall.a);
  if (!a) ctx.fail('wall-unknown-node', `${wallPath}.a`, `Wall ${wall.id} references unknown node ${wall.a}`, { node: wall.a });
  const b = ctx.nodePoints.get(wall.b);
  if (!b) ctx.fail('wall-unknown-node', `${wallPath}.b`, `Wall ${wall.id} references unknown node ${wall.b}`, { node: wall.b });
  if (wall.a === wall.b) ctx.fail('wall-self-loop', `${wallPath}.b`, `Wall ${wall.id} starts and ends at node ${wall.a}`, { node: wall.a });
  if (typeof wall.thickness !== 'number' || !Number.isFinite(wall.thickness)) {
    ctx.fail('wall-thickness-invalid', `${wallPath}.thickness`, `Invalid wall ${wall.id}`);
  }
  if (wall.thickness < WALL_LIMITS.minThickness - EPS || wall.thickness > WALL_LIMITS.maxThickness + EPS) {
    ctx.fail(
      'wall-thickness-range',
      `${wallPath}.thickness`,
      `Wall ${wall.id} thickness ${wall.thickness} is outside the allowed range ${WALL_LIMITS.minThickness}..${WALL_LIMITS.maxThickness} m`,
      { thickness: wall.thickness, min: WALL_LIMITS.minThickness, max: WALL_LIMITS.maxThickness },
    );
  }

  const length = centrelineLength(wall.id, wallPath, a, b, wall.arc);
  if (length < WALL_LIMITS.minCentrelineLength - EPS) {
    ctx.fail(
      'wall-centreline-too-short',
      wallPath,
      `Wall ${wall.id} centreline length ${length.toFixed(3)} is below the minimum ${WALL_LIMITS.minCentrelineLength} m`,
      { length, min: WALL_LIMITS.minCentrelineLength },
    );
  }
  return length;
}

/** Every wall, and every opening on it. */
export function checkWalls(ctx: ValidationContext): void {
  for (const [wallIndex, wall] of ctx.scene.walls.entries()) {
    const wallPath = `walls[${wallIndex}]`;
    const length = checkWall(ctx, wall, wallPath);
    const spans: OpeningSpan[] = [];
    for (const [openingIndex, opening] of (wall.openings ?? []).entries()) {
      spans.push(checkOpening(ctx, wall, opening, `${wallPath}.openings[${openingIndex}]`, length));
    }
    assertNoOverlap(ctx, wall, wallPath, spans);
  }
}

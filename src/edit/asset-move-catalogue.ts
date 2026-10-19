/**
 * The object bank a drag is judged against: the shipped one, else what the
 * built body says of an object a baked project's own library brought.
 *
 * Pure module: no `three`, no DOM.
 */

import { shippedFacts, type LayoutCatalogue } from '../layout/layout-lint.js';
import type { MirrorFacts } from '../scene/types.js';
import type { SurfaceFacts } from '../assets/asset-types.js';

/** The archetype facts a built body carries (`asset-loader.ts` `userData`). */
export type BodyFacts = {
  readonly archetype: string;
  readonly anchor: 'floor' | 'wall' | 'ceiling';
  readonly dims: readonly [number, number, number];
  readonly clearance: number;
  /** The yaw the builder adds on top of the placement's (a legacy facing compensation). */
  readonly yaw: number;
  /** Mirror axes the archetype allows, as the body was tagged with them; absent allows none. */
  readonly mirror?: MirrorFacts | undefined;
  /** Surfaces and tucking at the variant's size, as the body was tagged with them; absent allows none. */
  readonly surfaces?: SurfaceFacts | undefined;
};

/**
 * The bank a drag is judged against: the shipped one, else the facts the
 * built body carries, so an object of a baked project's own library moves
 * too — judged without its archetype's layout facts (mount heights, case
 * goods), which only its manifest has.
 */
export function dragCatalogue(bodyFacts: (assetId: string) => BodyFacts | null): LayoutCatalogue {
  return (placement) => {
    const shipped = shippedFacts(placement);
    if (shipped) return shipped;
    const body = bodyFacts(placement.id);
    if (!body) return null;
    const scale = Math.abs(placement.scale ?? 1);
    return {
      archetype: body.archetype,
      anchor: body.anchor,
      wallSnap: false,
      clearance: body.clearance,
      dims: body.dims,
      yaw: body.yaw,
      layout: undefined,
      footprint: body.anchor === 'floor' ? { hx: (body.dims[0] / 2) * scale, hz: (body.dims[2] / 2) * scale } : null,
      mirror: body.mirror,
      ...(body.surfaces ? { surfaces: body.surfaces } : {}),
    };
  };
}

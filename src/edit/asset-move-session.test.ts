/**
 * The session's host as the tool sees it: the editing modes draw on demand,
 * so every preview pose (a drag, a nudge, a mirror, a revert to the start)
 * and every legality field drawn or removed asks the viewer for a frame.
 */

import { describe, expect, test } from 'bun:test';
import type { AssetMoveHost } from './asset-move-tool.js';
import { redrawingHost } from './asset-move-session.js';
import type { LegalityMask } from '../layout/asset-mask.js';

function host(): { base: Omit<AssetMoveHost, 'drawMask'>; shown: string[]; redraws: { count: number } } {
  const shown: string[] = [];
  const redraws = { count: 0 };
  const base = {
    active: () => true,
    selected: () => null,
    pickAsset: () => null,
    ray: () => null,
    document: () => null,
    bodyFacts: () => null,
    show: (assetId: string) => shown.push(assetId),
    tint: () => undefined,
    viewYaw: () => 0,
    onEdit: () => undefined,
    onRefused: () => undefined,
    onMoving: () => undefined,
  };
  return { base, shown, redraws };
}

describe('redrawingHost', () => {
  test('a preview pose shows the body and asks for a frame, with or without a mirror', () => {
    const { base, shown, redraws } = host();
    const wrapped = redrawingHost({ ...base, redraw: () => (redraws.count += 1) }, () => undefined);
    wrapped.show('asset', { position: { x: 1, y: 0, z: 2 }, rotationY: 0 });
    wrapped.show('asset', { position: { x: 1, y: 0, z: 2 }, rotationY: 0 }, { x: true });
    expect(shown).toEqual(['asset', 'asset']);
    expect(redraws.count).toBe(2);
  });

  test('a field drawn and a field removed each ask for a frame, the mask alone included', () => {
    const { base, redraws } = host();
    const fields: Array<LegalityMask | null> = [];
    const wrapped = redrawingHost({ ...base, redraw: () => (redraws.count += 1) }, (field) => fields.push(field));
    const field = { count: 0, ok: new Uint8Array(0), positions: new Float32Array(0) } as unknown as LegalityMask;
    wrapped.drawMask(field);
    wrapped.drawMask(null);
    expect(fields).toEqual([field, null]);
    expect(redraws.count).toBe(2);
  });

  test('without a redraw it only passes through', () => {
    const { base, shown } = host();
    const wrapped = redrawingHost(base, () => undefined);
    wrapped.show('asset', { position: { x: 0, y: 0, z: 0 }, rotationY: 0 });
    wrapped.drawMask(null);
    expect(shown).toEqual(['asset']);
  });
});

import { describe, expect, test } from 'bun:test';
import { GLAZING_BAR_M, SASH_BAR_M, leafPanelRects, paneLayout } from './opening-geometry.js';

const W = 1.4;
const H = 1.2;

/** Sum of pane widths plus the vertical bars must fill the glazed rectangle exactly. */
function spansWidth(layout: ReturnType<typeof paneLayout>, width: number): boolean {
  const columns = new Map<number, number>();
  for (const pane of layout.panes) columns.set(pane.x, pane.width);
  let total = 0;
  for (const value of columns.values()) total += value;
  for (const bar of layout.bars) if (bar.orientation === 'vertical') total += bar.width;
  return Math.abs(total - width) < 1e-9;
}

describe('paneLayout', () => {
  test('a single pane without mullions fills the whole rectangle', () => {
    const layout = paneLayout(W, H, 1, 'none');
    expect(layout.bars).toHaveLength(0);
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0]).toEqual({ x: 0, y: 0, width: W, height: H });
  });

  test('two panes are split by one sash bar', () => {
    const layout = paneLayout(W, H, 2, 'none');
    expect(layout.panes).toHaveLength(2);
    expect(layout.bars).toHaveLength(1);
    const bar = layout.bars[0]!;
    expect(bar.orientation).toBe('vertical');
    expect(bar.kind).toBe('sash');
    expect(bar.width).toBeCloseTo(SASH_BAR_M, 9);
    expect(layout.panes[0]!.width).toBeCloseTo(layout.panes[1]!.width, 9);
    expect(spansWidth(layout, W)).toBe(true);
  });

  test('vertical mullions split every sash in two with a thinner glazing bar', () => {
    const layout = paneLayout(W, H, 2, 'vertical');
    expect(layout.panes).toHaveLength(4);
    const vertical = layout.bars.filter((bar) => bar.orientation === 'vertical');
    expect(vertical.map((bar) => bar.kind)).toEqual(['glazing', 'sash', 'glazing']);
    expect(vertical[0]!.width).toBeCloseTo(GLAZING_BAR_M, 9);
    expect(vertical[1]!.width).toBeCloseTo(SASH_BAR_M, 9);
    expect(spansWidth(layout, W)).toBe(true);
  });

  test('a grid adds one horizontal bar and doubles the rows', () => {
    const layout = paneLayout(W, H, 2, 'grid');
    expect(layout.panes).toHaveLength(8);
    const horizontal = layout.bars.filter((bar) => bar.orientation === 'horizontal');
    expect(horizontal).toHaveLength(1);
    expect(horizontal[0]!.kind).toBe('glazing');
    expect(horizontal[0]!.width).toBeCloseTo(W, 9);
    for (const pane of layout.panes) expect(pane.height).toBeCloseTo((H - GLAZING_BAR_M) / 2, 9);
  });

  test('three panes stay ordered left to right and inside the rectangle', () => {
    const layout = paneLayout(W, H, 3, 'none');
    expect(layout.panes).toHaveLength(3);
    let cursor = -1;
    for (const pane of layout.panes) {
      expect(pane.x).toBeGreaterThan(cursor);
      cursor = pane.x;
      expect(pane.x).toBeGreaterThanOrEqual(0);
      expect(pane.x + pane.width).toBeLessThanOrEqual(W + 1e-9);
    }
    expect(spansWidth(layout, W)).toBe(true);
  });

  test('bars span the full opposite dimension so they meet the frame', () => {
    const layout = paneLayout(W, H, 3, 'grid');
    for (const bar of layout.bars) {
      if (bar.orientation === 'vertical') expect(bar.height).toBeCloseTo(H, 9);
      else expect(bar.width).toBeCloseTo(W, 9);
    }
  });

  test('a rectangle too small for its bars yields nothing instead of negative panes', () => {
    expect(paneLayout(0.05, H, 3, 'grid').panes).toHaveLength(0);
    expect(paneLayout(W, 0, 2, 'none').panes).toHaveLength(0);
    expect(paneLayout(-1, H, 1, 'none').bars).toHaveLength(0);
  });
});

describe('leafPanelRects', () => {
  test('two inset panels sit inside the leaf with symmetric margins', () => {
    const rects = leafPanelRects(0.86, 2.0, 2);
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThan(0.86);
      expect(rect.y).toBeGreaterThan(0);
      expect(rect.y + rect.height).toBeLessThan(2.0);
      expect(rect.x).toBeCloseTo(0.86 - (rect.x + rect.width), 9);
    }
    expect(rects[0]!.y).toBeLessThan(rects[1]!.y);
  });

  test('panels of one leaf never overlap', () => {
    const rects = leafPanelRects(0.9, 2.05, 3);
    expect(rects).toHaveLength(3);
    for (let i = 1; i < rects.length; i += 1) {
      expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.height - 1e-9);
    }
  });

  test('a leaf too small for panels yields none', () => {
    expect(leafPanelRects(0.1, 0.2, 2)).toHaveLength(0);
    expect(leafPanelRects(0.9, 2, 0)).toHaveLength(0);
  });
});

/**
 * Pure layout math for window and door variants: how the glazed rectangle of a
 * window splits into panes and bars, and where the inset panels of a panelled
 * door leaf sit. Coordinates are local to the rectangle being divided, in
 * metres, origin at its bottom-left corner, `x` to the right and `y` up.
 *
 * Invariant: the pane columns and the vertical bars tile the rectangle exactly
 * (same for rows and horizontal bars); a rectangle too small for its bars
 * produces an empty layout instead of negative panes. No `three`, no DOM.
 */

/** Structural bar between two sashes, in metres. */
export const SASH_BAR_M = 0.045;
/** Decorative glazing bar inside one sash, in metres. */
export const GLAZING_BAR_M = 0.028;

export type PaneRect = { x: number; y: number; width: number; height: number };
export type PaneBar = PaneRect & { orientation: 'vertical' | 'horizontal'; kind: 'sash' | 'glazing' };
export type PaneLayout = { panes: PaneRect[]; bars: PaneBar[] };

/**
 * Splits a glazed rectangle into `panes` sashes (1..3) plus the mullion pattern:
 * `vertical` halves every sash with a glazing bar, `grid` halves it both ways.
 * Bars span the full opposite dimension, so they meet the frame on both ends.
 */
export function paneLayout(
  width: number,
  height: number,
  panes: 1 | 2 | 3,
  mullions: 'none' | 'vertical' | 'grid',
  bar: { sash?: number; glazing?: number } = {},
): PaneLayout {
  if (!(width > 0) || !(height > 0)) return { panes: [], bars: [] };
  const sashBar = bar.sash ?? SASH_BAR_M;
  const glazingBar = bar.glazing ?? GLAZING_BAR_M;
  const sashes = Math.min(3, Math.max(1, Math.round(panes)));
  const perSash = mullions === 'none' ? 1 : 2;
  const columns = sashes * perSash;
  const rows = mullions === 'grid' ? 2 : 1;

  // Bar between column i and i+1: a sash bar on a sash boundary, else a glazing bar.
  const verticalWidths: number[] = [];
  for (let i = 0; i + 1 < columns; i += 1) verticalWidths.push((i + 1) % perSash === 0 ? sashBar : glazingBar);
  const horizontalHeights: number[] = [];
  for (let i = 0; i + 1 < rows; i += 1) horizontalHeights.push(glazingBar);

  const columnWidth = (width - verticalWidths.reduce((sum, value) => sum + value, 0)) / columns;
  const rowHeight = (height - horizontalHeights.reduce((sum, value) => sum + value, 0)) / rows;
  if (!(columnWidth > 0) || !(rowHeight > 0)) return { panes: [], bars: [] };

  const bars: PaneBar[] = [];
  const columnStarts: number[] = [];
  let x = 0;
  for (let i = 0; i < columns; i += 1) {
    columnStarts.push(x);
    x += columnWidth;
    const barWidth = verticalWidths[i];
    if (barWidth === undefined) continue;
    bars.push({
      x,
      y: 0,
      width: barWidth,
      height,
      orientation: 'vertical',
      kind: (i + 1) % perSash === 0 ? 'sash' : 'glazing',
    });
    x += barWidth;
  }

  const rowStarts: number[] = [];
  let y = 0;
  for (let i = 0; i < rows; i += 1) {
    rowStarts.push(y);
    y += rowHeight;
    const barHeight = horizontalHeights[i];
    if (barHeight === undefined) continue;
    bars.push({ x: 0, y, width, height: barHeight, orientation: 'horizontal', kind: 'glazing' });
    y += barHeight;
  }

  const rects: PaneRect[] = [];
  for (const startX of columnStarts) {
    for (const startY of rowStarts) rects.push({ x: startX, y: startY, width: columnWidth, height: rowHeight });
  }
  return { panes: rects, bars };
}

/** Side margin of an inset door panel as a fraction of the leaf width. */
const PANEL_SIDE_RATIO = 0.14;
/** Vertical margin at the top and bottom of the panel stack, as a fraction of the leaf height. */
const PANEL_END_RATIO = 0.09;
/** Gap between two stacked panels, as a fraction of the leaf height. */
const PANEL_GAP_RATIO = 0.06;
/** Below this panel size (metres) a panelled leaf stays flat. */
const MIN_PANEL_M = 0.12;

/**
 * Inset panels of a panelled door leaf, bottom-up, centred horizontally.
 * Returns an empty list when the leaf is too small to carry them.
 */
export function leafPanelRects(width: number, height: number, rows: number): PaneRect[] {
  const count = Math.max(0, Math.round(rows));
  if (count === 0 || !(width > 0) || !(height > 0)) return [];
  const side = width * PANEL_SIDE_RATIO;
  const end = height * PANEL_END_RATIO;
  const gap = height * PANEL_GAP_RATIO;
  const panelWidth = width - side * 2;
  const panelHeight = (height - end * 2 - gap * (count - 1)) / count;
  if (panelWidth < MIN_PANEL_M || panelHeight < MIN_PANEL_M) return [];
  const rects: PaneRect[] = [];
  for (let i = 0; i < count; i += 1) {
    rects.push({ x: side, y: end + i * (panelHeight + gap), width: panelWidth, height: panelHeight });
  }
  return rects;
}

/**
 * The cell centres of a search over a plan rectangle, bounded in count for
 * any finite coordinates and any size: the step is at least `minStep` and is
 * widened so the lattice holds at most `maxCells` cells, and the centres are
 * computed from integer indices, so a coordinate where `x + step === x`
 * (around 1e16) cannot stall the walk.
 *
 * Pure module: no `three`, no DOM.
 */

/** Cells a plan search visits at most; the same budget as the placement mask's floor grid. */
export const SEARCH_MAX_CELLS = 10_000;

export type SearchCell = { x: number; z: number };

/** Every cell centre over `[minX, maxX] x [minZ, maxZ]`, row by row. */
export function searchLattice(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minStep: number,
  maxCells = SEARCH_MAX_CELLS,
): SearchCell[] {
  const width = Math.max(0, maxX - minX);
  const depth = Math.max(0, maxZ - minZ);
  const step = Math.max(minStep, Math.sqrt((width * depth) / maxCells));
  const nx = Math.min(maxCells, Math.max(1, Math.ceil(width / step)));
  const nz = Math.min(Math.floor(maxCells / nx), Math.max(1, Math.ceil(depth / step)));
  const cells: SearchCell[] = [];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) cells.push({ x: minX + ((i + 0.5) * width) / nx, z: minZ + ((j + 0.5) * depth) / nz });
  }
  return cells;
}

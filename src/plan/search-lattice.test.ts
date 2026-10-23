import { describe, expect, test } from 'bun:test';
import { SEARCH_MAX_CELLS, searchLattice } from './search-lattice.js';

describe('searchLattice', () => {
  test('a small room keeps the minimum step', () => {
    const cells = searchLattice(0, 1, 0, 0.5, 0.1);
    expect(cells).toHaveLength(50);
    expect(cells[0]).toEqual({ x: 0.05, z: 0.05 });
  });

  test('a very large room and a needle room stay within the cell cap', () => {
    expect(searchLattice(0, 3000, 0, 3000, 0.1).length).toBeLessThanOrEqual(SEARCH_MAX_CELLS);
    expect(searchLattice(0, 1e9, 0, 0.1, 0.1).length).toBeLessThanOrEqual(SEARCH_MAX_CELLS);
  });

  test('coordinates where a step vanishes in floating point still end', () => {
    const cells = searchLattice(1e16, 1e16 + 1000, 1e16, 1e16 + 500, 0.1);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(SEARCH_MAX_CELLS);
  });
});

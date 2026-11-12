/**
 * The README's table of the three delivery forms is the delivery table
 * (`src/embed/delivery-contract.ts`) written out: the block between its two
 * markers must be exactly what `deliveryBlock()` builds from the rows. A
 * method or an event that reaches a form without the README saying so, or the
 * other way round, fails here.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CAPTURE_MEMBERS,
  ELEMENT_EVENTS,
  HANDLE_MEMBERS,
  TOUR_EVENT_NAMES,
  TOUR_MEMBERS,
  VIEWER_EVENTS,
  WIRE_EVENTS,
  elementEventName,
  tourElementEventName,
  wireMethods,
} from '../src/embed/delivery-contract.ts';

const BEGIN = '<!-- delivery-forms:begin -->';
const END = '<!-- delivery-forms:end -->';

const code = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(', ');

/** Every handle member that is a method a host calls (its row is no `PropertyRow`), `tour.*` and `capture.*` spelled out. */
function moduleMethods(): string[] {
  return [
    ...Object.entries(HANDLE_MEMBERS)
      .filter(([, row]) => !('property' in row))
      .map(([name]) => name),
    ...Object.keys(TOUR_MEMBERS).map((name) => `tour.${name}`),
    ...Object.keys(CAPTURE_MEMBERS).map((name) => `capture.${name}`),
  ];
}

/** The README block, built from the table. */
function deliveryBlock(): string {
  const tourEvents = TOUR_EVENT_NAMES.map((name) => `tour.${name}`);
  return [
    BEGIN,
    '| Form | Methods | Events |',
    '|---|---|---|',
    `| ES module (\`mountViewer\`) | ${code(moduleMethods())} | ${code([...Object.keys(VIEWER_EVENTS), ...tourEvents])} |`,
    `| Custom element (\`<jeex-viewer>\`) | the same handle, as \`element.viewer\` | ${code([
      ...ELEMENT_EVENTS.map((name) => elementEventName(name)),
      ...TOUR_EVENT_NAMES.map((name) => tourElementEventName(name)),
    ])} |`,
    `| iframe (\`embedViewer\`) | ${code(wireMethods())} | ${code([...WIRE_EVENTS, ...TOUR_EVENT_NAMES, 'size', 'disposed'])} |`,
    END,
  ].join('\n');
}

describe('the README names what each delivery form carries', () => {
  test('its block is the delivery table, exactly', () => {
    const readme = readFileSync('README.md', 'utf8');
    const start = readme.indexOf(BEGIN);
    const end = readme.indexOf(END);
    expect({ start: start >= 0, end: end > start }).toEqual({ start: true, end: true });
    expect(readme.slice(start, end + END.length)).toBe(deliveryBlock());
  });
});

/**
 * The one table of what each delivery form carries.
 *
 * Exhaustiveness is a COMPILE-TIME property (`tsc --noEmit` runs over this
 * file): each `@ts-expect-error` below is a table with one row taken out, and
 * the build fails if that table still type-checks. The runtime tests read the
 * lists the forms are built from and prove they say what the table says.
 */

import { describe, expect, test } from 'bun:test';
import {
  CAPTURE_MEMBERS,
  ELEMENT_EVENTS,
  HANDLE_MEMBERS,
  TOUR_EVENTS,
  TOUR_MEMBERS,
  VIEWER_EVENTS,
  WIRE_EVENTS,
  WIRE_ONLY_METHODS,
  elementEventName,
  wireMethods,
  type CaptureMemberTable,
  type HandleMemberTable,
  type TourMemberTable,
  type ViewerEventTable,
} from './delivery-contract.js';
import { METHOD_LIST } from './protocol.js';

describe('the table is exhaustive', () => {
  test('a handle member, a tour member, a capture member or an event without a row does not compile', () => {
    const { dispose: _dispose, ...noDispose } = HANDLE_MEMBERS;
    // @ts-expect-error a handle member without a row
    noDispose satisfies HandleMemberTable;
    const { play: _play, ...noPlay } = TOUR_MEMBERS;
    // @ts-expect-error a tour member without a row
    noPlay satisfies TourMemberTable;
    const { still: _still, ...noStill } = CAPTURE_MEMBERS;
    // @ts-expect-error a capture member without a row
    noStill satisfies CaptureMemberTable;
    const { walkCamera: _walkCamera, ...noWalkCamera } = VIEWER_EVENTS;
    // @ts-expect-error an event without a row
    noWalkCamera satisfies ViewerEventTable;
    // The complete tables do compile, so the errors above are about the missing row and nothing else.
    expect([HANDLE_MEMBERS, TOUR_MEMBERS, CAPTURE_MEMBERS, VIEWER_EVENTS].every((table) => Object.keys(table).length > 0)).toBe(true);
  });
});

describe('the wire', () => {
  test('its method list is exactly the rows the table puts on the wire, and nothing else', () => {
    expect([...wireMethods()].sort()).toEqual([...METHOD_LIST].sort());
    expect(Object.keys(WIRE_ONLY_METHODS)).toEqual(['context']);
  });

  test('no editing member is on the wire', () => {
    for (const member of ['addCheckpoint', 'setAssetMoveTool', 'setPlanTool', 'mirrorAsset', 'turnAsset', 'revertPlanEdit'] as const) {
      expect({ member, row: HANDLE_MEMBERS[member] }).toEqual({ member, row: { wire: false } });
    }
  });

  test('carries the events a published tour raises, and no authoring event', () => {
    expect<string[]>([...WIRE_EVENTS].sort()).toEqual(['assets', 'error', 'lightTemperature', 'mode', 'ready', 'scene', 'select'].sort());
    expect(Object.keys(TOUR_EVENTS)).toEqual(['progress', 'state', 'ended']);
  });
});

describe('the element', () => {
  test('re-emits every handle event as a DOM event', () => {
    expect<string[]>([...ELEMENT_EVENTS].sort()).toEqual(Object.keys(VIEWER_EVENTS).sort());
  });

  test('names each DOM event after the handle event, in kebab case', () => {
    expect(elementEventName('ready')).toBe('jeex-ready');
    expect(elementEventName('lightTemperature')).toBe('jeex-light-temperature');
    expect(elementEventName('walkCamera')).toBe('jeex-walk-camera');
    expect(elementEventName('checkpointLookThrough')).toBe('jeex-checkpoint-look-through');
  });
});

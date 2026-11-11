/**
 * The plates an unengaged viewer shows: the wheel's «Ctrl + scroll to zoom»,
 * raised on every wheel, and the touch plate «Tap to look around», raised
 * once per view and gone on the tap. Driven by a fake container, since the
 * unit layer has no DOM; the real page is `tests/e2e/embed-scroll*.spec.ts`.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { SCROLL_HINT_MS, SCROLL_HINT_NAME, ScrollHint, TAP_HINT_NAME } from './scroll-hint.js';
import { createMessages } from './messages.js';

type FakePlate = { dataset: Record<string, string>; attributes: Record<string, string>; textContent: string; className: string };

function fakeContainer(): { container: HTMLElement; plates: FakePlate[] } {
  const plates: FakePlate[] = [];
  const ownerDocument = {
    createElement: (): unknown => {
      const plate = {
        dataset: {},
        attributes: {} as Record<string, string>,
        textContent: '',
        className: '',
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        remove() {
          plates.splice(plates.indexOf(plate), 1);
        },
      };
      return plate;
    },
  };
  const container = { ownerDocument, appendChild: (plate: FakePlate) => plates.push(plate) };
  return { container: container as unknown as HTMLElement, plates };
}

const hints: ScrollHint[] = [];
afterEach(() => {
  for (const hint of hints.splice(0)) hint.dispose();
});

function tapHint(): { hint: ScrollHint; plate: FakePlate } {
  const { container, plates } = fakeContainer();
  const hint = new ScrollHint({ container, messages: createMessages('en'), key: 'hint.tapToLook', name: TAP_HINT_NAME, once: true });
  hints.push(hint);
  return { hint, plate: plates[0]! };
}

describe('the touch plate', () => {
  test('says «Tap to look around», under its own name, and takes nothing from assistive technology', () => {
    const { plate } = tapHint();
    expect(plate.textContent).toBe('Tap to look around');
    expect(plate.dataset['jeex']).toBe(TAP_HINT_NAME);
    expect(plate.dataset['i18n']).toBe('hint.tapToLook');
    expect(plate.attributes['aria-hidden']).toBe('true');
    expect(plate.dataset['visible']).toBe('false');
  });

  test('a swipe raises it and the tap takes it away', () => {
    const { hint } = tapHint();
    hint.show();
    expect(hint.visible).toBe(true);
    hint.hide();
    expect(hint.visible).toBe(false);
  });

  test('it shows once per view: after it went, a later swipe raises nothing', async () => {
    const { hint } = tapHint();
    hint.show();
    hint.hide();
    hint.show();
    expect(hint.visible).toBe(false);
    const timed = tapHint().hint;
    timed.show();
    await Bun.sleep(SCROLL_HINT_MS + 50);
    expect(timed.visible).toBe(false);
    timed.show();
    expect(timed.visible).toBe(false);
  });

  test('it goes after the same moment the wheel plate does', async () => {
    const { hint } = tapHint();
    hint.show();
    await Bun.sleep(SCROLL_HINT_MS - 300);
    expect(hint.visible).toBe(true);
    await Bun.sleep(400);
    expect(hint.visible).toBe(false);
  });
});

describe('the wheel plate', () => {
  test('comes back on every wheel', () => {
    const { container, plates } = fakeContainer();
    const hint = new ScrollHint({ container, messages: createMessages('en'), apple: false });
    hints.push(hint);
    expect(plates[0]!.dataset['jeex']).toBe(SCROLL_HINT_NAME);
    expect(plates[0]!.textContent).toBe('Use Ctrl + scroll to zoom');
    hint.show();
    hint.hide();
    hint.show();
    expect(hint.visible).toBe(true);
  });
});

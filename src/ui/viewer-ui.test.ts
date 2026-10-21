/**
 * Contract tests for the one swatch factory of `ViewerUI`.
 *
 * Bun has no DOM, so `document.createElement` is stubbed with a recorder that
 * keeps exactly the properties the factory writes, and passed to `swatch` as
 * its `document` parameter — `swatch` takes it rather than reading the
 * global, so there is nothing here to install onto `globalThis`. That is
 * enough to pin what the rest of the system depends on: the `data-*` hooks
 * `browser-check.ts` selects on, the `is-active` ring, and the rule that the
 * preview image carries no text and the name lives in a separate label
 * element.
 */

import { describe, expect, test } from 'bun:test';
import { swatch, type PanelItem } from './viewer-ui.js';
import { OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { DEMO } from '../demo/demo-ids.js';
import { FINISH } from '../materials/finish-ids.js';

type FakeElement = {
  tagName: string;
  className: string;
  title: string;
  type: string;
  src: string;
  alt: string;
  textContent: string;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  style: Record<string, string>;
  children: FakeElement[];
  listeners: Map<string, Array<() => void>>;
  appendChild(child: FakeElement): FakeElement;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: () => void): void;
  click(): void;
};

function fakeElement(tagName: string): FakeElement {
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    className: '',
    title: '',
    type: '',
    src: '',
    alt: '',
    textContent: '',
    dataset: {},
    attributes: {},
    style: {},
    children: [],
    listeners: new Map(),
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      element.attributes[name] = value;
    },
    addEventListener(type, handler) {
      const list = element.listeners.get(type) ?? [];
      list.push(handler);
      element.listeners.set(type, list);
    },
    click() {
      for (const handler of element.listeners.get('click') ?? []) handler();
    },
  };
  return element;
}

// `swatch` takes `Pick<Document, 'createElement'>`, kept strict for the real
// caller; the one cast here tells TypeScript once, at the DOM-less boundary,
// that this recorder stands in for a real document.
const fakeDocument = { createElement: (tag: string) => fakeElement(tag) } as unknown as Pick<Document, 'createElement'>;

function make(overrides: Partial<PanelItem> = {}): PanelItem {
  return {
    id: FINISH.oak,
    label: 'Natural oak',
    thumbnail: 'data:image/png;base64,AAAA',
    active: false,
    dataset: { finish: FINISH.oak },
    ...overrides,
  };
}

/** The factory returns a real `HTMLButtonElement` in the browser; here it is the recorder. */
function build(
  item: PanelItem,
  kind: 'finish' | 'furniture' | 'opening' | 'interior',
  onPick: (id: string) => void = () => {},
): FakeElement {
  return swatch(item, kind, onPick, fakeDocument) as unknown as FakeElement;
}

/**
 * The two children `swatch` always builds: the preview (image or chip) and the
 * name label. Destructuring the child list directly would hand the assertions
 * `FakeElement | undefined`; failing here instead names the real problem — a
 * swatch that did not build both parts — at the line that caused it.
 */
function parts(button: FakeElement): { thumb: FakeElement; label: FakeElement } {
  const [thumb, label] = button.children;
  if (!thumb || !label) throw new Error(`swatch built ${button.children.length} children, expected 2`);
  return { thumb, label };
}

describe('swatch markup', () => {
  test('a finish swatch carries data-finish, the thumb image and a separate label', () => {
    const button = build(make(), 'finish');
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.className).toBe('finish-swatch');
    expect(button.dataset['finish']).toBe(FINISH.oak);
    expect(button.dataset['variant']).toBeUndefined();
    expect(button.title).toBe('Natural oak');
    const { thumb, label } = parts(button);
    expect(thumb.tagName).toBe('IMG');
    expect(thumb.className).toBe('swatch-thumb');
    expect(thumb.src).toBe('data:image/png;base64,AAAA');
    expect(label.tagName).toBe('SPAN');
    expect(label.className).toBe('swatch-label');
    expect(label.textContent).toBe('Natural oak');
  });

  test('a variant swatch carries data-variant and the variant class names', () => {
    const button = build(
      make({ id: VARIANT.bed_platform, label: 'Platform bed', dataset: { variant: VARIANT.bed_platform } }),
      'furniture',
    );
    expect(button.dataset['variant']).toBe(VARIANT.bed_platform);
    expect(button.dataset['finish']).toBeUndefined();
    const { thumb, label } = parts(button);
    expect(thumb.className).toBe('variant-thumb');
    expect(label.className).toBe('variant-label');
    expect(label.textContent).toBe('Platform bed');
  });

  test('opening variants use the same variant styling as furniture', () => {
    const button = build(
      make({
        id: OPENING_VARIANT.window_oak_vertical,
        label: 'Oak window',
        dataset: { variant: OPENING_VARIANT.window_oak_vertical },
      }),
      'opening',
    );
    const { thumb, label } = parts(button);
    expect(thumb.className).toBe('variant-thumb');
    expect(label.className).toBe('variant-label');
  });

  test('the active item, and only it, gets the ring class', () => {
    expect(build(make({ active: true }), 'finish').className).toBe('finish-swatch is-active');
    expect(build(make({ active: false }), 'finish').className).toBe('finish-swatch');
  });
});

describe('no text inside the preview', () => {
  test('the preview image has empty alt text, no text content and no children', () => {
    const { thumb, label } = parts(build(make(), 'finish'));
    expect(thumb.alt).toBe('');
    expect(thumb.textContent).toBe('');
    expect(thumb.children).toHaveLength(0);
    // The name is drawn by the DOM, in its own element, never into the image.
    expect(label.textContent).toBe('Natural oak');
  });

  test('the fallback chip is a bare background, with the name still outside it', () => {
    const button = build(
      make({ thumbnail: null, background: 'linear-gradient(135deg, #aaa 50%, #bbb 50%)', dataset: { variant: VARIANT.bed_platform } }),
      'furniture',
    );
    const { thumb: chip, label } = parts(button);
    expect(chip.tagName).toBe('DIV');
    expect(chip.className).toBe('variant-thumb variant-chip');
    expect(chip.style['background']).toBe('linear-gradient(135deg, #aaa 50%, #bbb 50%)');
    expect(chip.textContent).toBe('');
    expect(label.textContent).toBe('Natural oak');
  });

  test('a finish fallback keeps the plain swatch-thumb class', () => {
    const button = build(make({ thumbnail: null, background: '#c8b89a' }), 'finish');
    const { thumb } = parts(button);
    expect(thumb.className).toBe('swatch-thumb');
    expect(thumb.style['background']).toBe('#c8b89a');
  });
});

describe('picking', () => {
  test('a click reports the item id once', () => {
    const picked: string[] = [];
    const button = build(make({ id: FINISH.sage }), 'finish', (id) => picked.push(id));
    button.click();
    expect(picked).toEqual([FINISH.sage]);
  });
});

describe('the interior-preset kind', () => {
  test('gets the flat chip styling, a data-preset hook and a separate name label', () => {
    const button = build(
      make({ id: DEMO.preset.sageGraphite, label: 'Sage and graphite', dataset: { preset: DEMO.preset.sageGraphite } }),
      'interior',
    );
    expect(button.dataset['preset']).toBe(DEMO.preset.sageGraphite);
    const { thumb, label } = parts(button);
    expect(thumb.tagName).toBe('IMG');
    expect(thumb.className).toBe('swatch-thumb');
    // Nothing readable inside the preview.
    expect(thumb.textContent).toBe('');
    expect(thumb.alt).toBe('');
    expect(label.className).toBe('swatch-label');
    expect(label.textContent).toBe('Sage and graphite');
  });

  test('the active preset is pressed, an inactive one is not', () => {
    expect(build(make({ active: true, dataset: { preset: DEMO.preset.oakSand } }), 'interior').attributes['aria-pressed']).toBe('true');
    expect(build(make({ active: false, dataset: { preset: DEMO.preset.oakSand } }), 'interior').attributes['aria-pressed']).toBe('false');
  });
});

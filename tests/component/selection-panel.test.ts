/**
 * The panel that every swatch grid in the viewer goes through: open, pick,
 * close.
 *
 * `panel-requests.test.ts` (bun) builds the REQUESTS; nothing until now built
 * the panel that renders them, because rendering one means a real
 * `replaceChildren`, a real `getBoundingClientRect` for the anchor clamp, and a
 * real click on a real button.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SelectionPanel, swatch, type PanelItem, type PanelRequest } from '../../src/ui/selection-panel.js';
import { VARIANT } from '../../src/assets/catalogue-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import { closeContainers, openShell, type Shell } from './support.js';

/** Walls a request's `panelData` names, by fixed UUID v7. */
const WALL = { first: '01a12ffa-de5c-7a82-88c2-b5c0b0efce6e', second: '01a12ffa-de5d-7475-9594-84630487d831' } as const;

const ITEMS: PanelItem[] = [
  { id: FINISH.oak, label: 'Oak', thumbnail: null, background: '#c8a06a', active: true, dataset: { finish: FINISH.oak } },
  { id: FINISH.ash, label: 'Ash', thumbnail: null, background: '#ded6c8', active: false, dataset: { finish: FINISH.ash } },
  { id: FINISH.walnut, label: 'Walnut', thumbnail: null, background: '#6a4a32', active: false, dataset: { finish: FINISH.walnut } },
];

type Harness = { shell: Shell; panel: SelectionPanel; onInteraction: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> };

function build(): Harness {
  const shell = openShell();
  shell.roots.byName('viewer-ui').classList.remove('is-hidden');
  const onInteraction = vi.fn();
  const onClose = vi.fn();
  const panel = new SelectionPanel({ roots: shell.roots, viewport: shell.roots.viewport, onInteraction, onClose });
  panel.bind();
  return { shell, panel, onInteraction, onClose };
}

function request(overrides: Partial<PanelRequest> = {}): PanelRequest {
  return {
    kind: 'finish',
    title: 'Wall finish',
    items: ITEMS,
    anchor: { x: 300, y: 200 },
    onPick: vi.fn(),
    ...overrides,
  };
}

let harness: Harness;

beforeEach(() => {
  harness = build();
});

afterEach(() => {
  closeContainers();
});

describe('opening', () => {
  test('renders one swatch button per item, in order, with its data attributes', () => {
    harness.panel.open(request());
    const buttons = [...harness.shell.roots.byName('finish-swatches').querySelectorAll<HTMLButtonElement>('.finish-swatch')];
    expect(buttons.map((button) => button.dataset['finish'])).toEqual([FINISH.oak, FINISH.ash, FINISH.walnut]);
    expect(buttons.map((button) => button.title)).toEqual(['Oak', 'Ash', 'Walnut']);
    expect(harness.shell.roots.byName('finish-title').textContent).toBe('Wall finish');
    expect(harness.panel.isOpen()).toBe(true);
    expect(harness.shell.roots.byName('finish-panel').classList.contains('is-hidden')).toBe(false);
  });

  test('the item name is a separate label, never text inside the preview', () => {
    harness.panel.open(request());
    const button = harness.shell.roots.byName('finish-swatches').querySelector<HTMLButtonElement>('.finish-swatch')!;
    const label = button.querySelector('.swatch-label');
    expect(label?.textContent).toBe('Oak');
    const chip = button.querySelector('.swatch-thumb');
    expect(chip?.textContent).toBe('');
  });

  test('a second open replaces the previous grid rather than appending to it', () => {
    harness.panel.open(request());
    harness.panel.open(request({ items: [ITEMS[0]!], title: 'Floor finish' }));
    expect(harness.shell.roots.byName('finish-swatches').querySelectorAll('.finish-swatch').length).toBe(1);
    expect(harness.shell.roots.byName('finish-title').textContent).toBe('Floor finish');
  });

  test('panelData is stamped on the panel and cleared by the next open, but the shell name survives', () => {
    const panelElement = harness.shell.roots.byName('finish-panel');
    harness.panel.open(request({ panelData: { wall: WALL.first, side: 'a' } }));
    expect(panelElement.dataset['wall']).toBe(WALL.first);
    expect(panelElement.dataset['side']).toBe('a');
    harness.panel.open(request({ panelData: { wall: WALL.second } }));
    expect(panelElement.dataset['wall']).toBe(WALL.second);
    expect(panelElement.dataset['side']).toBeUndefined();
    // The shell name is how everything addresses this node; clearing it would
    // lose the only handle on the panel.
    expect(panelElement.dataset['jeex']).toBe('finish-panel');
    expect(panelElement.dataset['kind']).toBe('finish');
  });

  test('the anchor is clamped inside the viewport, never negative', () => {
    const panelElement = harness.shell.roots.byName('finish-panel');
    harness.panel.open(request({ anchor: { x: -5000, y: -5000 } }));
    expect(Number(panelElement.style.left.replace('px', ''))).toBeGreaterThanOrEqual(12);
    expect(Number(panelElement.style.top.replace('px', ''))).toBeGreaterThanOrEqual(64);
    harness.panel.open(request({ anchor: { x: 99_999, y: 99_999 } }));
    const rect = harness.shell.roots.viewport.getBoundingClientRect();
    expect(Number(panelElement.style.left.replace('px', ''))).toBeLessThanOrEqual(rect.width);
    expect(Number(panelElement.style.top.replace('px', ''))).toBeLessThanOrEqual(rect.height);
  });

  test('the scope row and the footer appear only when the request carries them', () => {
    harness.panel.open(request());
    expect(harness.shell.roots.byName('finish-scope').classList.contains('is-hidden')).toBe(true);
    expect(harness.shell.roots.byName('finish-all').classList.contains('is-hidden')).toBe(true);

    const onClick = vi.fn();
    harness.panel.open(
      request({
        scope: { label: 'Only this wall', checked: true },
        footer: { label: 'Apply everywhere', onClick },
      }),
    );
    expect(harness.shell.roots.byName('finish-scope').classList.contains('is-hidden')).toBe(false);
    expect(harness.shell.roots.byName('finish-scope-label').textContent).toBe('Only this wall');
    expect(harness.panel.scopeChecked()).toBe(true);
    const footer = harness.shell.roots.byName<HTMLButtonElement>('finish-all');
    expect(footer.classList.contains('is-hidden')).toBe(false);
    footer.click();
    expect(onClick).toHaveBeenCalledWith({ activeId: FINISH.oak, scopeChecked: true });
  });

  test('a scoped tick never leaks into the next panel', () => {
    harness.panel.open(request({ scope: { label: 'Only this wall', checked: true } }));
    expect(harness.panel.scopeChecked()).toBe(true);
    harness.panel.open(request());
    expect(harness.panel.scopeChecked()).toBe(false);
  });
});

describe('picking', () => {
  test('a click reports the id and the scope, and moves the active ring', () => {
    const onPick = vi.fn();
    harness.panel.open(request({ onPick, scope: { label: 'Only this wall', checked: true } }));
    const buttons = [...harness.shell.roots.byName('finish-swatches').querySelectorAll<HTMLButtonElement>('.finish-swatch')];
    buttons[2]!.click();
    expect(onPick).toHaveBeenCalledWith({ id: FINISH.walnut, scopeChecked: true });
    expect(buttons.map((button) => button.classList.contains('is-active'))).toEqual([false, false, true]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  test('a click after close reports nothing', () => {
    const onPick = vi.fn();
    harness.panel.open(request({ onPick }));
    const button = harness.shell.roots.byName('finish-swatches').querySelector<HTMLButtonElement>('.finish-swatch')!;
    harness.panel.close();
    button.click();
    expect(onPick).not.toHaveBeenCalled();
  });

  test('setBusy is machine-readable and accessible at once', () => {
    const panelElement = harness.shell.roots.byName('finish-panel');
    harness.panel.open(request());
    harness.panel.setBusy(true);
    expect(panelElement.dataset['busy']).toBe('true');
    expect(panelElement.getAttribute('aria-busy')).toBe('true');
    harness.panel.setBusy(false);
    expect(panelElement.dataset['busy']).toBeUndefined();
    expect(panelElement.getAttribute('aria-busy')).toBe('false');
  });
});

describe('closing', () => {
  test('the close button hides the panel and tells the owner', () => {
    harness.panel.open(request());
    harness.shell.roots.byName<HTMLButtonElement>('finish-close').click();
    expect(harness.panel.isOpen()).toBe(false);
    expect(harness.shell.roots.byName('finish-panel').classList.contains('is-hidden')).toBe(true);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
    expect(harness.shell.roots.byName('finish-panel').dataset['kind']).toBeUndefined();
  });

  test('closing an already-closed panel does not report a second close', () => {
    harness.panel.open(request());
    harness.panel.close();
    harness.panel.close();
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test('contains answers for a node inside the panel and for one outside it', () => {
    harness.panel.open(request());
    const inside = harness.shell.roots.byName('finish-swatches').querySelector('.finish-swatch')!;
    expect(harness.panel.contains(inside)).toBe(true);
    expect(harness.panel.contains(harness.shell.roots.canvas)).toBe(false);
  });
});

describe('dialog focus', () => {
  test('opening moves focus to the first control (the close button)', () => {
    harness.panel.open(request());
    expect(document.activeElement).toBe(harness.shell.roots.byName('finish-close'));
  });

  test('closing gives focus back to the element that triggered the open', () => {
    const trigger = harness.shell.roots.byName<HTMLButtonElement>('fullscreen-button');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    harness.panel.open(request());
    expect(document.activeElement).not.toBe(trigger);
    harness.panel.close();
    expect(document.activeElement).toBe(trigger);
  });

  test('closing does not throw, and leaves focus alone, when the trigger left the document', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    harness.panel.open(request());
    trigger.remove();
    expect(() => harness.panel.close()).not.toThrow();
  });

  test('re-opening on a second surface still restores focus to the ORIGINAL trigger', () => {
    const trigger = harness.shell.roots.byName<HTMLButtonElement>('furniture-button');
    trigger.focus();
    harness.panel.open(request());
    // A second pick while the panel is already up (a click on another wall):
    // the panel re-opens over itself, and the new focus-in target becomes the
    // panel's own close button, not the previous trigger.
    harness.panel.open(request({ title: 'Floor finish' }));
    harness.panel.close();
    expect(document.activeElement).toBe(trigger);
  });

  test('Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last', () => {
    harness.panel.open(
      request({
        scope: { label: 'Only this wall', checked: false },
        footer: { label: 'Apply everywhere', onClick: vi.fn() },
      }),
    );
    const panelElement = harness.shell.roots.byName('finish-panel');
    const footer = harness.shell.roots.byName<HTMLButtonElement>('finish-all');
    const close = harness.shell.roots.byName<HTMLButtonElement>('finish-close');

    footer.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panelElement.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    close.focus();
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    panelElement.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(footer);
  });

  test('a Tab in the middle of the panel is left alone (no trap interference)', () => {
    harness.panel.open(request());
    const swatches = [...harness.shell.roots.byName('finish-swatches').querySelectorAll<HTMLButtonElement>('.finish-swatch')];
    swatches[0]!.focus();
    const middle = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    harness.shell.roots.byName('finish-panel').dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
  });
});

describe('swatch', () => {
  test('an object-preview kind gets the variant classes and an image when there is a thumbnail', () => {
    const pick = vi.fn();
    const button = swatch(
      { id: VARIANT.sofa_3s_boucle, label: 'Sofa B', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', active: false, dataset: {} },
      'furniture',
      pick,
      document,
    );
    expect(button.querySelector('img.variant-thumb')).not.toBeNull();
    expect(button.querySelector('.variant-label')?.textContent).toBe('Sofa B');
    // The alt is empty on purpose: the label beside it is the accessible name.
    expect(button.querySelector('img')?.alt).toBe('');
    button.click();
    expect(pick).toHaveBeenCalledWith(VARIANT.sofa_3s_boucle);
  });

  /**
   * A picture may be an address on a catalogue service rather than a `data:`
   * URL the viewer just drew, and a request to another origin can 404, expire
   * or be blocked. The one outcome a
   * picker must never show is a broken image icon.
   */
  test('a picture that fails to load is replaced by the flat chip, not left broken', () => {
    const button = swatch(
      {
        id: VARIANT.bed_double_boucle,
        label: 'Bouclé',
        thumbnail: `https://cdn.invalid/v1/previews/${VARIANT.bed_double_boucle}/1.0.0.webp`,
        background: 'rgb(4, 5, 6)',
        active: false,
        dataset: {},
      },
      'furniture',
      vi.fn(),
      document,
    );
    const image = button.querySelector<HTMLImageElement>('img.variant-thumb')!;
    expect(image.loading).toBe('lazy');
    expect(image.decoding).toBe('async');
    // The catalogue needs no referrer to serve a public picture, and sending
    // one would tell it which pages embed the viewer.
    expect(image.referrerPolicy).toBe('no-referrer');

    image.dispatchEvent(new Event('error'));

    expect(button.querySelector('img')).toBeNull();
    const chip = button.querySelector<HTMLElement>('.variant-thumb.variant-chip')!;
    expect(chip.style.background).toBe('rgb(4, 5, 6)');
    // The label is untouched: only the picture was replaced.
    expect(button.querySelector('.variant-label')?.textContent).toBe('Bouclé');
  });

  test('a flat kind with no thumbnail gets a chip painted with its background', () => {
    const button = swatch(
      { id: FINISH.ash, label: 'Ash', thumbnail: null, background: 'rgb(1, 2, 3)', active: true, dataset: {} },
      'finish',
      vi.fn(),
      document,
    );
    const chip = button.querySelector<HTMLElement>('.swatch-thumb')!;
    expect(chip.style.background).toBe('rgb(1, 2, 3)');
    expect(button.classList.contains('is-active')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});

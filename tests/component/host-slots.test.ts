/**
 * The slot boxes in a real browser: which nodes exist, what the stylesheet
 * actually computes for them, and what the anchor publishes.
 *
 * None of it can be asserted under `bun test`: every claim here is a
 * `getComputedStyle` reading of the component stylesheet, which only exists
 * once a document has adopted it (`viewer-shell.ensureViewerStyles`).
 *
 * The last block makes the same claims through the PUBLIC surface —
 * `mountViewer({ slots })` and `handle.slots` — on the real object graph over
 * the demo apartment.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { HostSlots, MissingSlotError, SLOT_ATTRIBUTE, type SlotName } from '../../src/ui/host-slots.js';
import { InlineSceneRepository, mountViewer, optionsFromQuery } from '../../src/app/viewer-api.js';
import { TYPING_SELECTOR } from '../../src/camera/camera-input.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import { userEvent } from 'vitest/browser';
import type { SceneData } from '../../src/scene/types.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import {
  SETTLE_FRAMES,
  closeContainers,
  demoScene,
  fillSlot,
  intersects,
  nextFrame,
  openContainer,
  openShell,
  until,
  untilFrames,
  type Shell,
} from './support.js';

let shell: Shell;
const handles: ViewerHandle[] = [];

/** What a case may shrink: the scene and the container it renders into. */
type MountFixture = { readonly scene?: SceneData; readonly width?: number; readonly height?: number };

/**
 * A mounted viewer over the demo apartment, with whatever slots the case
 * wants; a case that only needs SOME room to render may name a smaller scene
 * and container (see the typing case below for why that matters).
 *
 * `tour.mode: 'off'` and `debug: false` for the reasons `viewer-api.test.ts`
 * gives: an autoplaying clip moves the camera under every assertion, and the
 * debug globals are one per page.
 */
function mount(
  slots: readonly SlotName[],
  { scene = demoScene(), width, height }: MountFixture = {},
): { container: HTMLElement; handle: ViewerHandle } {
  const container = openContainer(width, height);
  const handle = mountViewer(container, {
    scene: { repository: new InlineSceneRepository(scene) },
    tour: { mode: 'off' },
    debug: false,
    slots,
  });
  handles.push(handle);
  return { container, handle };
}

/** Every slot box inside a mounted container. */
function boxesIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[${SLOT_ATTRIBUTE}]`)];
}

/**
 * Waits until the anchor's projection holds for five consecutive rendered
 * frames, within `SETTLE_FRAMES`, and returns it: the anchor-side twin of
 * `untilCameraStill`, for a file whose several viewers rule out the debug
 * camera.
 */
async function untilAnchorStill(handle: ViewerHandle, what: string): Promise<{ x: number; y: number }> {
  let last: { x: number; y: number } | null = null;
  let held = 0;
  await untilFrames(
    () => {
      const now = handle.slots.anchorPoint();
      if (now === null) return false;
      held = last !== null && Math.hypot(now.x - last.x, now.y - last.y) < 1e-3 ? held + 1 : 0;
      last = { x: now.x, y: now.y };
      return held >= 5;
    },
    what,
    SETTLE_FRAMES,
  );
  return last!;
}

/** Ends the notice-lift observer of the shell under test (`viewer-context` hands HostSlots its own lifetime). */
let lifetime = new AbortController();

/** The boxes for `names`, built into the shell the same way `viewer-context` builds them. */
function build(names: readonly SlotName[]): HostSlots {
  return new HostSlots(shell.roots.root, names, {
    notice: shell.roots.byName('degraded-notice'),
    hint: shell.roots.byName('hint-card'),
    triggers: [shell.roots.byName('tour-bar')],
    signal: lifetime.signal,
  });
}

/** Every slot box currently in the shell, in document order. */
function boxes(): HTMLElement[] {
  return [...shell.roots.root.querySelectorAll<HTMLElement>(`[${SLOT_ATTRIBUTE}]`)];
}

type Colour = { readonly rgb: readonly [number, number, number]; readonly alpha: number; readonly lightness: number };

/**
 * A computed colour as numbers, with its relative luminance (WCAG 2.1 §1.4.3).
 *
 * Two serialisations, because the browser picks one and not the other: a plain
 * `light-dark()` colour comes back as `rgb()`/`rgba()` in 0-255, and one that
 * went through relative-colour syntax (`rgb(from … r g b / 66%)`, which is how
 * every chrome text colour is written) comes back as `color(srgb …)` in 0-1.
 * Reading the second as the first would call every text colour black.
 */
function colourOf(computed: string): Colour {
  // Any OTHER colour space would be read as sRGB and silently produce the wrong
  // luminance, which is the one failure a contrast assertion must not have.
  if (computed.startsWith('color(') && !computed.startsWith('color(srgb')) {
    throw new Error(`unexpected colour serialisation: ${computed}`);
  }
  const scale = computed.startsWith('color(') ? 255 : 1;
  const parts = (computed.match(/[\d.]+/g) ?? []).map(Number);
  const at = (index: number): number => (parts[index] ?? 0) * scale;
  const rgb: readonly [number, number, number] = [at(0), at(1), at(2)];
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return {
    rgb,
    alpha: parts[3] ?? 1,
    lightness: 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]),
  };
}

/** `front` composited over `back`, then the WCAG contrast ratio of the two. */
function contrast(front: Colour, back: Colour): number {
  const over = colourOf(
    `rgb(${front.rgb.map((value, index) => value * front.alpha + (back.rgb[index] ?? 0) * (1 - front.alpha)).join(',')})`,
  );
  const [high, low] = over.lightness > back.lightness ? [over, back] : [back, over];
  return (high.lightness + 0.05) / (low.lightness + 0.05);
}

beforeEach(() => {
  shell = openShell();
  lifetime = new AbortController();
});

afterEach(() => {
  lifetime.abort();
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

describe('what gets built', () => {
  test('a viewer nobody asked for chrome has no slot node at all', () => {
    build([]);
    expect(boxes()).toEqual([]);
  });

  test('exactly the named boxes, one div each, last in the shell', () => {
    build(['bottom-center', 'selection-anchor']);
    const built = boxes();
    expect(built.map((box) => box.dataset['jeexSlot'])).toEqual(['bottom-center', 'selection-anchor']);
    expect(built.every((box) => box.tagName === 'DIV')).toBe(true);
    // Appended after the whole shell tree, so two nodes on the same layer
    // resolve in the host's favour.
    expect(shell.roots.root.lastElementChild).toBe(built[1]!);
  });

  test('a name asked for twice is one box', () => {
    build(['top-right', 'top-right']);
    expect(boxes()).toHaveLength(1);
  });

  test('a slot that was not asked for is a coded refusal, not an empty box', () => {
    const slots = build(['bottom-center']);
    expect(() => slots.get('top-left')).toThrow(MissingSlotError);
    expect(boxes()).toHaveLength(1);
  });

  test('`get` hands back the same node every time and never touches its content', () => {
    const slots = build(['modal-root']);
    const box = slots.get('modal-root');
    box.append(document.createElement('span'));
    expect(slots.get('modal-root')).toBe(box);
    expect(slots.get('modal-root').childElementCount).toBe(1);
  });
});

describe('the CSS contract', () => {
  test('a box is an absolutely positioned flex row on layer 8, transparent to the pointer', () => {
    const slots = build(['bottom-center']);
    const style = getComputedStyle(slots.get('bottom-center'));
    expect(style.position).toBe('absolute');
    expect(style.zIndex).toBe('8');
    expect(style.pointerEvents).toBe('none');
    expect(style.display).toBe('flex');
  });

  test("a host's own child takes the pointer back", () => {
    const slots = build(['bottom-center']);
    const child = document.createElement('button');
    slots.get('bottom-center').append(child);
    expect(getComputedStyle(child).pointerEvents).toBe('auto');
  });

  test('a corner slot keeps the chrome inset the mini-map uses', () => {
    const slots = build(['top-left']);
    const style = getComputedStyle(slots.get('top-left'));
    expect(style.insetBlockStart).toBe('18px');
    expect(style.insetInlineStart).toBe('18px');
  });

  test('`--jeex-slot-inset` moves every corner at once', () => {
    const slots = build(['bottom-right']);
    shell.roots.root.style.setProperty('--jeex-slot-inset', '40px');
    const style = getComputedStyle(slots.get('bottom-right'));
    expect(style.insetBlockEnd).toBe('40px');
    expect(style.insetInlineEnd).toBe('40px');
  });

  test('`modal-root` covers the viewport one layer higher', () => {
    const slots = build(['modal-root']);
    const style = getComputedStyle(slots.get('modal-root'));
    expect(style.zIndex).toBe('9');
    expect([style.insetBlockStart, style.insetBlockEnd, style.insetInlineStart, style.insetInlineEnd]).toEqual([
      '0px',
      '0px',
      '0px',
      '0px',
    ]);
  });

  /**
   * The slot layer promise, read off the stylesheet rather than
   * restated: a host's chrome covers the viewer's own panels and the error
   * card covers the host's chrome.
   */
  test('the slot layers sit above the viewer panels and below its error card', () => {
    const slots = build(['modal-root']);
    const layerOf = (node: Element): number => Number(getComputedStyle(node).zIndex);
    const panel = shell.roots.byName('finish-panel');
    const card = shell.roots.byName('error-state');
    expect(layerOf(panel)).toBeLessThan(8);
    expect(layerOf(slots.get('modal-root'))).toBeLessThan(layerOf(card));
  });
});

/**
 * The degraded-asset notice (`viewer-shell.ts`) sits in the same bottom
 * corners a host may claim. Found from a host editor's 56px assistant button in
 * `bottom-right` painting over the notice's text: the slot box is layer 8,
 * the notice layer 5, so a host's chrome legitimately wins the pixels — the
 * notice has to step aside instead (host content must never cover a viewer
 * notice or error card).
 */
describe('the degraded notice steps aside for a claimed corner', () => {
  test('the box carries no claim flags when neither bottom corner was asked for', () => {
    build(['top-left']);
    const root = shell.roots.root;
    expect(root.dataset['jeexSlotBottomRight']).toBe('false');
    expect(root.dataset['jeexSlotBottomLeft']).toBe('false');
  });

  test('does not overlap a requested bottom-right slot box', async () => {
    const slots = build(['bottom-right']);
    fillSlot(slots.get('bottom-right'));
    // Revealed as `ViewerChrome` reveals it: under a hidden `viewer-ui` every rect is the zero rect.
    shell.roots.byName('viewer-ui').classList.remove('is-hidden');
    const notice = shell.roots.byName('degraded-notice');
    notice.classList.remove('is-hidden');
    await nextFrame();
    expect(notice.getBoundingClientRect().height).toBeGreaterThan(0);
    const overlap = intersects(notice.getBoundingClientRect(), slots.get('bottom-right').getBoundingClientRect());
    expect(overlap).toBe(false);
  });

  test('moves to the free bottom-left corner when only bottom-right is claimed', () => {
    build(['bottom-right']);
    const notice = shell.roots.byName('degraded-notice');
    const style = getComputedStyle(notice);
    expect(style.insetInlineEnd).toBe('auto');
    expect(style.insetInlineStart).not.toBe('auto');
  });

  test('keeps its own bottom-right corner when the host did not claim it', () => {
    build(['top-left']);
    const notice = shell.roots.byName('degraded-notice');
    const style = getComputedStyle(notice);
    expect(style.insetInlineEnd).not.toBe('auto');
  });

  test('stacks above the bottom band when both bottom corners are claimed, clearing both boxes', async () => {
    const slots = build(['bottom-right', 'bottom-left']);
    fillSlot(slots.get('bottom-right'));
    fillSlot(slots.get('bottom-left'));
    shell.roots.byName('viewer-ui').classList.remove('is-hidden');
    const notice = shell.roots.byName('degraded-notice');
    notice.classList.remove('is-hidden');
    await until(
      () => !intersects(notice.getBoundingClientRect(), slots.get('bottom-left').getBoundingClientRect()),
      'the notice lifted over the bottom band',
    );
    const noticeRect = notice.getBoundingClientRect();
    expect(noticeRect.height).toBeGreaterThan(0);
    expect(intersects(noticeRect, slots.get('bottom-right').getBoundingClientRect())).toBe(false);
    expect(intersects(noticeRect, slots.get('bottom-left').getBoundingClientRect())).toBe(false);
  });

  test("every rect involved stays inside the viewer's own viewport", async () => {
    const slots = build(['bottom-right', 'bottom-left']);
    fillSlot(slots.get('bottom-right'));
    fillSlot(slots.get('bottom-left'));
    shell.roots.byName('viewer-ui').classList.remove('is-hidden');
    const notice = shell.roots.byName('degraded-notice');
    notice.classList.remove('is-hidden');
    await nextFrame();
    await nextFrame();
    expect(notice.getBoundingClientRect().height).toBeGreaterThan(0);
    // "The viewport" is the mounted container, not the test runner's window —
    // a host may embed the viewer at any size, anywhere on its page.
    const viewport = shell.container.getBoundingClientRect();
    for (const rect of [
      notice.getBoundingClientRect(),
      slots.get('bottom-right').getBoundingClientRect(),
      slots.get('bottom-left').getBoundingClientRect(),
    ]) {
      expect(rect.left).toBeGreaterThanOrEqual(viewport.left);
      expect(rect.top).toBeGreaterThanOrEqual(viewport.top);
      expect(rect.right).toBeLessThanOrEqual(viewport.right);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.bottom);
    }
  });
});

/**
 * The notice's own text ran past the container's right edge in a host editor —
 * "Some demo assets are shown as plac…" clipped by the page, not by an
 * ellipsis the stylesheet asked for. A plain host box at these two sizes (the
 * check sizes: a wide desktop dev window and a narrow phone one) does not actually reproduce the overflow through Chromium's
 * own shrink-to-fit maths — the text's un-wrapped MIN-content width (its
 * longest single word) is well under either box, so the rect-containment
 * assertion below would pass with or without a fix and prove nothing on its
 * own. What DOES discriminate is the property the fix adds:
 * `.degraded-notice` gets an explicit `max-inline-size` (`styles/viewer.css`,
 * matching `.hint-card`'s own), an upper bound this stylesheet can guarantee
 * regardless of whatever the host's own layout does to the box shrink-to-fit
 * depends on — so the first assertion pins THAT, and the rect assertions stay
 * as the belt-and-braces invariant the sibling block above already keeps.
 */
describe('the degraded notice fits the check sizes', () => {
  const CHECK_SIZES = [
    { label: 'desktop 1280x800', width: 1280, height: 800 },
    { label: 'phone 390x844', width: 390, height: 844 },
  ] as const;

  for (const { label, width, height } of CHECK_SIZES) {
    test(`${label}: the notice's width is capped, and its box never crosses the container edge or the FAB corner`, () => {
      shell = openShell(width, height);
      const slots = build(['bottom-right']);
      fillSlot(slots.get('bottom-right'));
      const notice = shell.roots.byName('degraded-notice');
      // `.viewer-ui` itself starts `is-hidden` in the raw shell tree
      // (`viewer-shell.ts`, revealed only by `ViewerChrome.showLoaded()` once
      // a scene has actually loaded) — an ancestor left `display: none` makes
      // EVERY descendant's `getBoundingClientRect()` the zero rect regardless
      // of the notice's own class, so this reveals the same ancestor
      // `ViewerChrome` would before the notice can be measured at all.
      shell.roots.byName('viewer-ui').classList.remove('is-hidden');
      notice.classList.remove('is-hidden');

      // The discriminating assertion: an unbounded shrink-to-fit box computes
      // `max-inline-size: none`; the fix gives it a real cap at every size.
      expect(getComputedStyle(notice).maxInlineSize).not.toBe('none');

      const noticeRect = notice.getBoundingClientRect();
      const viewport = shell.container.getBoundingClientRect();
      expect(noticeRect.left).toBeGreaterThanOrEqual(viewport.left);
      expect(noticeRect.top).toBeGreaterThanOrEqual(viewport.top);
      expect(noticeRect.right).toBeLessThanOrEqual(viewport.right);
      expect(noticeRect.bottom).toBeLessThanOrEqual(viewport.bottom);
      // Stepped out of the host's own bottom-right FAB slot, the exact
      // overlap that was reported.
      expect(intersects(noticeRect, slots.get('bottom-right').getBoundingClientRect())).toBe(false);
    });
  }
});

/**
 * The tour bar spans the bottom edge and ends in the speed button; a claimed
 * `bottom-right` box (for example a host's 56px assistant button) sits on
 * layer 8 in the same corner. At 1440x900 the box covered the top 12px of the
 * speed button, so the bar reserves the corner's footprint in its own end
 * padding. The check sizes are a desktop window, a phone, and the narrowest
 * width the viewer supports.
 */
describe('the tour bar keeps clear of a claimed bottom-right corner', () => {
  const CHECK_SIZES = [
    { label: 'desktop 1440x900', width: 1440, height: 900 },
    { label: 'phone 390x844', width: 390, height: 844 },
    { label: 'narrow 360x640', width: 360, height: 640 },
  ] as const;

  for (const { label, width, height } of CHECK_SIZES) {
    test(`${label}: no control of the bar is under the slot box, and the track keeps a usable width`, () => {
      shell = openShell(width, height);
      const slots = build(['bottom-right']);
      fillSlot(slots.get('bottom-right'));
      shell.roots.byName('viewer-ui').classList.remove('is-hidden');
      const bar = shell.roots.byName('tour-bar');
      bar.dataset['visible'] = 'true';
      const slotRect = slots.get('bottom-right').getBoundingClientRect();
      const speed = shell.roots.byName('tour-speed').getBoundingClientRect();
      const track = shell.roots.byName('tour-track').getBoundingClientRect();
      const play = shell.roots.byName('tour-play').getBoundingClientRect();
      // Measured, not assumed: both rects are real boxes in the same corner band.
      expect(speed.width).toBeGreaterThan(0);
      expect(slotRect.width).toBe(56);
      expect(slotRect.bottom).toBeGreaterThan(speed.top);
      for (const control of [speed, track, play]) expect(intersects(control, slotRect)).toBe(false);
      expect(speed.right).toBeLessThanOrEqual(slotRect.left);
      expect(track.width).toBeGreaterThanOrEqual(120);
    });
  }

  test('without a claimed corner the bar keeps its own end padding', () => {
    shell = openShell(1440, 900);
    build(['top-left']);
    expect(getComputedStyle(shell.roots.byName('tour-bar')).paddingInlineEnd).toBe('14px');
  });
});

/**
 * A host switches the viewer's whole colour scheme with ONE
 * variable, from its own stylesheet — no `::part`, no `!important`, no
 * `:global`.
 */
describe('the theme properties the slots added', () => {
  test('`--jeex-color-scheme: light` flips `color-scheme` AND the colours that follow it', () => {
    const root = shell.roots.root;
    const dark = { scheme: getComputedStyle(root).colorScheme, colour: getComputedStyle(root).color };
    expect(dark.scheme).toBe('dark');
    // On the viewer's OWN element, which is where every one of the ten is set
    // (`viewer-shell.test.ts`'s `--jeex-accent` case): the stylesheet declares
    // each one's default on `.jeex-viewer` itself, and a declaration on the
    // element is what an inherited value cannot beat.
    root.style.setProperty('--jeex-color-scheme', 'light');
    const light = { scheme: getComputedStyle(root).colorScheme, colour: getComputedStyle(root).color };
    expect(light.scheme).toBe('light');
    // Not just the property: `light-dark()` actually resolved the other half.
    expect(light.colour).not.toBe(dark.colour);
  });

  /**
   * The mode-switcher pill on a host editor's white 2D plan: the
   * property above still read `light`, and the pill was still WHITE TEXT ON
   * WHITE PAPER. The case above asks whether the property flips; this one asks
   * what a person sees, which is the question that was never asked — and the
   * answer is two numbers a defect cannot fake, because the defect made the
   * pill's background TRANSPARENT (alpha 0) and its text INHERIT the host
   * page's foreground instead of the chrome's own.
   */
  test('the chrome pill is a dark plate with light text, and the reverse in light', () => {
    const root = shell.roots.root;
    const bar = shell.roots.byName('control-bar');
    const button = shell.roots.byName('mode-switcher').querySelector('.mode-button');
    expect(button).not.toBeNull();

    const read = () => ({
      plate: colourOf(getComputedStyle(bar).backgroundColor),
      // `button` is asserted non-null one line above.
      text: colourOf(getComputedStyle(button as Element).color),
    });

    const dark = read();
    // A plate that is not there is the defect itself, and it reads as a
    // perfectly good colour until the alpha is asked for.
    expect(dark.plate.alpha).toBeGreaterThan(0.5);
    expect(dark.plate.lightness).toBeLessThan(0.3);
    expect(dark.text.lightness).toBeGreaterThan(0.7);
    // Contrast, not just two numbers that happen to differ.
    expect(contrast(dark.text, dark.plate)).toBeGreaterThan(4.5);

    root.style.setProperty('--jeex-color-scheme', 'light');
    const light = read();
    expect(light.plate.alpha).toBeGreaterThan(0.5);
    expect(light.plate.lightness).toBeGreaterThan(0.7);
    expect(light.text.lightness).toBeLessThan(0.3);
    expect(contrast(light.text, light.plate)).toBeGreaterThan(4.5);
  });

  test('`--jeex-slot-inset` is declared with the literal it replaced', () => {
    expect(getComputedStyle(shell.roots.root).getPropertyValue('--jeex-slot-inset').trim()).toBe('18px');
  });
});

describe('the anchor', () => {
  test('starts parked: nothing to follow means nothing on screen', () => {
    const slots = build(['selection-anchor']);
    const box = slots.get('selection-anchor');
    expect(box.dataset['visible']).toBe('false');
    expect(getComputedStyle(box).display).toBe('none');
  });

  test('a visible point publishes unitless numbers and a translate in pixels', () => {
    const slots = build(['selection-anchor']);
    const box = slots.get('selection-anchor');
    slots.setAnchor({ x: 120.4, y: 40.6, visible: true });
    const style = getComputedStyle(box);
    expect(style.getPropertyValue('--jeex-anchor-x').trim()).toBe('120');
    expect(style.getPropertyValue('--jeex-anchor-y').trim()).toBe('41');
    expect(style.translate).toBe('120px 41px');
    expect(box.dataset['visible']).toBe('true');
    expect(style.display).toBe('flex');
  });

  test('a point behind the camera keeps its last numbers and goes off screen', () => {
    const slots = build(['selection-anchor']);
    const box = slots.get('selection-anchor');
    slots.setAnchor({ x: 200, y: 100, visible: true });
    slots.setAnchor({ x: 200, y: 100, visible: false });
    const style = getComputedStyle(box);
    expect(style.getPropertyValue('--jeex-anchor-x').trim()).toBe('200');
    expect(box.dataset['visible']).toBe('false');
    expect(style.display).toBe('none');
  });

  /**
   * The cache must not swallow the FIRST publication: a host reading
   * `--jeex-anchor-x` is promised a number, and the origin is a position like
   * any other.
   */
  test('a first point at the viewport origin still publishes both numbers', () => {
    const slots = build(['selection-anchor']);
    slots.setAnchor({ x: 0, y: 0, visible: true });
    const style = getComputedStyle(slots.get('selection-anchor'));
    expect(style.getPropertyValue('--jeex-anchor-x').trim()).toBe('0');
    expect(style.getPropertyValue('--jeex-anchor-y').trim()).toBe('0');
  });

  test('a non-finite coordinate parks the anchor instead of reaching CSS', () => {
    const slots = build(['selection-anchor']);
    const box = slots.get('selection-anchor');
    slots.setAnchor({ x: 50, y: 60, visible: true });
    slots.setAnchor({ x: Number.NaN, y: 60, visible: true });
    const style = getComputedStyle(box);
    expect(box.dataset['visible']).toBe('false');
    expect(style.getPropertyValue('--jeex-anchor-x').trim()).toBe('50');
  });

  test('`null` parks it', () => {
    const slots = build(['selection-anchor']);
    slots.setAnchor({ x: 10, y: 10, visible: true });
    slots.setAnchor(null);
    expect(slots.get('selection-anchor').dataset['visible']).toBe('false');
  });

  /**
   * The dirty check is the one behaviour no final-state assertion can see: a
   * regression to writing `data-visible` and the two properties on every frame
   * would leave the box looking exactly the same. A `setAttribute` spy cannot
   * see it either, because `dataset` and `style.setProperty` go through the
   * internal attribute-set algorithm — so the instrument is a MutationObserver.
   */
  test('a frame that changes nothing writes nothing to the box', () => {
    const slots = build(['selection-anchor']);
    const box = slots.get('selection-anchor');
    slots.setAnchor({ x: 120, y: 40, visible: true });
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(box, { attributes: true, attributeOldValue: true });
    // Five frames at the same rounded position: the same numbers, the same
    // visibility, and 120.2/40.1 round to what was already published.
    for (let frame = 0; frame < 5; frame += 1) slots.setAnchor({ x: 120.2, y: 40.1, visible: true });
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records.map((record) => record.attributeName)).toEqual([]);
  });

  test('...and the observer that proves it would see a frame that does change', () => {
    const slots = build(['selection-anchor']);
    const box = slots.get('selection-anchor');
    slots.setAnchor({ x: 120, y: 40, visible: true });
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(box, { attributes: true, attributeOldValue: true });
    slots.setAnchor({ x: 121, y: 40, visible: false });
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(new Set(records.map((record) => record.attributeName))).toEqual(new Set(['style', 'data-visible']));
  });

  test('a mount that did not ask for the anchor is not a crash once a frame', () => {
    const slots = build(['top-center']);
    expect(() => slots.setAnchor({ x: 1, y: 2, visible: true })).not.toThrow();
    expect(() => slots.setAnchor(null)).not.toThrow();
  });
});

describe('lifetime', () => {
  /**
   * The boxes are children of the shell, which is what makes a `dispose` here
   * unnecessary: whatever takes the shell away takes them (`viewer-context`'s
   * `release`, proved end to end by the `todo` below).
   */
  test('the boxes go when the shell goes', () => {
    build(['top-left', 'modal-root']);
    expect(boxes()).toHaveLength(2);
    shell.roots.root.remove();
    expect(shell.container.querySelectorAll(`[${SLOT_ATTRIBUTE}]`)).toHaveLength(0);
  });
});

describe('through the public surface', () => {
  /**
   * `handle.slots` is one of the members the contract says is safe the moment
   * `mountViewer` returns (`viewer-handle.ts` header): the boxes are built with
   * the SHELL, not with the document, so a host renders its chrome while the
   * first scene is still loading.
   */
  test('the boxes and `handle.slots` are there before the first scene', () => {
    const { container, handle } = mount(['bottom-center', 'modal-root']);
    expect(boxesIn(container).map((box) => box.dataset['jeexSlot'])).toEqual(['bottom-center', 'modal-root']);
    expect(handle.slots.get('bottom-center')).toBe(boxesIn(container)[0]!);
    expect(handle.slots.anchorPoint()).toBeNull();
  });

  test('a slot the mount did not ask for is a coded refusal', () => {
    const { handle } = mount(['bottom-center']);
    expect(() => handle.slots.get('top-left')).toThrow(MissingSlotError);
    try {
      handle.slots.get('top-left');
    } catch (error) {
      expect((error as MissingSlotError).code).toBe('bad-params');
    }
  });

  test('`?slots=` through the query adapter builds the same boxes', () => {
    const container = openContainer();
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      debug: false,
      ...optionsFromQuery('?slots=top-right,selection-anchor'),
    });
    handles.push(handle);
    expect(boxesIn(container).map((box) => box.dataset['jeexSlot'])).toEqual(['top-right', 'selection-anchor']);
  });

  test('`anchorTo` drives the box once a frame, and `null` parks it', async () => {
    const { container, handle } = mount(['selection-anchor']);
    await handle.ready;
    const box = boxesIn(container)[0]!;
    expect(box.dataset['visible']).toBe('false');
    handle.slots.anchorTo({ x: 0, y: 1.2, z: 0 });
    await until(() => handle.slots.anchorPoint() !== null, 'the anchor to be projected');
    const point = handle.slots.anchorPoint()!;
    const style = getComputedStyle(box);
    // The DOM says what the handle says: the same numbers, rounded, and the
    // same verdict about being on screen.
    expect(Number(style.getPropertyValue('--jeex-anchor-x'))).toBe(Math.round(point.x));
    expect(Number(style.getPropertyValue('--jeex-anchor-y'))).toBe(Math.round(point.y));
    expect(box.dataset['visible']).toBe(String(point.visible));
    handle.slots.anchorTo(null);
    expect(handle.slots.anchorPoint()).toBeNull();
    expect(box.dataset['visible']).toBe('false');
  });

  test('an entity target follows the furniture it names', async () => {
    const { container, handle } = mount(['selection-anchor']);
    await handle.ready;
    const asset = demoScene().assets?.[0];
    expect(asset).toBeDefined();
    handle.slots.anchorTo({ kind: 'furniture', id: asset!.id });
    await until(() => handle.slots.anchorPoint() !== null, 'the furniture anchor to be projected');
    expect(boxesIn(container)[0]!.dataset['visible']).toBe(String(handle.slots.anchorPoint()!.visible));
  });

  /**
   * The case the guard exists for: without it, a text field inside the
   * viewer's root would be unusable, because every `w` typed into it would
   * also walk the camera. Real typing through `userEvent`, not synthetic
   * `KeyboardEvent`s — a browser inserts no text for those, so the half of the
   * claim about `value` would be untestable.
   *
   * The camera is probed through the ANCHOR rather than the debug globals:
   * those are one per page (`viewer-globals.ts`) and this file mounts several
   * viewers. A still camera projects a fixed world point to the same pixel.
   *
   * What makes it cheap enough for a CPU-rendered runner: the viewer draws
   * every frame in 3D, and Playwright's input (each key of `userEvent`, and
   * the actionability checks of a click) waits on rendered frames, so the
   * cost of the test is frames times the cost of one, and on a software
   * rasteriser that cost is the scene and the pixel count. Hence
   * `lShapePlan`, the smallest scene that has a room to walk in, instead of
   * the demo apartment, in a 360 x 240 container (the default's aspect, so
   * the same probe stays in view); and `focus()` instead of a click, because
   * how the field got focus is not the subject. Measured on SwiftShader: 14 s
   * before, under 3 s after, against the 60 s budget of a CI runner several
   * times slower that shares the rasteriser with three other files.
   *
   * The walk entry eases on the frame clock, so the probe is read only once
   * it holds still: a reading taken mid-glide would fail the test for a
   * reason that has nothing to do with typing.
   */
  test('wwww typed in a field inside a slot: the camera is still and the field keeps it', async () => {
    const { container, handle } = mount(['bottom-center', 'selection-anchor'], { scene: lShapePlan, width: 360, height: 240 });
    await handle.ready;
    handle.setMode('walk');
    // A point in room A in front of the walk camera, off the centre line so
    // a step forward moves it on both axes. It must be ON screen: a point
    // behind the camera keeps its last numbers, and would hold still even
    // while the camera walked.
    handle.slots.anchorTo({ x: 4, y: 1.2, z: 1 });
    const before = await untilAnchorStill(handle, 'the walk entry to settle');
    expect(handle.slots.anchorPoint()!.visible).toBe(true);
    const field = document.createElement('input');
    field.type = 'text';
    handle.slots.get('bottom-center').append(field);
    field.focus();
    expect(container.ownerDocument.activeElement).toBe(field);
    await userEvent.keyboard('wwww');
    await nextFrame();
    await nextFrame();
    expect(field.value).toBe('wwww');
    const after = handle.slots.anchorPoint()!;
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  /**
   * The other half of the guard, and a real CSS engine is the only thing that
   * can judge it: `contenteditable="false"` is how a host puts a NON-editable
   * widget inside editable page content, and it must NOT read as a field.
   */
  test('a `contenteditable="false"` ancestor does not silence the camera', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('contenteditable', 'false');
    // The real predicate, over the real selector, on a real element.
    expect(wrapper.matches(TYPING_SELECTOR)).toBe(false);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(editable.matches(TYPING_SELECTOR)).toBe(true);
    // And empty / plaintext-only, the two other ON spellings, stay covered.
    const bare = document.createElement('div');
    bare.setAttribute('contenteditable', '');
    expect(bare.matches(TYPING_SELECTOR)).toBe(true);
  });

  test('`dispose()` leaves no slot box in the container', () => {
    const { container, handle } = mount(['top-left', 'modal-root']);
    expect(boxesIn(container)).toHaveLength(2);
    handle.dispose();
    expect(boxesIn(container)).toHaveLength(0);
  });
});

/**
 * The notice is lifted above whatever sits under it — a filled bottom host box
 * (left, center or right) and the viewer's own hint card — by 8 px, measured
 * live: found with a bottom-center host bar that covered it completely, and at
 * phone width with no host boxes at all, where it already lay on the hint.
 */
describe('the degraded notice clears whatever sits under it', () => {
  const GAP = 8;

  /** The notice shown the way `ViewerChrome` shows it: its `viewer-ui` ancestor revealed first (a hidden ancestor measures zero). */
  function shownNotice(): HTMLElement {
    shell.roots.byName('viewer-ui').classList.remove('is-hidden');
    const notice = shell.roots.byName('degraded-notice');
    notice.classList.remove('is-hidden');
    return notice;
  }

  const rendered = (element: HTMLElement): boolean => element.getBoundingClientRect().height > 0;

  /** Whether two rects share a horizontal span. */
  const sideBySide = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && a.right > b.left;

  /** Every rect under the notice stays `GAP` below it, and the notice stays inside the viewer. */
  function clear(notice: HTMLElement, under: readonly HTMLElement[]): boolean {
    const own = notice.getBoundingClientRect();
    const viewport = shell.container.getBoundingClientRect();
    if (own.top < viewport.top || own.bottom > viewport.bottom || own.left < viewport.left || own.right > viewport.right) return false;
    return under.every((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || !sideBySide(own, rect)) return true;
      return rect.top - own.bottom >= GAP - 0.5;
    });
  }

  function phone(): void {
    shell = openShell(390, 844);
  }

  test('a bottom-center host at 390x844', async () => {
    phone();
    const slots = build(['bottom-center']);
    fillSlot(slots.get('bottom-center'));
    const notice = shownNotice();
    const hint = shell.roots.byName('hint-card');
    expect(rendered(notice) && rendered(slots.get('bottom-center'))).toBe(true);
    await until(() => clear(notice, [slots.get('bottom-center'), hint]), 'the notice above the bottom-center box and the hint');
    expect(intersects(notice.getBoundingClientRect(), slots.get('bottom-center').getBoundingClientRect())).toBe(false);
    expect(intersects(notice.getBoundingClientRect(), hint.getBoundingClientRect())).toBe(false);
  });

  test('no host boxes at 390x844: the notice stands above the hint card', async () => {
    phone();
    build([]);
    const notice = shownNotice();
    const hint = shell.roots.byName('hint-card');
    expect(rendered(hint)).toBe(true);
    expect(sideBySide(notice.getBoundingClientRect(), hint.getBoundingClientRect())).toBe(true);
    await until(() => clear(notice, [hint]), 'the notice above the hint');
    expect(intersects(notice.getBoundingClientRect(), hint.getBoundingClientRect())).toBe(false);
  });

  test('bottom-left and bottom-right hosts at 390x844', async () => {
    phone();
    const slots = build(['bottom-left', 'bottom-right']);
    fillSlot(slots.get('bottom-left'));
    fillSlot(slots.get('bottom-right'));
    const notice = shownNotice();
    const under = [slots.get('bottom-left'), slots.get('bottom-right'), shell.roots.byName('hint-card')];
    await until(() => clear(notice, under), 'the notice above both corner boxes and the hint');
    for (const element of under) expect(intersects(notice.getBoundingClientRect(), element.getBoundingClientRect())).toBe(false);
  });

  test('nothing in the way on a desktop: the default inset, unchanged', async () => {
    build([]);
    const notice = shownNotice();
    await nextFrame();
    await nextFrame();
    const viewport = shell.container.getBoundingClientRect();
    expect(viewport.bottom - notice.getBoundingClientRect().bottom).toBeCloseTo(18, 0);
  });

  test('it follows a host box that grows, then empties', async () => {
    phone();
    const slots = build(['bottom-center']);
    const box = slots.get('bottom-center');
    fillSlot(box);
    const notice = shownNotice();
    const hint = shell.roots.byName('hint-card');
    await until(() => clear(notice, [box, hint]), 'the notice above the 56px box');
    const before = notice.getBoundingClientRect().bottom;
    (box.firstElementChild as HTMLElement).style.setProperty('block-size', '160px');
    await until(() => clear(notice, [box, hint]) && notice.getBoundingClientRect().bottom < before - 50, 'the notice above the grown box');
    box.replaceChildren();
    await until(
      () => Math.abs(hint.getBoundingClientRect().top - notice.getBoundingClientRect().bottom - GAP) < 1,
      'the notice back above the hint only',
    );
  });

  test('it follows the hint card: down when it hides, up when the tour bar lifts it', async () => {
    phone();
    build([]);
    const notice = shownNotice();
    const hint = shell.roots.byName('hint-card');
    await until(() => clear(notice, [hint]), 'the notice above the hint');
    const viewport = shell.container.getBoundingClientRect();
    hint.hidden = true;
    await until(() => Math.abs(viewport.bottom - notice.getBoundingClientRect().bottom - 18) < 1, 'the notice back at its own inset');
    hint.hidden = false;
    await until(() => clear(notice, [hint]), 'the notice above the hint again');
    const tourBar = shell.roots.byName('tour-bar');
    const resting = hint.getBoundingClientRect().top;
    tourBar.dataset['visible'] = 'true';
    await until(
      () => hint.getBoundingClientRect().top < resting - 10 && clear(notice, [hint, tourBar]),
      'the notice above the lifted hint',
    );
  });

  test('the observer ends with the viewer', async () => {
    phone();
    build([]);
    const notice = shownNotice();
    const hint = shell.roots.byName('hint-card');
    await until(() => clear(notice, [hint]), 'the notice above the hint');
    lifetime.abort();
    const lifted = shell.roots.root.style.getPropertyValue('--jeex-notice-lift');
    hint.hidden = true;
    await nextFrame();
    await nextFrame();
    expect(shell.roots.root.style.getPropertyValue('--jeex-notice-lift')).toBe(lifted);
  });
});

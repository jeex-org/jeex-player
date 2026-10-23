/**
 * `<jeex-viewer>` as a registered custom element in a real registry.
 *
 * `src/embed/element.test.ts` (bun) tests the CONTROLLER against a plain-object
 * host: attribute reading, effect classification, the mount seam. Everything
 * the element itself does — upgrade, `attachShadow`, `composed` events crossing
 * the boundary, `disconnectedCallback` — needs `customElements`, and that is
 * this file.
 */

import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { defineJeexViewer, DEFAULT_TAG, SHADOW_ATTRIBUTE, SHADOW_NONE } from '../../src/embed/element.js';
import { VIEWER_ROOT_SELECTOR } from '../../src/ui/viewer-shell.js';
import type { JeexViewerElement } from '../../src/embed/element.js';
import { closeContainers, demoScene, openContainer, until } from './support.js';

/**
 * A test that mounts the demo apartment and then builds a SECOND scene — an
 * `src` swap, or a disconnect that mounts again — does two full geometry
 * builds, not one. One demo mount costs 20-30 s on a loaded software
 * rasteriser, so two need more than the tier's 60 s light-path `testTimeout`
 * (`vitest.config.ts`): 90 s. Same class as `viewer-api.test.ts`'s own
 * constant; a test that only mounts once, or whose swap is refused before the
 * build, keeps the default.
 */
const MOUNT_PLUS_RELOAD_TIMEOUT_MS = 90_000;
/**
 * What the wait for that second build is allowed, against `until`'s shared 15 s
 * (`support.ts:100`). The shared budget stays where it is: it is right for
 * every predicate in this file that is reached AFTER the build — and those are
 * all of them but one, see `FIRST_BUILD_WAIT_MS` — and raising it to cover the
 * heaviest test would stop it constraining any of them.
 */
const SECOND_BUILD_WAIT_MS = 45_000;
/**
 * What a wait that is satisfied BY the first demo build is allowed.
 *
 * Every other test here reaches `until` only after `await element.viewer!.ready`
 * has already paid for the build, so its predicate really is light and the
 * shared 15 s fits. The `jeex-ready` test cannot do that: proving the event
 * crosses the shadow boundary onto `document` means waiting for the event
 * itself, so the build is INSIDE the budget.
 *
 * Inside the full component tier, where every page rasterises through the
 * same software path, one demo mount costs up to about 22 s, so 15 s does not
 * cover it. 45 s, the same budget a second build gets: twice that worst case,
 * and still under the 60 s `testTimeout`, so a real regression fails naming
 * the predicate rather than as a bare test timeout.
 */
const FIRST_BUILD_WAIT_MS = 45_000;

/**
 * The scene as a URL the element can be pointed at.
 *
 * A blob URL rather than a file on the dev server: the element's whole job is
 * to turn `src` into a `FetchSceneRepository`, and a blob is a real fetch with
 * no fixture to keep in step with the schema.
 */
function sceneUrl(overrides: Record<string, unknown> = {}): string {
  const blob = new Blob([JSON.stringify({ ...demoScene(), ...overrides })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}

/** The documents a src swap loads, by fixed UUID v7. */
const SCENE = {
  swapped: '01a12ffa-de5a-7fe1-81ad-658485d06e41',
  flatB: '01a12ffa-de5b-7bdd-b129-0b1806aac068',
} as const;

const urls: string[] = [];
const elements: HTMLElement[] = [];

/** A connected element with the given attributes, and the container it is in. */
function place(attributes: Record<string, string>, tag = DEFAULT_TAG): { element: JeexViewerElement; container: HTMLElement } {
  const container = openContainer();
  const element = document.createElement(tag) as JeexViewerElement;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  container.appendChild(element);
  elements.push(element);
  return { element, container };
}

/** Attributes every test wants: a scene, and no clip running under the assertions. */
function base(): Record<string, string> {
  return { src: sceneUrl(), tour: 'off' };
}

beforeAll(() => {
  defineJeexViewer();
});

afterEach(() => {
  for (const element of elements.splice(0)) {
    element.remove();
  }
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  closeContainers();
});

describe('registration and upgrade', () => {
  test('defineJeexViewer registers the tag and is idempotent', () => {
    const first = customElements.get(DEFAULT_TAG);
    expect(first).toBeDefined();
    // A page that loads the element bundle twice must not get the
    // `NotSupportedError` a second `define` would throw.
    expect(() => defineJeexViewer()).not.toThrow();
    expect(customElements.get(DEFAULT_TAG)).toBe(first);
  });

  test('an element parsed before the definition upgrades and mounts on upgrade', async () => {
    const tag = 'jeex-viewer-upgrade-probe';
    const container = openContainer();
    // In the page before anything defines the tag: an unknown element with
    // attributes already set, which is the ordering a `<script defer>` gives.
    container.innerHTML = `<${tag} tour="off" view="walk"></${tag}>`;
    const element = container.firstElementChild as JeexViewerElement;
    element.setAttribute('src', sceneUrl());
    elements.push(element);
    expect(element.viewer).toBeUndefined();

    defineJeexViewer(tag);
    await customElements.whenDefined(tag);
    // `attributeChangedCallback` runs for every present attribute BEFORE
    // `connectedCallback` on an upgrade; `connect` reads them all at once, so
    // the replay must not double the mount.
    expect(element.viewer).not.toBeNull();
    expect(element.viewer!.getMode()).toBe('walk');
    await element.viewer!.ready;
  });
});

describe('the shadow root', () => {
  test('the viewer is built inside an open shadow root, invisible to the document', async () => {
    const { element, container } = place(base());
    await element.viewer!.ready;
    expect(element.shadowRoot).not.toBeNull();
    expect(element.shadowRoot!.mode).toBe('open');
    expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).not.toBeNull();
    // The boundary is real: a document-wide lookup finds nothing.
    expect(container.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
    expect(document.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
  });

  test('the shadow root adopts the component stylesheet', async () => {
    const { element } = place(base());
    await element.viewer!.ready;
    // The component sheet and the element's own `:host` box.
    expect(element.shadowRoot!.adoptedStyleSheets.length).toBe(2);
  });

  test('shadow="none" builds in the host’s own tree instead', async () => {
    const { element } = place({ ...base(), [SHADOW_ATTRIBUTE]: SHADOW_NONE });
    await element.viewer!.ready;
    expect(element.shadowRoot).toBeNull();
    expect(element.querySelector(VIEWER_ROOT_SELECTOR)).not.toBeNull();
    // Light DOM means the sheet has to reach the document instead.
    expect(document.adoptedStyleSheets.length).toBeGreaterThan(0);
  });
});

describe('events', () => {
  test('jeex-ready is composed and bubbling, so a listener on document sees it', async () => {
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    element.setAttribute('tour', 'off');
    element.setAttribute('src', sceneUrl());
    elements.push(element);

    const seen: Array<{ composed: boolean; bubbles: boolean; detail: unknown }> = [];
    const listener = (event: Event): void => {
      seen.push({ composed: event.composed, bubbles: event.bubbles, detail: (event as CustomEvent).detail });
    };
    document.addEventListener('jeex-ready', listener);
    try {
      container.appendChild(element);
      await until(() => seen.length > 0, 'the jeex-ready event on document', FIRST_BUILD_WAIT_MS);
      expect(seen[0]!.composed).toBe(true);
      expect(seen[0]!.bubbles).toBe(true);
      expect((seen[0]!.detail as { sceneId: string }).sceneId).toBe(demoScene().id);
    } finally {
      document.removeEventListener('jeex-ready', listener);
    }
  });

  test('jeex-mode carries the new mode', async () => {
    const { element } = place(base());
    await element.viewer!.ready;
    const modes: unknown[] = [];
    element.addEventListener('jeex-mode', (event) => modes.push(event.detail));
    element.setAttribute('view', 'walk');
    // One microtask: attribute changes are collected and flushed together.
    await until(() => modes.length > 0, 'the mode event');
    expect(modes).toEqual(['walk']);
  });
});

describe('live attributes', () => {
  test('view changes the mode of the running viewer', async () => {
    const { element } = place({ ...base(), view: 'orbit' });
    await element.viewer!.ready;
    expect(element.viewer!.getMode()).toBe('orbit');
    element.setAttribute('view', 'plan2d');
    await until(() => element.viewer!.getMode() === 'plan2d', 'the plan mode');
    element.setAttribute('view', 'walk');
    await until(() => element.viewer!.getMode() === 'walk', 'the walk mode');
  });

  // Mount plus a second full scene build: the swap rebuilds the apartment.
  test(
    'a src swap loads the new scene and fires jeex-scene',
    async () => {
      const { element } = place(base());
      await element.viewer!.ready;
      const scenes: Array<{ sceneId: string }> = [];
      element.addEventListener('jeex-scene', (event) => scenes.push((event as CustomEvent).detail as { sceneId: string }));
      element.setAttribute('src', sceneUrl({ id: SCENE.swapped }));
      await until(() => scenes.some((info) => info.sceneId === SCENE.swapped), 'the swapped scene', SECOND_BUILD_WAIT_MS);
      expect(scenes.at(-1)!.sceneId).toBe(SCENE.swapped);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  test('removing src warns and leaves the scene on screen', async () => {
    const { element } = place(base());
    await element.viewer!.ready;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      element.removeAttribute('src');
      await until(() => warn.mock.calls.length > 0, 'the warning');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('the scene on screen stays');
    } finally {
      warn.mockRestore();
    }
  });

  test('a read-once attribute changed after the mount warns and changes nothing', async () => {
    const { element } = place(base());
    await element.viewer!.ready;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      element.setAttribute('minimap', 'false');
      await until(() => warn.mock.calls.length > 0, 'the warning');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('read once');
      expect(element.viewer!.options.view.minimap).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('the element’s lifetime', () => {
  test('disconnectedCallback disposes the viewer and drops the handle', async () => {
    const { element } = place(base());
    const handle = element.viewer!;
    await handle.ready;
    const canvas = element.shadowRoot!.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
    element.remove();
    expect(element.viewer).toBeNull();
    expect(element.tour).toBeNull();
    // The handle is disposed, so its commands are inert rather than throwing.
    expect(() => handle.setMode('walk')).not.toThrow();
    expect(canvas.isConnected).toBe(false);
  });

  test('a disconnected element stops emitting the viewer’s events', async () => {
    const { element } = place(base());
    const handle = element.viewer!;
    await handle.ready;
    const seen: unknown[] = [];
    element.addEventListener('jeex-mode', (event) => seen.push((event as CustomEvent).detail));
    element.remove();
    handle.setMode('walk');
    expect(seen).toEqual([]);
  });

  // Mount plus a second full scene build: the remount rebuilds from scratch.
  // Only the per-test timeout is widened — the slow step here is the second
  // `viewer.ready`, not an `until` predicate.
  test(
    'moving the element in the DOM disposes and mounts again',
    async () => {
      const { element } = place(base());
      const first = element.viewer!;
      await first.ready;
      const second = openContainer();
      second.appendChild(element);
      await until(() => element.viewer !== null, 'the remount');
      expect(element.viewer).not.toBe(first);
      await element.viewer!.ready;
      expect(element.shadowRoot!.querySelectorAll(VIEWER_ROOT_SELECTOR).length).toBe(1);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );

  test('the tour getter is the mounted viewer’s controls', async () => {
    const { element } = place(base());
    await element.viewer!.ready;
    expect(element.tour).toBe(element.viewer!.tour);
    expect(typeof element.tour!.progress).toBe('function');
  });

  test('onLog is a property, and the sink it holds catches the element’s own warnings', async () => {
    // An attribute cannot carry a function, so the sink is set on the element
    // before it is connected; the mount then inherits it as `options.onLog`.
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    const entries: Array<{ code: string; detail?: unknown }> = [];
    element.onLog = (entry) => entries.push(entry);
    for (const [name, value] of Object.entries(base())) element.setAttribute(name, value);
    container.appendChild(element);
    elements.push(element);
    await element.viewer!.ready;
    expect(element.onLog).not.toBeNull();
    expect(element.viewer!.options.onLog).toBe(element.onLog);

    // A read-once attribute changed after the mount is the one warning the
    // element raises on its own behalf.
    element.setAttribute('minimap', '0');
    await until(() => entries.length > 0, 'the read-once warning');
    expect(entries[0]?.code).toBe('attribute-read-once');
    expect(entries[0]?.detail).toEqual({ attribute: 'minimap' });
  });
});

describe('an element with no scene', () => {
  test('does not throw out of connectedCallback: it reports `no-scene-source`', async () => {
    // `mountViewer` refuses a source that names nothing, synchronously. Taken
    // straight out of the platform's own callback that exception reaches
    // nobody — the browser logs it and the page carries on with an empty tag.
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    const errors: Array<{ code: string }> = [];
    element.addEventListener('jeex-error', (event) => errors.push(event.detail));
    expect(() => container.appendChild(element)).not.toThrow();
    elements.push(element);
    // A handle, so a host can still dispose it.
    expect(element.viewer).not.toBeNull();
    await until(() => errors.length > 0, 'the error event');
    expect(errors[0]?.code).toBe('no-scene-source');
  });

  test('shows the viewer’s own error card rather than an empty box', async () => {
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    container.appendChild(element);
    elements.push(element);
    const card = (): Element | null => element.shadowRoot!.querySelector('[data-jeex="error-state"]');
    await until(() => card() !== null && !card()!.hasAttribute('hidden'), 'the error card');
    expect(card()!.textContent).toBeTruthy();
  });
});

describe('the custom states', () => {
  test('run loading then ready, and are readable with :state()', async () => {
    const { element } = place(base());
    // `matches(':state(...)')` is the same thing a host stylesheet asks.
    expect(element.matches(':state(loading)')).toBe(true);
    await element.viewer!.ready;
    await until(() => element.matches(':state(ready)'), 'the ready state');
    expect(element.matches(':state(loading)')).toBe(false);
  });

  test('a failure lands in the error state instead', async () => {
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    container.appendChild(element);
    elements.push(element);
    await until(() => element.matches(':state(error)'), 'the error state');
    expect(element.matches(':state(ready)')).toBe(false);
  });
});

describe('attribute batching', () => {
  // Mount plus a second full scene build: the batched `src` rebuilds too.
  test(
    'two attributes set in one task apply as one flush',
    async () => {
      const { element } = place(base());
      await element.viewer!.ready;
      const loads: string[] = [];
      element.addEventListener('jeex-scene', (event) => loads.push(event.detail.sceneId));
      const next = sceneUrl({ id: SCENE.flatB });
      element.setAttribute('view', 'walk');
      element.setAttribute('src', next);
      element.setAttribute('view', 'plan2d');
      // Nothing has been applied yet: the flush is a microtask away.
      expect(element.viewer!.getMode()).toBe('orbit');
      await until(() => element.viewer!.getMode() === 'plan2d', 'the batched mode');
      await until(() => loads.length > 0, 'the batched scene swap', SECOND_BUILD_WAIT_MS);
      expect(loads).toEqual([SCENE.flatB]);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );
});

describe('moving the element with moveBefore', () => {
  test('keeps the running viewer instead of rebuilding it', async () => {
    // `moveBefore` is Baseline LIMITED (no Safari), so the test asks the engine
    // whether it has it; where it does not, the ordinary disconnect/reconnect
    // path is the one already covered above.
    const { element } = place(base());
    const first = element.viewer!;
    await first.ready;
    const destination = openContainer();
    const moveBefore = (destination as { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
    if (typeof moveBefore !== 'function') return;
    moveBefore.call(destination, element, null);
    expect(element.parentElement).toBe(destination);
    // The very same handle, and the very same canvas: no flash, no re-init.
    expect(element.viewer).toBe(first);
    expect(element.shadowRoot!.querySelectorAll('canvas').length).toBeGreaterThan(0);
  });
});

describe('the `lang` attribute', () => {
  test('accepts a BCP-47 tag and uses its primary subtag', async () => {
    const { element } = place({ ...base(), lang: 'ru-RU' });
    await element.viewer!.ready;
    expect(element.viewer!.options.locale).toBe('ru');
  });

  test('setting it on the shadow host at connect time logs no attribute-read-once warning', async () => {
    // Regression: `setLang` reflects the resolved locale onto the element's
    // OWN `lang` property, which is itself an observed attribute — done
    // after `this.handle` was assigned, that write must not read back to the
    // controller as if the HOST had changed a frozen attribute post-mount.
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    const entries: Array<{ code: string }> = [];
    element.onLog = (entry) => entries.push(entry);
    for (const [name, value] of Object.entries(base())) element.setAttribute(name, value);
    container.appendChild(element);
    elements.push(element);
    await element.viewer!.ready;
    expect(element.lang).toBe('en');
    expect(entries).toEqual([]);
  });

  test('a language with no catalogue falls back to the default and says so', async () => {
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    const entries: Array<{ code: string }> = [];
    element.onLog = (entry) => entries.push(entry);
    // 'zz' has no catalogue and never will; 'de' ships one.
    for (const [name, value] of Object.entries({ ...base(), lang: 'zz-ZZ' })) element.setAttribute(name, value);
    container.appendChild(element);
    elements.push(element);
    await element.viewer!.ready;
    expect(element.viewer!.options.locale).toBe('en');
    expect(entries.map((entry) => entry.code)).toContain('locale-unknown');
  });
});

describe('the compound chrome attribute', () => {
  test('chrome="false" chrome-status="true" hides every chrome.* flag except the one after it', async () => {
    const { element } = place({ ...base(), chrome: 'false', 'chrome-status': 'true' });
    await element.viewer!.ready;
    expect(element.viewer!.options.chrome).toEqual({
      brand: false,
      controls: false,
      status: true,
      modeSwitcher: false,
      hint: false,
      autoHide: true,
    });
    const root = element.shadowRoot!;
    const hidden = (name: string): boolean => (root.querySelector(`[data-jeex="${name}"]`) as HTMLElement).hidden === true;
    expect(hidden('brand-lockup')).toBe(true);
    expect(hidden('control-bar')).toBe(true);
    expect(hidden('hint-card')).toBe(true);
    expect(hidden('mode-switcher')).toBe(true);
  });

  test('chrome="true" is a no-op: the individual attributes decide everything', async () => {
    const { element } = place({ ...base(), chrome: 'true', brand: 'false' });
    await element.viewer!.ready;
    expect(element.viewer!.options.chrome).toEqual({
      brand: false,
      controls: true,
      status: true,
      modeSwitcher: true,
      hint: true,
      autoHide: true,
    });
  });

  test('an unrecognised compound value reaches the element’s own onLog, not the console', async () => {
    const container = openContainer();
    // No cast: `HTMLElementTagNameMap` types `createElement('jeex-viewer')` itself.
    const element = document.createElement(DEFAULT_TAG);
    const entries: Array<{ code: string }> = [];
    element.onLog = (entry) => entries.push(entry);
    for (const [name, value] of Object.entries({ ...base(), chrome: 'sideways' })) element.setAttribute(name, value);
    container.appendChild(element);
    elements.push(element);
    await element.viewer!.ready;
    expect(entries.map((entry) => entry.code)).toContain('option-invalid');
    // Ignored, not applied: every chrome flag stays at its default.
    expect(element.viewer!.options.chrome).toEqual({
      brand: true,
      controls: true,
      status: true,
      modeSwitcher: true,
      hint: true,
      autoHide: true,
    });
  });
});

describe('a pasted tag', () => {
  const blocks: HTMLElement[] = [];

  /** An element in a plain block with a width and NO height: what a CMS gives a pasted tag. */
  function pasted(attributes: Record<string, string>, style = ''): JeexViewerElement {
    const block = document.createElement('div');
    block.style.cssText = 'width:640px';
    document.body.appendChild(block);
    blocks.push(block);
    const element = document.createElement(DEFAULT_TAG);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (style) element.style.cssText = style;
    block.appendChild(element);
    elements.push(element);
    return element;
  }

  afterEach(() => {
    for (const block of blocks.splice(0)) block.remove();
  });

  test('a bare tag is a block at the full width and 16:9 of it, never 0 px tall', async () => {
    const element = pasted(base());
    await element.viewer!.ready;
    const box = element.getBoundingClientRect();
    expect(getComputedStyle(element).display).toBe('block');
    expect(box.width).toBe(640);
    expect(box.height).toBe(360);
    // The viewer fills that box.
    const viewer = element.shadowRoot!.querySelector<HTMLElement>(VIEWER_ROOT_SELECTOR)!;
    expect(Math.round(viewer.getBoundingClientRect().height)).toBe(360);
  });

  test('`ratio` names the box, live', async () => {
    const element = pasted({ ...base(), ratio: '4:3' });
    await element.viewer!.ready;
    expect(element.getBoundingClientRect().height).toBe(480);
    element.setAttribute('ratio', '1');
    await until(() => element.getBoundingClientRect().height === 640, 'the box to follow ratio="1"');
  });

  test('the host page’s own height wins over the default ratio', async () => {
    const element = pasted(base(), 'height:200px');
    await element.viewer!.ready;
    expect(element.getBoundingClientRect().height).toBe(200);
    expect(element.getBoundingClientRect().width).toBe(640);
  });

  test('the host page’s own aspect-ratio and width win too', async () => {
    const element = pasted(base(), 'aspect-ratio:2 / 1;width:400px');
    await element.viewer!.ready;
    expect(element.getBoundingClientRect().width).toBe(400);
    expect(element.getBoundingClientRect().height).toBe(200);
  });

  test('is read-only for visitors unless the page opts in with readonly="0"', async () => {
    const visitor = pasted(base());
    await visitor.viewer!.ready;
    expect(visitor.viewer!.options.readonly).toBe(true);
    const author = pasted({ ...base(), readonly: '0' });
    await author.viewer!.ready;
    expect(author.viewer!.options.readonly).toBe(false);
  });
});

describe('the unbranded overlay flag', () => {
  test('<jeex-viewer unbranded> applies the same chrome as overlay="unbranded"', async () => {
    const { element } = place({ ...base(), unbranded: '' });
    await element.viewer!.ready;
    expect(element.viewer!.options.chrome).toEqual({
      brand: false,
      controls: true,
      status: false,
      modeSwitcher: false,
      hint: false,
      autoHide: true,
    });
    expect(element.viewer!.options.interaction).toBe('full');
    const root = element.shadowRoot!;
    const hidden = (name: string): boolean => (root.querySelector(`[data-jeex="${name}"]`) as HTMLElement).hidden === true;
    expect(hidden('brand-lockup')).toBe(true);
    expect(hidden('mode-switcher')).toBe(true);
    expect(hidden('control-bar')).toBe(false);
  });

  test('an explicit overlay attribute wins over unbranded', async () => {
    const { element } = place({ ...base(), unbranded: '', overlay: 'kiosk' });
    await element.viewer!.ready;
    expect(element.viewer!.options.chrome.controls).toBe(false);
    expect(element.viewer!.options.interaction).toBe('none');
  });
});

/**
 * Every distinct WebGL context the page creates from now on, for the start
 * tests: the probe and three each call `getContext`, and both calls answer the
 * same context, so the CONTEXTS are counted, not the calls.
 */
function watchContexts(): { contexts: Set<unknown>; restore: () => void } {
  const contexts = new Set<unknown>();
  const prototype = HTMLCanvasElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext')!;
  const original = descriptor.value as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
  Object.defineProperty(prototype, 'getContext', {
    ...descriptor,
    value(this: HTMLCanvasElement, ...args: unknown[]) {
      const context = original.apply(this, args);
      if (context !== null && (args[0] === 'webgl2' || args[0] === 'webgl')) contexts.add(context);
      return context;
    },
  });
  return { contexts, restore: () => Object.defineProperty(prototype, 'getContext', descriptor) };
}

/** A container far below the viewport, out of reach of the start margin. */
function belowTheFold(): HTMLElement {
  const container = openContainer();
  container.style.setProperty('margin-block-start', `${window.innerHeight + 2000}px`);
  return container;
}

function placeIn(container: HTMLElement, attributes: Record<string, string>): JeexViewerElement {
  const element = document.createElement(DEFAULT_TAG);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  container.appendChild(element);
  elements.push(element);
  return element;
}

/** Two rendered frames: an observer that was going to report has reported by then. */
async function twoFrames(): Promise<void> {
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
  }
}

describe('the deferred start', () => {
  test('a below-the-fold element keeps its box, builds nothing and makes no context until it is scrolled near', async () => {
    const watched = watchContexts();
    try {
      const container = belowTheFold();
      const element = placeIn(container, base());
      await twoFrames();
      expect(element.shadowRoot).not.toBeNull();
      expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
      expect(element.getBoundingClientRect().height).toBeCloseTo((element.getBoundingClientRect().width * 9) / 16, 0);
      expect(element.matches(':state(loading)')).toBe(true);
      expect(watched.contexts.size).toBe(0);
      // The handle is there from the connect on.
      expect(element.viewer).not.toBeNull();

      const box = element.getBoundingClientRect();
      container.scrollIntoView();
      await element.viewer!.ready;
      expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).not.toBeNull();
      // The box did not move under the viewer: same size before and after the start.
      expect(element.getBoundingClientRect().width).toBe(box.width);
      expect(element.getBoundingClientRect().height).toBe(box.height);
      // One context for the viewer: the probe's, taken over by the renderer.
      expect(watched.contexts.size).toBe(1);
    } finally {
      watched.restore();
      window.scrollTo(0, 0);
    }
  });

  test('a press on a below-the-fold element starts it without a scroll', async () => {
    const element = placeIn(belowTheFold(), base());
    await twoFrames();
    expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await element.viewer!.ready;
    expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).not.toBeNull();
  });

  test('commands given before the start are applied once it runs', async () => {
    const container = belowTheFold();
    const element = placeIn(container, base());
    const atReady: Array<{ mode: string; scene: boolean }> = [];
    const atScene: boolean[] = [];
    element.addEventListener('jeex-scene', () => atScene.push(element.viewer!.getScene() !== null), { once: true });
    element.addEventListener(
      'jeex-ready',
      () => atReady.push({ mode: element.viewer!.getMode(), scene: element.viewer!.getScene() !== null }),
      { once: true },
    );
    element.viewer!.setMode('plan2d');
    expect(element.viewer!.getMode()).toBe('plan2d');
    expect(element.viewer!.getScene()).toBeNull();
    container.scrollIntoView();
    await element.viewer!.ready;
    expect(element.viewer!.getMode()).toBe('plan2d');
    expect(element.viewer!.getScene()).not.toBeNull();
    // Inside the boot's own events the handle answers from the running viewer,
    // and the queued mode is already applied when `jeex-ready` fires.
    expect(atScene).toEqual([true]);
    expect(atReady).toEqual([{ mode: 'plan2d', scene: true }]);
    window.scrollTo(0, 0);
  });

  test(
    'two viewers on a page make one context each',
    async () => {
      const watched = watchContexts();
      try {
        const first = placeIn(openContainer(), base());
        const second = placeIn(openContainer(), base());
        first.scrollIntoView();
        await first.viewer!.ready;
        second.scrollIntoView();
        await second.viewer!.ready;
        expect(watched.contexts.size).toBe(2);
      } finally {
        watched.restore();
        window.scrollTo(0, 0);
      }
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );
});

describe('the handle before and after the start', () => {
  test(
    'answers every member as a viewer before its first scene, then forwards each to the running viewer',
    async () => {
      const container = belowTheFold();
      const element = placeIn(container, base());
      const viewer = element.viewer!;
      const id = '0192a8f0-0000-7000-8000-000000000001';
      const selection = { kind: 'room', id, mode: 'orbit' } as const;

      // Before the start: the answers of a viewer whose first scene is still loading.
      expect(viewer.element).toBe(element.shadowRoot!.firstElementChild);
      expect(viewer.options.readonly).toBe(true);
      expect(viewer.getLocale()).toBe('en');
      expect(viewer.getFurnitureVisible()).toBe(true);
      expect(viewer.isCheckpointOverlayVisible()).toBe(false);
      expect(viewer.getState()).toMatchObject({ sceneId: null, rev: 0, tour: null, walk: { camera: { index: null, count: 0 } } });
      expect([viewer.project(), viewer.describeSelection(selection), viewer.slots.anchorPoint(), viewer.tour.progress()]).toEqual([
        null,
        null,
        null,
        null,
      ]);
      const answers = [
        viewer.focusRoom(id),
        viewer.stepCamera('next'),
        viewer.addCheckpoint({ id }),
        viewer.startCheckpointPlacement({ id }),
        viewer.setCheckpointFromView(id),
        viewer.frameCheckpoint(id),
        viewer.lookThroughCheckpoint(id),
        viewer.endLookThrough(false),
        viewer.focusCheckpoint(null),
        viewer.mirrorAsset(id, 'x'),
        viewer.turnAsset(id, 1),
      ];
      expect(answers).toEqual(answers.map(() => false));
      await expect(viewer.exportUsdz()).rejects.toMatchObject({ code: 'not-ready' });
      await expect(viewer.capture.panorama({ width: 64, roomId: id })).rejects.toMatchObject({ code: 'not-ready' });
      await expect(viewer.capture.pair({ width: 64, height: 64 })).rejects.toMatchObject({ code: 'not-ready' });
      // Every command is queued, none throws, none starts the viewer.
      viewer.setFurnitureVisible(false);
      viewer.setLocale('de');
      viewer.setCheckpointOverlay(true);
      viewer.setSelection(null);
      viewer.cancelCheckpointPlacement();
      viewer.revertCheckpointEdit();
      viewer.setAssetMoveTool(false);
      viewer.armAssetMove();
      viewer.revertAssetEdit();
      viewer.resize();
      viewer.slots.anchorTo(null);
      viewer.tour.play();
      viewer.tour.toggle();
      viewer.tour.stop();
      viewer.tour.seekDistance(0);
      viewer.tour.seekTime(0);
      viewer.tour.setSpeed(1);
      viewer.tour.pause();
      viewer.tour.seek(0);
      const heard: string[] = [];
      const offScene = viewer.on('scene', () => heard.push('scene'));
      const offEarly = viewer.on('mode', () => heard.push('dropped'));
      offEarly();
      const offState = viewer.tour.on('state', () => heard.push('state'));
      const offTourEarly = viewer.tour.on('ended', () => heard.push('dropped'));
      offTourEarly();
      const swapped = viewer.loadScene({ url: sceneUrl() });
      expect([viewer.getFurnitureVisible(), viewer.getLocale(), viewer.isCheckpointOverlayVisible()]).toEqual([false, 'de', true]);
      await twoFrames();
      expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();

      container.scrollIntoView();
      await viewer.ready;
      // After the boot the same object answers from the running viewer, with the queued setters applied.
      expect(viewer.getFurnitureVisible()).toBe(false);
      expect(viewer.getLocale()).toBe('de');
      expect(viewer.isCheckpointOverlayVisible()).toBe(true);
      expect(viewer.getState().sceneId).not.toBeNull();
      expect(viewer.getScene()).not.toBeNull();
      expect(viewer.element.matches(VIEWER_ROOT_SELECTOR)).toBe(true);
      expect(viewer.options.readonly).toBe(true);
      expect(viewer.tour.progress()).not.toBeNull();
      expect(viewer.focusRoom('not-a-uuid')).toBe(false);
      expect(viewer.slots.anchorPoint()).toBeNull();
      expect(() => viewer.slots.get('selection-anchor')).toThrow(expect.objectContaining({ code: 'bad-params' }));
      await swapped;
      await until(() => heard.includes('scene'), 'the scene event of the queued load', SECOND_BUILD_WAIT_MS);
      expect(heard).not.toContain('dropped');
      offScene();
      offState();
      const still = await viewer.capture.still({ width: 32, height: 32 });
      expect(still).toBeDefined();
      window.scrollTo(0, 0);
    },
    MOUNT_PLUS_RELOAD_TIMEOUT_MS,
  );
});

describe('the `loading` attribute on a real element', () => {
  test('the property reflects the attribute and reads the normalised value', () => {
    const element = placeIn(belowTheFold(), base());
    expect(element.loading).toBe('lazy');
    element.setAttribute('loading', 'soon');
    expect(element.loading).toBe('lazy');
    element.loading = 'eager';
    expect(element.getAttribute('loading')).toBe('eager');
    expect(element.loading).toBe('eager');
  });

  test('an eager element below the fold starts at the connect', async () => {
    const element = placeIn(belowTheFold(), { ...base(), loading: 'eager' });
    await element.viewer!.ready;
    expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).not.toBeNull();
  });

  test('setting loading to eager on a waiting element starts it', async () => {
    const element = placeIn(belowTheFold(), base());
    await twoFrames();
    expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
    element.loading = 'eager';
    await element.viewer!.ready;
    expect(element.shadowRoot!.querySelector(VIEWER_ROOT_SELECTOR)).not.toBeNull();
  });
});

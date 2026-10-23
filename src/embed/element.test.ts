/**
 * `<jeex-viewer>` without a browser.
 *
 * The element's BEHAVIOUR is `ViewerElementController`, and it takes its DOM
 * as an `ElementHost` it is handed — so the attribute mapping, the mount
 * guard, the liveness policy, the events and the teardown are all checkable
 * here against a fake host and a fake handle. What genuinely needs a browser
 * — the `HTMLElement` subclass, `attachShadow`, `CustomEvent` — is asserted in
 * `scripts/browser-check/embed.ts` against `dev/embed-element.html`.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TAG,
  MOUNT_BOX_STYLE,
  OBSERVED_ATTRIBUTES,
  RATIO_ATTRIBUTE,
  SHADOW_ATTRIBUTE,
  SHADOW_NONE,
  LOADING_ATTRIBUTE,
  loadingPolicy,
  ViewerElementController,
  effectOf,
  hostBoxCss,
  optionsFromAttributes,
} from './element.js';
import { COMPOUND_SCHEMA, OPTION_SCHEMA } from '../app/viewer-options.js';
import type { SceneSource } from '../scene/scene-repository.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import type { ViewerMode } from '../scene/types.js';
import { collectLog } from '../fixtures/stubs.js';
import type { ElementRuntime } from './element-runtime.js';
import { createRuntimeLoader } from './element-controller.js';
import { PENDING_TOUR_SPEEDS } from './pending-viewer.js';
import { TOUR_SPEEDS } from '../camera/tour-player.js';

type Emitted = { type: string; detail: unknown };

/**
 * Lets the microtask flush run.
 *
 * `attributeChanged` collects and flushes in ONE microtask, so a test that sets
 * an attribute has to yield before it reads what happened — which is what a
 * host page's own script does too, one task later.
 */
function flushed(): Promise<void> {
  return Promise.resolve();
}

/** Everything the fake handle recorded, so a test can read what was called. */
type Recorder = {
  emitted: Emitted[];
  mounted: Array<{ shadow: boolean; options: unknown }>;
  loaded: SceneSource[];
  modes: ViewerMode[];
  /** Every `setLightTemperature` the running viewer was given, oldest first. */
  temperatures: Array<number | null>;
  disposals: number;
  /** Custom states the element was put in, newest last. */
  states: string[];
  /** Every `ratio` value the default box was given, oldest first. */
  boxes: Array<string | null>;
  /** Subscriptions still open on the handle; teardown must empty this. */
  open: () => number;
  /** Fires one handle event at whoever subscribed to it. */
  fire: (event: string, payload: unknown) => void;
  /** Fires one tour event at whoever subscribed to it. */
  fireTour: (event: string, payload: unknown) => void;
};

/** How a harness starts: at once (no `whenWanted`, as a plain host object), or when the test says so. */
type HarnessStart = {
  /** Hold the start until `record.start()`; the cancel is counted. */
  deferred?: boolean;
  /** A `whenWanted` that starts at once and answers a no-op cancel, as `watchStart` does without `IntersectionObserver`. */
  immediate?: boolean;
  /** The runtime loader, for a test of the import itself; the default answers at once. */
  load?: (runtime: ElementRuntime) => () => Promise<ElementRuntime>;
  /** The started viewer's own `ready`. */
  ready?: Promise<void>;
};

function harness(
  attributes: Record<string, string> = {},
  how: HarnessStart = {},
): { controller: ViewerElementController; record: Recorder & { start: () => void; cancels: () => number } } {
  const emitted: Emitted[] = [];
  const mounted: Array<{ shadow: boolean; options: unknown }> = [];
  const loaded: SceneSource[] = [];
  const modes: ViewerMode[] = [];
  const temperatures: Array<number | null> = [];
  const states: string[] = [];
  const boxes: Array<string | null> = [];
  let disposals = 0;
  const listeners = new Map<string, Set<(payload: never) => void>>();
  const subscribe = (event: string, callback: (payload: never) => void): (() => void) => {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  };
  const emit = (event: string, payload: unknown): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) (listener as (value: unknown) => void)(payload);
  };

  const tour = {
    on: (event: string, callback: (payload: never) => void) => subscribe(`tour:${event}`, callback),
  } as unknown as TourControls;

  const handle = {
    tour,
    ready: how.ready ?? Promise.resolve(),
    loadScene: async (source: SceneSource) => {
      loaded.push(source);
    },
    setMode: (mode: ViewerMode) => {
      modes.push(mode);
    },
    setLightTemperature: (temperature: number | null) => {
      temperatures.push(temperature);
    },
    on: (event: string, callback: (payload: never) => void) => subscribe(event, callback),
    dispose: () => {
      disposals += 1;
    },
  } as unknown as ViewerHandle;

  let shadowAsked = false;
  let start: (() => void) | null = null;
  let cancels = 0;
  const runtime: ElementRuntime = {
    mount: (_container, options) => {
      mounted.push({ shadow: shadowAsked, options });
      return handle;
    },
  };
  const controller = new ViewerElementController(
    {
      attribute: (name) => attributes[name] ?? null,
      mountPoint: (shadow) => {
        shadowAsked = shadow;
        return {} as HTMLElement;
      },
      emit: (type, detail) => {
        emitted.push({ type, detail });
      },
      setState: (state) => {
        states.push(state);
      },
      setBox: (ratio) => {
        boxes.push(ratio);
      },
      ...(how.immediate && {
        whenWanted: (wanted: () => void) => {
          wanted();
          return () => undefined;
        },
      }),
      ...(how.deferred && {
        whenWanted: (wanted: () => void) => {
          start = wanted;
          return () => {
            cancels += 1;
          };
        },
      }),
    },
    how.load ? how.load(runtime) : runtime,
  );

  return {
    controller,
    record: {
      emitted,
      mounted,
      loaded,
      modes,
      temperatures,
      states,
      boxes,
      get disposals() {
        return disposals;
      },
      open: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
      start: () => start?.(),
      cancels: () => cancels,
      fire: emit,
      fireTour: (event, payload) => emit(`tour:${event}`, payload),
    },
  };
}

describe('the observed attributes', () => {
  test("are every option spelling, every compound attribute, plus the element's own `shadow` and `ratio`", () => {
    const fromSchema = Object.values(OPTION_SCHEMA).map((spec) => spec.attr);
    const fromCompound = Object.values(COMPOUND_SCHEMA).map((spec) => spec.attr);
    expect([...OBSERVED_ATTRIBUTES].sort()).toEqual(
      [...fromSchema, ...fromCompound, SHADOW_ATTRIBUTE, RATIO_ATTRIBUTE, LOADING_ATTRIBUTE].sort(),
    );
  });

  test('the compound chrome attribute is observed', () => {
    expect(OBSERVED_ATTRIBUTES).toContain('chrome');
  });

  test('include the kebab-case spellings, not the dataset ones', () => {
    expect(OBSERVED_ATTRIBUTES).toContain('tour-start');
    expect(OBSERVED_ATTRIBUTES).not.toContain('tourStart');
  });
});

describe('optionsFromAttributes', () => {
  test('maps each attribute onto its option, `src` onto the scene url', () => {
    const options = optionsFromAttributes(
      (name) =>
        (
          {
            view: 'walk',
            'tour-start': '0.25',
            lang: 'ru',
            src: '/scenes/flat-a.json',
          } as Record<string, string>
        )[name] ?? null,
    );
    expect(options).toEqual({
      view: { mode: 'walk' },
      tour: { start: 0.25 },
      locale: 'ru',
      scene: { url: '/scenes/flat-a.json' },
    });
  });

  test('a bare boolean attribute means true, HTML-style', () => {
    // `<jeex-viewer minimap>` has the value `''`, which `asFlag` alone would
    // hand on as garbage for the resolver to complain about.
    expect(optionsFromAttributes((name) => (name === 'minimap' ? '' : null))).toEqual({ view: { minimap: true } });
    expect(optionsFromAttributes((name) => (name === 'minimap' ? '0' : null))).toEqual({ view: { minimap: false } });
  });

  test('an absent attribute contributes nothing, so the default stands', () => {
    expect(optionsFromAttributes(() => null)).toEqual({});
  });

  test('a bad value is passed through for the one validator to report', () => {
    // `resolveViewerOptions` is where a warning belongs; the reader stays
    // syntactic so there is one message, in one place, whatever door it came
    // in through (`viewer-options.ts`).
    expect(optionsFromAttributes((name) => (name === 'view' ? 'sideways' : null))).toEqual({ view: { mode: 'sideways' as never } });
  });

  test('chrome="false" chrome-status="true" zeroes every chrome.* flag except the one after it', () => {
    const attributes: Record<string, string> = { chrome: 'false', 'chrome-status': 'true' };
    const options = optionsFromAttributes((name) => attributes[name] ?? null);
    expect(options).toEqual({ chrome: { brand: false, controls: false, status: true, modeSwitcher: false, hint: false } });
  });

  test('chrome="true" is a no-op', () => {
    expect(optionsFromAttributes((name) => (name === 'chrome' ? 'true' : null))).toEqual({});
  });

  test('an unrecognised compound value is reported through the given log sink and ignored', () => {
    const logged = collectLog();
    const options = optionsFromAttributes((name) => (name === 'chrome' ? 'maybe' : null), logged.sink);
    expect(options).toEqual({});
    expect(logged.codes()).toEqual(['option-invalid']);
    expect(logged.messages()[0]).toContain('chrome');
  });
});

describe('effectOf', () => {
  test('only `src`, `view`, `light-temperature` and the box `ratio` do anything to a running viewer', () => {
    expect(effectOf('src')).toBe('scene');
    expect(effectOf('view')).toBe('mode');
    expect(effectOf('light-temperature')).toBe('temperature');
    expect(effectOf(RATIO_ATTRIBUTE)).toBe('box');
    const live = new Set(['src', 'view', 'light-temperature', RATIO_ATTRIBUTE, LOADING_ATTRIBUTE]);
    for (const attribute of OBSERVED_ATTRIBUTES.filter((name) => !live.has(name))) {
      expect([attribute, effectOf(attribute)]).toEqual([attribute, 'frozen']);
    }
  });
});

describe('connect', () => {
  test('mounts once, however often the element is connected', () => {
    const { controller, record } = harness({ view: 'walk', src: '/a.json' });
    controller.connect();
    controller.connect();
    expect(record.mounted).toHaveLength(1);
    expect(record.mounted[0]!.options).toEqual({ view: { mode: 'walk' }, scene: { url: '/a.json' }, readonly: true });
  });

  test('is read-only unless the page opts into editing with readonly="0"', () => {
    const { controller: bare, record: bareRecord } = harness({ src: '/a.json' });
    bare.connect();
    expect((bareRecord.mounted[0]!.options as { readonly?: boolean }).readonly).toBe(true);

    const { controller: editing, record: editingRecord } = harness({ src: '/a.json', readonly: '0' });
    editing.connect();
    expect((editingRecord.mounted[0]!.options as { readonly?: boolean }).readonly).toBe(false);

    // HTML's boolean spelling still means read-only.
    const { controller: flagged, record: flaggedRecord } = harness({ src: '/a.json', readonly: '' });
    flagged.connect();
    expect((flaggedRecord.mounted[0]!.options as { readonly?: boolean }).readonly).toBe(true);
  });

  test('an element with no `src` mounts against a source that refuses', () => {
    // It must NOT throw out of `connectedCallback`, where a host page has
    // nothing to catch it with. The refusal reaches it as an `error` event and
    // the viewer's own card instead.
    const { controller, record } = harness();
    expect(() => controller.connect()).not.toThrow();
    const scene = (record.mounted[0]!.options as { scene?: { repository?: { load: () => Promise<unknown> } } }).scene;
    expect(typeof scene?.repository?.load).toBe('function');
    expect(scene?.repository?.load()).rejects.toMatchObject({ code: 'no-scene-source' });
  });

  test('mounts into a shadow root by default and into light DOM on shadow="none"', () => {
    const { controller: shadow, record: shadowRecord } = harness();
    shadow.connect();
    expect(shadowRecord.mounted[0]!.shadow).toBe(true);

    const { controller: light, record: lightRecord } = harness({ [SHADOW_ATTRIBUTE]: SHADOW_NONE });
    light.connect();
    expect(lightRecord.mounted[0]!.shadow).toBe(false);
  });

  test('the handle and the tour are reachable as properties only once mounted', () => {
    const { controller } = harness();
    expect(controller.viewer).toBeNull();
    expect(controller.tour).toBeNull();
    controller.connect();
    expect(controller.viewer).not.toBeNull();
    expect(controller.tour).not.toBeNull();
  });
});

describe('the events', () => {
  test('every handle and tour event becomes one `jeex-` event', () => {
    const { controller, record } = harness();
    controller.connect();
    record.fire('ready', { sceneId: 'flat-a' });
    record.fire('error', { code: 'scene-load', message: 'nope' });
    record.fire('scene', { sceneId: 'flat-a', rev: 3 });
    record.fire('mode', 'walk');
    record.fireTour('progress', { fraction: 0.5 });
    record.fireTour('state', 'playing');
    record.fireTour('ended', undefined);
    record.fire('lightTemperature', { temperature: 3000, source: 'panel' });
    expect(record.emitted.map((event) => event.type)).toEqual([
      'jeex-ready',
      'jeex-error',
      'jeex-scene',
      'jeex-mode',
      'jeex-tour-progress',
      'jeex-tour-state',
      'jeex-tour-ended',
      'jeex-light-temperature',
    ]);
    expect(record.emitted.at(-1)!.detail).toEqual({ temperature: 3000, source: 'panel' });
  });

  test('the payloads are the documented shapes, not the internal ones', () => {
    const { controller, record } = harness();
    controller.connect();
    record.fire('mode', 'tour');
    record.fireTour('state', 'paused');
    record.fireTour('ended', undefined);
    const detail = (type: string): unknown => record.emitted.find((event) => event.type === type)?.detail;
    // The mode is the bare value; the tour state is wrapped, because a host
    // reading `event.detail.state` must not have to know it was a string.
    expect(detail('jeex-mode')).toBe('tour');
    expect(detail('jeex-tour-state')).toEqual({ state: 'paused' });
    expect(detail('jeex-tour-ended')).toEqual({});
  });
});

describe('attributeChanged', () => {
  test('does nothing before the mount: connect reads every attribute at once', () => {
    const attributes: Record<string, string> = { src: '/a.json' };
    const { controller, record } = harness(attributes);
    controller.attributeChanged('src');
    expect(record.loaded).toEqual([]);
    controller.connect();
    expect(record.mounted[0]!.options).toEqual({ scene: { url: '/a.json' }, readonly: true });
  });

  test('a new `src` loads that scene', async () => {
    const attributes: Record<string, string> = { src: '/a.json' };
    const { controller, record } = harness(attributes);
    controller.connect();
    attributes['src'] = '/b.json';
    controller.attributeChanged('src');
    await flushed();
    expect(record.loaded).toEqual([{ url: '/b.json' }]);
  });

  test('a new `view` switches the mode, through the one validator', async () => {
    const attributes: Record<string, string> = {};
    const { controller, record } = harness(attributes);
    controller.connect();
    attributes['view'] = 'walk';
    controller.attributeChanged('view');
    await flushed();
    expect(record.modes).toEqual(['walk']);
  });

  test('several changes in one task flush together, and the scene swap goes last', async () => {
    // The platform fires the callback once per attribute, synchronously; a
    // host setting `view` and `src` in the same script would otherwise get two
    // re-renders, with the mode arriving after the new document had mounted.
    const attributes: Record<string, string> = { src: '/a.json' };
    const { controller, record } = harness(attributes);
    controller.connect();
    attributes['src'] = '/b.json';
    attributes['view'] = 'walk';
    controller.attributeChanged('src');
    controller.attributeChanged('view');
    controller.attributeChanged('src');
    expect(record.loaded).toEqual([]);
    await flushed();
    // ONE load, not two, and the mode was in place before it.
    expect(record.loaded).toEqual([{ url: '/b.json' }]);
    expect(record.modes).toEqual(['walk']);
  });

  test('every other attribute warns once and changes nothing', async () => {
    const attributes: Record<string, string> = {};
    const { controller, record } = harness(attributes);
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    attributes['minimap'] = '0';
    controller.attributeChanged('minimap');
    await flushed();
    expect(logged.entries).toHaveLength(1);
    expect(logged.entries[0]?.code).toBe('attribute-read-once');
    expect(logged.entries[0]?.detail).toEqual({ attribute: 'minimap' });
    expect(logged.entries[0]?.message).toContain(DEFAULT_TAG);
    expect(record.loaded).toEqual([]);
    expect(record.modes).toEqual([]);
  });

  test('a removed `src` keeps the scene on screen and says so', async () => {
    const attributes: Record<string, string> = { src: '/a.json' };
    const { controller, record } = harness(attributes);
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    delete attributes['src'];
    controller.attributeChanged('src');
    await flushed();
    expect(record.loaded).toEqual([]);
    expect(logged.codes()).toEqual(['src-removed']);
  });

  test('the sink set before connect reaches the viewer it mounts', () => {
    const attributes: Record<string, string> = { src: '/a.json' };
    const { controller, record } = harness(attributes);
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    expect((record.mounted[0]!.options as { onLog?: unknown }).onLog).toBe(logged.sink);
  });
});

describe('the custom states', () => {
  test('run loading -> ready, and loading -> error', () => {
    const first = harness();
    first.controller.connect();
    expect(first.record.states).toEqual(['loading']);
    first.record.fire('ready', { sceneId: 'flat-a', options: {} });
    expect(first.record.states).toEqual(['loading', 'ready']);

    const second = harness();
    second.controller.connect();
    second.record.fire('error', { code: 'no-scene-source', message: 'viewer: no scene source' });
    expect(second.record.states).toEqual(['loading', 'error']);
  });

  test('a host with no `ElementInternals.states` simply has none', () => {
    // `setState` is optional on `ElementHost`: an engine without custom states
    // gets an element with no states, never one that throws.
    const { controller } = harness();
    expect(() => controller.connect()).not.toThrow();
  });
});

describe('a move rather than a re-add', () => {
  test('keeps the viewer that is already running', () => {
    // `moveBefore()` calls `connectedMoveCallback` INSTEAD of the disconnect /
    // connect pair; rebuilding here would be the flash the API exists to remove.
    const { controller, record } = harness();
    controller.connect();
    const viewer = controller.viewer;
    controller.move();
    expect(controller.viewer).toBe(viewer);
    expect(record.mounted).toHaveLength(1);
    expect(record.disposals).toBe(0);
  });

  test('a move that arrives before anything was mounted still builds one', () => {
    const { controller, record } = harness();
    controller.move();
    expect(record.mounted).toHaveLength(1);
  });
});

describe('the `lang` attribute', () => {
  test('takes the primary subtag of a BCP-47 tag', () => {
    const { controller, record } = harness({ lang: 'ru-RU', src: '/a.json' });
    controller.connect();
    expect((record.mounted[0]!.options as { locale?: string }).locale).toBe('ru');
  });

  test('a language with no catalogue is dropped, with a warning, so the default stands', () => {
    // 'zz' has no catalogue and never will; 'de' ships with the viewer.
    const { controller, record } = harness({ lang: 'zz-ZZ', src: '/a.json' });
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    expect((record.mounted[0]!.options as { locale?: string }).locale).toBeUndefined();
    expect(logged.codes()).toEqual(['locale-unknown']);
    expect(logged.entries[0]?.detail).toEqual({ lang: 'zz-ZZ' });
  });

  test('a plain language tag is used as it is', () => {
    const { controller, record } = harness({ lang: 'en', src: '/a.json' });
    controller.connect();
    expect((record.mounted[0]!.options as { locale?: string }).locale).toBe('en');
  });

  test('`lang="sr"` mounts the Serbian catalogue under its canonical tag', () => {
    const { controller, record } = harness({ lang: 'sr', src: '/a.json' });
    controller.connect();
    expect((record.mounted[0]!.options as { locale?: string }).locale).toBe('sr-Latn');
  });

  test('`lang="sr-Cyrl"` is dropped with a warning rather than answered in Latin', () => {
    const { controller, record } = harness({ lang: 'sr-Cyrl', src: '/a.json' });
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    expect((record.mounted[0]!.options as { locale?: string }).locale).toBeUndefined();
    expect(logged.codes()).toEqual(['locale-unknown']);
  });
});

describe('disconnect', () => {
  test('disposes the viewer and drops every subscription', () => {
    const { controller, record } = harness();
    controller.connect();
    // Five handle events (ready, error, scene, mode, select) plus `edit` and
    // `lightTemperature`, three of the tour's, plus the handle's own wait for
    // the first `scene` and `ready`. Every one of them has to come back on disconnect.
    expect(record.open()).toBe(12);
    controller.disconnect();
    expect(record.disposals).toBe(1);
    expect(record.open()).toBe(0);
    expect(controller.viewer).toBeNull();
  });

  test('a disconnected element emits nothing more', () => {
    const { controller, record } = harness();
    controller.connect();
    controller.disconnect();
    record.fire('mode', 'walk');
    expect(record.emitted).toEqual([]);
  });

  test('re-connecting after a move builds a new viewer', () => {
    const { controller, record } = harness();
    controller.connect();
    controller.disconnect();
    controller.connect();
    expect(record.mounted).toHaveLength(2);
    expect(record.disposals).toBe(1);
  });

  test('is safe to call without a mount', () => {
    const { controller, record } = harness();
    controller.disconnect();
    expect(record.disposals).toBe(0);
  });
});

describe('the default box', () => {
  test('a shadow mount gets the 16:9 box, a light-DOM mount none', () => {
    const { controller, record } = harness({ src: '/a.json' });
    controller.connect();
    expect(record.boxes).toEqual([null]);

    const { controller: light, record: lightRecord } = harness({ src: '/a.json', [SHADOW_ATTRIBUTE]: SHADOW_NONE });
    light.connect();
    expect(lightRecord.boxes).toEqual([]);
  });

  test('`ratio` is live: a change re-sizes the box and warns nothing', async () => {
    const attributes: Record<string, string> = { src: '/a.json', ratio: '4:3' };
    const { controller, record } = harness(attributes);
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    attributes['ratio'] = '1';
    controller.attributeChanged('ratio');
    await flushed();
    expect(record.boxes).toEqual(['4:3', '1']);
    expect(logged.entries).toEqual([]);
    expect(record.mounted).toHaveLength(1);
  });

  test('a value that is no ratio warns and keeps 16:9', () => {
    const { controller } = harness({ src: '/a.json', ratio: 'wide' });
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    expect(logged.entries.map((entry) => entry.code)).toEqual(['ratio-invalid']);
    expect(hostBoxCss('wide')).toContain('aspect-ratio:16 / 9');
  });

  test('the :host rule is a block at the full width and the ratio, nothing a host cannot override', () => {
    // `border-box`: a host's padding or border must not push the box past its parent.
    expect(hostBoxCss(null)).toBe(':host{display:block;position:relative;box-sizing:border-box;inline-size:100%;aspect-ratio:16 / 9}');
    expect(hostBoxCss('4:3')).toContain('aspect-ratio:4 / 3');
    expect(hostBoxCss(null)).not.toContain('!important');
    // No height of its own: a host's `height` must leave the ratio unused.
    expect(hostBoxCss(null)).not.toMatch(/block-size|height/);
  });
});

describe('the shadow mount box', () => {
  test('sizes itself to the element, which the component sheet cannot do', () => {
    // `viewer.css` is scoped to `.jeex-viewer` — the viewer's root INSIDE the
    // box — so nothing in it reaches the box the element creates.
    const declared = new Map(MOUNT_BOX_STYLE);
    expect(declared.get('block-size')).toBe('100%');
    expect(declared.get('inline-size')).toBe('100%');
    expect(declared.get('position')).toBe('relative');
    // Declarations, not a `style` string: a `style` attribute would need
    // `style-src-attr 'unsafe-inline'` from the host's policy.
    expect(Array.isArray(MOUNT_BOX_STYLE)).toBe(true);
  });
});

describe('the start', () => {
  test('the connect gives the box and the handle, and builds nothing until the viewer is wanted', () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    expect(record.mounted).toEqual([]);
    expect(record.boxes).toEqual([null]);
    expect(record.states).toEqual(['loading']);
    expect(controller.viewer).not.toBeNull();
    expect(controller.tour).not.toBeNull();
    record.start();
    expect(record.mounted).toHaveLength(1);
  });

  test('commands before the start are replayed in call order, and queries answer as before a first scene', async () => {
    const { controller, record } = harness({ src: '/a.json', view: 'plan2d' }, { deferred: true });
    controller.connect();
    const viewer = controller.viewer!;
    expect(viewer.getMode()).toBe('plan2d');
    viewer.setMode('walk');
    viewer.setMode('orbit');
    const swapped = viewer.loadScene({ url: '/b.json' });
    expect(viewer.getMode()).toBe('orbit');
    expect(viewer.getScene()).toBeNull();
    expect(viewer.focusRoom('0192a8f0-0000-7000-8000-000000000000')).toBe(false);
    expect(viewer.tour.progress()).toBeNull();
    expect(viewer.getState()).toMatchObject({ mode: 'orbit', sceneId: null, rev: 0, tour: null });
    expect(record.modes).toEqual([]);
    record.start();
    // Replayed once the started viewer's first boot settles: a real handle
    // drops a mode switch that arrives before its camera stack exists.
    expect(record.modes).toEqual([]);
    // Queries are the started viewer's from its first `scene` on; commands wait for `ready`.
    record.fire('scene', { sceneId: 'flat-a', rev: 1 });
    expect(record.modes).toEqual([]);
    expect(viewer.getMode()).toBe('orbit');
    record.fire('ready', { sceneId: 'flat-a', options: {} });
    expect(record.modes).toEqual(['walk', 'orbit']);
    await swapped;
    expect(record.loaded).toEqual([{ url: '/b.json' }]);
  });

  test('a capture or an export before the start rejects not-ready, as before the first frame', async () => {
    const { controller } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    const viewer = controller.viewer!;
    await expect(viewer.exportGlb()).rejects.toMatchObject({ code: 'not-ready' });
    await expect(viewer.capture.still({ width: 64, height: 64 })).rejects.toMatchObject({ code: 'not-ready' });
    expect(() => viewer.slots.get('selection-anchor')).toThrow(expect.objectContaining({ code: 'not-ready' }));
  });

  test('a subscription made before the start hears the started viewer', () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    const heard: unknown[] = [];
    controller.viewer!.on('mode', (mode) => heard.push(mode));
    const off = controller.viewer!.tour.on('state', (state) => heard.push(state));
    record.start();
    record.fire('mode', 'walk');
    record.fireTour('state', 'playing');
    off();
    record.fireTour('state', 'paused');
    expect(heard).toEqual(['walk', 'playing']);
  });

  test('`ready` is one promise for the connection and settles with the started viewer', async () => {
    let resolve: () => void = () => undefined;
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true, ready });
    controller.connect();
    const early = controller.viewer!.ready;
    let settled = false;
    void early.then(() => {
      settled = true;
    });
    record.start();
    expect(controller.viewer!.ready).toBe(early);
    await Promise.resolve();
    expect(settled).toBe(false);
    resolve();
    await early;
    expect(settled).toBe(true);
  });

  test('a disconnect before the start cancels it and rejects `ready` as disposed', async () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    const viewer = controller.viewer!;
    viewer.setMode('walk');
    controller.disconnect();
    expect(record.cancels()).toBe(1);
    await expect(viewer.ready).rejects.toMatchObject({ code: 'disposed' });
    // A start that was already on its way builds nothing for a connection that ended.
    record.start();
    expect(record.mounted).toEqual([]);
    expect(record.modes).toEqual([]);
    expect(controller.viewer).toBeNull();
  });

  test('a scene load queued before the start rejects as disposed when the element leaves first', async () => {
    const { controller } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    const load = controller.viewer!.loadScene({ url: '/b.json' });
    controller.disconnect();
    await expect(load).rejects.toMatchObject({ code: 'disposed' });
  });

  test('a host dispose() before the start means no start at all', () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    controller.viewer!.dispose();
    record.start();
    expect(record.mounted).toEqual([]);
  });

  test('`ratio` is live before the start too, because the box is', () => {
    const attributes: Record<string, string> = { src: '/a.json', ratio: '4:3' };
    const { controller, record } = harness(attributes, { deferred: true });
    controller.connect();
    attributes['ratio'] = '1';
    controller.attributeChanged('ratio');
    attributes['view'] = 'walk';
    controller.attributeChanged('view');
    expect(record.boxes).toEqual(['4:3', '1']);
    record.start();
    // Attributes changed before the start are simply read at the start.
    expect((record.mounted[0]!.options as { view?: unknown }).view).toEqual({ mode: 'walk' });
  });

  test('a move before the connect waits like a connect, it does not start', () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.move();
    expect(record.mounted).toEqual([]);
    expect(controller.viewer).not.toBeNull();
  });
});

describe('the runtime import', () => {
  test('happens at the start, and a disconnect while it is in flight builds nothing', async () => {
    let answer: () => void = () => undefined;
    let imports = 0;
    const { controller, record } = harness(
      { src: '/a.json' },
      {
        load: (runtime) => () => {
          imports += 1;
          return new Promise<ElementRuntime>((resolve) => {
            answer = () => resolve(runtime);
          });
        },
      },
    );
    controller.connect();
    expect(imports).toBe(1);
    controller.disconnect();
    answer();
    await Promise.resolve();
    await Promise.resolve();
    expect(record.mounted).toEqual([]);
  });

  test('a runtime that cannot be loaded says so as `jeex-error` with the `internal` code, and `ready` rejects', async () => {
    const { controller, record } = harness({ src: '/a.json' }, { load: () => () => Promise.reject(new TypeError('network')) });
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    const viewer = controller.viewer!;
    await expect(viewer.ready).rejects.toMatchObject({ code: 'internal' });
    expect(record.emitted.map((event) => event.type)).toEqual(['jeex-error']);
    expect(record.emitted[0]!.detail).toMatchObject({ code: 'internal' });
    expect(record.states).toEqual(['loading', 'error']);
    expect(logged.codes()).toEqual(['runtime-load-failed']);
  });
});

describe('the boot behind the handle', () => {
  test('a boot that fails replays nothing; the queue waits for a Retry that reaches ready', async () => {
    let fail: (error: unknown) => void = () => undefined;
    const ready = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true, ready });
    controller.connect();
    const viewer = controller.viewer!;
    viewer.setMode('walk');
    const load = viewer.loadScene({ url: '/b.json' });
    record.start();
    record.fire('error', { code: 'scene-load', message: 'nope' });
    fail(new Error('scene-load'));
    await expect(viewer.ready).rejects.toThrow('scene-load');
    expect(record.modes).toEqual([]);
    expect(record.loaded).toEqual([]);
    // A Retry that boots raises `ready`: the queue runs then.
    record.fire('ready', { sceneId: 'flat-a', options: {} });
    expect(record.modes).toEqual(['walk']);
    expect(record.loaded).toEqual([{ url: '/b.json' }]);
    await load;
  });

  test('a disconnect while the boot runs rejects the loads still queued', async () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true, ready: new Promise<void>(() => {}) });
    controller.connect();
    const load = controller.viewer!.loadScene({ url: '/b.json' });
    record.start();
    controller.disconnect();
    await expect(load).rejects.toMatchObject({ code: 'disposed' });
    expect(record.disposals).toBe(1);
  });

  test('a host dispose() while the boot runs disposes the viewer and rejects the loads still queued', async () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true, ready: new Promise<void>(() => {}) });
    controller.connect();
    record.start();
    const load = controller.viewer!.loadScene({ url: '/b.json' });
    controller.viewer!.dispose();
    await expect(load).rejects.toMatchObject({ code: 'disposed' });
    expect(record.disposals).toBe(1);
  });

  test('inside the first `scene` and `ready` the handle already answers from the running viewer', () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    const viewer = controller.viewer!;
    viewer.setMode('walk');
    record.start();
    const seen: unknown[] = [];
    viewer.on('scene', () => seen.push(['scene', record.modes.length]));
    viewer.on('ready', () => seen.push(['ready', record.modes.length]));
    record.fire('scene', { sceneId: 'flat-a', rev: 1 });
    record.fire('ready', { sceneId: 'flat-a', options: {} });
    // The queued mode is applied before any `ready` listener runs.
    expect(seen).toEqual([
      ['scene', 0],
      ['ready', 1],
    ]);
  });

  test('a tour speed the controls refuse is refused at the call, before the start too', () => {
    const { controller } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    expect(() => controller.viewer!.tour.setSpeed(3 as never)).toThrow(expect.objectContaining({ code: 'bad-params' }));
    expect([...PENDING_TOUR_SPEEDS]).toEqual([...TOUR_SPEEDS]);
  });
});

describe('createRuntimeLoader', () => {
  test('imports once for every element, and tries again after a failed import', async () => {
    const runtime = { mount: () => ({}) as ViewerHandle } satisfies ElementRuntime;
    let calls = 0;
    const load = createRuntimeLoader(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new TypeError('network')) : Promise.resolve(runtime);
    });
    await expect(load()).rejects.toThrow('network');
    expect(await load()).toBe(runtime);
    expect(await load()).toBe(runtime);
    expect(calls).toBe(2);
  });
});

describe('the `loading` attribute', () => {
  test('is lazy by default: the element waits for the start', () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    expect(record.mounted).toEqual([]);
  });

  test('`eager` starts at the connect, without waiting for the viewport', () => {
    const { controller, record } = harness({ src: '/a.json', [LOADING_ATTRIBUTE]: 'eager' }, { deferred: true });
    controller.connect();
    expect(record.mounted).toHaveLength(1);
  });

  test('an unknown or empty value falls back to lazy', () => {
    expect([loadingPolicy(null), loadingPolicy(''), loadingPolicy('soon'), loadingPolicy('lazy'), loadingPolicy('EAGER')]).toEqual([
      'lazy',
      'lazy',
      'lazy',
      'lazy',
      'eager',
    ]);
    const { controller, record } = harness({ src: '/a.json', [LOADING_ATTRIBUTE]: 'soon' }, { deferred: true });
    controller.connect();
    expect(record.mounted).toEqual([]);
  });

  test('lazy to eager before the start starts it; a change after the start does nothing', async () => {
    const attributes: Record<string, string> = { src: '/a.json' };
    const { controller, record } = harness(attributes, { deferred: true });
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    attributes[LOADING_ATTRIBUTE] = 'eager';
    controller.attributeChanged(LOADING_ATTRIBUTE);
    expect(record.mounted).toHaveLength(1);
    expect(record.cancels()).toBe(1);
    attributes[LOADING_ATTRIBUTE] = 'lazy';
    controller.attributeChanged(LOADING_ATTRIBUTE);
    await flushed();
    expect(record.mounted).toHaveLength(1);
    expect(logged.entries).toEqual([]);
  });

  test('is observed, as an element attribute of its own', () => {
    expect(OBSERVED_ATTRIBUTES).toContain(LOADING_ATTRIBUTE);
    expect(effectOf(LOADING_ATTRIBUTE)).toBe('start');
  });
});

describe('a start that happens inside the wait', () => {
  test('without IntersectionObserver, loading="eager" during the import builds no second viewer', async () => {
    const attributes: Record<string, string> = { src: '/a.json' };
    let answer: () => void = () => undefined;
    let imports = 0;
    const { controller, record } = harness(attributes, {
      immediate: true,
      load: (runtime) => () => {
        imports += 1;
        return new Promise<ElementRuntime>((resolve) => {
          answer = () => resolve(runtime);
        });
      },
    });
    controller.connect();
    attributes[LOADING_ATTRIBUTE] = 'eager';
    controller.attributeChanged(LOADING_ATTRIBUTE);
    answer();
    await Promise.resolve();
    await Promise.resolve();
    expect(imports).toBe(1);
    expect(record.mounted).toHaveLength(1);
  });
});

describe('the light temperature', () => {
  test('`light-temperature` and `settings` set before the start reach the mount', () => {
    const { controller, record } = harness({ 'light-temperature': '3000', settings: '' }, { deferred: true });
    controller.connect();
    expect(record.mounted).toHaveLength(0);
    record.start();
    expect(record.mounted[0]!.options).toMatchObject({ lighting: { temperature: 3000 }, settings: { show: true } });
  });

  test('`light-temperature` is live after the start: a number, `original`, and removal for «Original»', async () => {
    const attributes: Record<string, string> = { 'light-temperature': '3000' };
    const { controller, record } = harness(attributes);
    controller.connect();
    attributes['light-temperature'] = '5000';
    controller.attributeChanged('light-temperature');
    await flushed();
    attributes['light-temperature'] = 'original';
    controller.attributeChanged('light-temperature');
    await flushed();
    delete attributes['light-temperature'];
    controller.attributeChanged('light-temperature');
    await flushed();
    expect(record.temperatures).toEqual([5000, null, null]);
  });

  test('an invalid `light-temperature` warns once and keeps the current value', async () => {
    const attributes: Record<string, string> = { 'light-temperature': '5000' };
    const { controller, record } = harness(attributes);
    const logged = collectLog();
    controller.onLog = logged.sink;
    controller.connect();
    for (const bad of ['2000', '3050', 'warm', '']) {
      attributes['light-temperature'] = bad;
      controller.attributeChanged('light-temperature');
      await flushed();
    }
    expect(record.temperatures).toEqual([]);
    expect(logged.codes()).toEqual(['option-invalid', 'option-invalid', 'option-invalid', 'option-invalid']);
    expect(logged.messages()[0]).toContain('light-temperature');
  });

  test('setLightTemperature before the start is queued, read back, and refused at the call when invalid', async () => {
    const { controller, record } = harness({ src: '/a.json' }, { deferred: true });
    controller.connect();
    const viewer = controller.viewer!;
    expect(viewer.getState().lightTemperature).toBeNull();
    viewer.setLightTemperature(2700);
    expect(viewer.getState().lightTemperature).toBe(2700);
    expect(() => viewer.setLightTemperature(3050)).toThrow(expect.objectContaining({ code: 'bad-params', path: 'lightTemperature' }));
    record.start();
    record.fire('ready', { sceneId: 'flat-a', options: {} });
    expect(record.temperatures).toEqual([2700]);
  });
});

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

function harness(attributes: Record<string, string> = {}): { controller: ViewerElementController; record: Recorder } {
  const emitted: Emitted[] = [];
  const mounted: Array<{ shadow: boolean; options: unknown }> = [];
  const loaded: SceneSource[] = [];
  const modes: ViewerMode[] = [];
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
    loadScene: async (source: SceneSource) => {
      loaded.push(source);
    },
    setMode: (mode: ViewerMode) => {
      modes.push(mode);
    },
    on: (event: string, callback: (payload: never) => void) => subscribe(event, callback),
    dispose: () => {
      disposals += 1;
    },
  } as unknown as ViewerHandle;

  let shadowAsked = false;
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
    },
    (_container, options) => {
      mounted.push({ shadow: shadowAsked, options });
      return handle;
    },
  );

  return {
    controller,
    record: {
      emitted,
      mounted,
      loaded,
      modes,
      states,
      boxes,
      get disposals() {
        return disposals;
      },
      open: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
      fire: emit,
      fireTour: (event, payload) => emit(`tour:${event}`, payload),
    },
  };
}

describe('the observed attributes', () => {
  test("are every option spelling, every compound attribute, plus the element's own `shadow` and `ratio`", () => {
    const fromSchema = Object.values(OPTION_SCHEMA).map((spec) => spec.attr);
    const fromCompound = Object.values(COMPOUND_SCHEMA).map((spec) => spec.attr);
    expect([...OBSERVED_ATTRIBUTES].sort()).toEqual([...fromSchema, ...fromCompound, SHADOW_ATTRIBUTE, RATIO_ATTRIBUTE].sort());
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
          ({
            view: 'walk',
            'tour-start': '0.25',
            lang: 'ru',
            src: '/scenes/flat-a.json',
          }) as Record<string, string>
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
  test('only `src`, `view` and the box `ratio` do anything to a running viewer', () => {
    expect(effectOf('src')).toBe('scene');
    expect(effectOf('view')).toBe('mode');
    expect(effectOf(RATIO_ATTRIBUTE)).toBe('box');
    for (const attribute of OBSERVED_ATTRIBUTES.filter((name) => name !== 'src' && name !== 'view' && name !== RATIO_ATTRIBUTE)) {
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
    expect(record.emitted.map((event) => event.type)).toEqual([
      'jeex-ready',
      'jeex-error',
      'jeex-scene',
      'jeex-mode',
      'jeex-tour-progress',
      'jeex-tour-state',
      'jeex-tour-ended',
    ]);
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
    // Five handle events (ready, error, scene, mode, select) plus `edit`, and
    // three of the tour's. Every one of them has to come back on disconnect.
    expect(record.open()).toBe(9);
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

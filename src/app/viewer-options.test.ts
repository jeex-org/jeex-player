/**
 * The mount options are the contract an embedding page writes against, so the
 * validator is tested the way a host will hit it: partial objects, garbage from
 * a query string, and nothing at all.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  COMPOUND_SCHEMA,
  DEFAULT_VIEWER_OPTIONS,
  OPTION_SCHEMA,
  OVERLAY_PRESETS,
  optionsFromDataset,
  optionsFromQuery,
  optionsFromRecord,
  resolveViewerOptions,
  type DeepPartial,
  type ViewerOptions,
  type ViewerOptionsInput,
} from './viewer-options.js';
import type { OptionSpec } from './option-resolvers.js';
import { SLOT_NAMES } from '../ui/host-slots.js';
import { collectLog } from '../fixtures/stubs.js';
import { locales, MESSAGE_KEYS, registerLocale, type MessageKey } from '../ui/messages.js';

/**
 * Reads a dotted `OPTION_SCHEMA` path (`'tour.start'`, `'capture.disclosure.caption'`)
 * off a `ViewerOptions`-shaped object; a path with no dot is a top-level
 * option (`locale`, `debug`).
 */
function readPath(target: Record<string, unknown>, path: string): unknown {
  let node: Record<string, unknown> | undefined = target;
  const parts = path.split('.');
  for (const part of parts.slice(0, -1)) node = node?.[part] as Record<string, unknown> | undefined;
  return node?.[parts.at(-1)!];
}

/** A `DeepPartial` carrying exactly one option, at whatever depth it lives. */
function partialAt(path: string, value: unknown): never {
  const parts = path.split('.');
  let built: unknown = value;
  for (const part of parts.reverse()) built = { [part]: built };
  return built as never;
}

/** One accepted-by-the-resolver raw value per `OptionKind`, distinct from the default. */
function sampleValueFor(spec: OptionSpec): { raw: string; resolved: unknown } {
  switch (spec.kind) {
    case 'enum': {
      const other = (spec.values ?? []).find((value) => value !== spec.default) ?? (spec.values ?? [])[0]!;
      return { raw: other, resolved: other };
    }
    case 'locale': {
      // The accepted set is the LIVE registry, not a table on the row.
      const other = locales().find((value) => value !== spec.default) ?? locales()[0]!;
      return { raw: other, resolved: other };
    }
    case 'flag':
      return { raw: spec.default ? '0' : '1', resolved: !spec.default };
    case 'fraction':
      return { raw: '0.5', resolved: 0.5 };
    case 'pixels':
      return { raw: '48', resolved: 48 };
    case 'string':
      return { raw: 'sample', resolved: 'sample' };
    case 'list': {
      const first = (spec.values ?? [])[0]!;
      return { raw: first, resolved: [first] };
    }
    case 'endpoint':
      return { raw: 'https://stats.example/player', resolved: 'https://stats.example/player' };
    case 'switch':
      return { raw: 'off', resolved: 'off' };
    case 'temperature':
      return { raw: '3000', resolved: 3000 };
  }
}

/**
 * The sink every `resolve` call below is given, and the lines it collected.
 *
 * `resolveViewerOptions` reports an invalid option through `options.onLog`
 * (`shared/logger.ts`), so a test reads what it said by INJECTING a sink
 * rather than by patching the process console — which is why there is no
 * `afterEach` here putting anything back.
 */
const logged = collectLog();
const warnings = logged.messages;

beforeEach(logged.clear);

/** `resolveViewerOptions` with this file's sink attached. */
function resolve(partial?: ViewerOptionsInput): ViewerOptions {
  return resolveViewerOptions({ ...partial, onLog: logged.sink });
}

describe('resolveViewerOptions', () => {
  test('with nothing given it is the documented default: 360, mini-map on, bar on, input pauses', () => {
    expect(resolve()).toEqual({
      view: { mode: 'orbit', minimap: true },
      tour: { mode: 'play', start: 0, progressBar: true, pauseOnInput: true },
      doors: { interactive: true, autoOpen: true },
      interiors: { selector: true },
      chrome: { brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true },
      fullscreenButton: { show: false, right: 32, top: 32 },
      readonly: false,
      capture: { disclosure: { caption: true, text: undefined } },
      plan: { labels: true, dimensions: true, camera: true },
      locale: 'en',
      motion: 'auto',
      interaction: 'full',
      select: false,
      slots: [],
      edits: 'local',
      debug: DEFAULT_VIEWER_OPTIONS.debug,
      scene: { url: undefined },
      offers: { url: undefined },
      analytics: { mode: 'on', endpoint: undefined },
      settings: { show: false, side: 'end' },
      lighting: { temperature: 5000, hdri: {} },
      onLog: logged.sink,
    });
    // The tour only engages at start in `view.mode: 'tour'`; `tour.mode` says
    // what an engaged tour then does.
    expect(DEFAULT_VIEWER_OPTIONS.view.mode).toBe('orbit');
    expect(DEFAULT_VIEWER_OPTIONS.tour.mode).toBe('play');
    expect(warnings()).toEqual([]);
  });

  test('deep-merges a partial without dropping its siblings', () => {
    const resolved = resolve({ tour: { mode: 'paused', start: 0.25 } });
    expect(resolved.tour).toEqual({ mode: 'paused', start: 0.25, progressBar: true, pauseOnInput: true });
    expect(warnings()).toEqual([]);
  });

  test('never hands back the defaults object itself', () => {
    const resolved = resolve();
    resolved.tour.start = 0.9;
    expect(DEFAULT_VIEWER_OPTIONS.tour.start).toBe(0);
  });

  test('an out-of-range or non-numeric start falls back to 0 with a warning', () => {
    expect(resolve({ tour: { start: 1.5 } }).tour.start).toBe(0);
    expect(resolve({ tour: { start: Number.NaN } }).tour.start).toBe(0);
    expect(resolve({ tour: { start: -0.2 } }).tour.start).toBe(0);
    expect(warnings().length).toBe(3);
    expect(warnings().every((line) => line.includes('tour.start'))).toBe(true);
  });

  test('an unknown mode or a non-boolean flag falls back with a warning', () => {
    const resolved = resolve({
      tour: {
        mode: 'autoplay' as unknown as 'play',
        progressBar: 'yes' as unknown as boolean,
        pauseOnInput: 0 as unknown as boolean,
      },
    });
    expect(resolved.tour).toEqual({ mode: 'play', start: 0, progressBar: true, pauseOnInput: true });
    expect(warnings().length).toBe(3);
  });

  test('unknown keys are ignored', () => {
    const resolved = resolve({ tour: { mode: 'off' }, nowhere: { hidden: true } } as never);
    expect(resolved).toEqual({
      view: { mode: 'orbit', minimap: true },
      tour: { mode: 'off', start: 0, progressBar: true, pauseOnInput: true },
      doors: { interactive: true, autoOpen: true },
      interiors: { selector: true },
      chrome: { brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true },
      fullscreenButton: { show: false, right: 32, top: 32 },
      readonly: false,
      capture: { disclosure: { caption: true, text: undefined } },
      plan: { labels: true, dimensions: true, camera: true },
      locale: 'en',
      motion: 'auto',
      interaction: 'full',
      select: false,
      slots: [],
      edits: 'local',
      debug: DEFAULT_VIEWER_OPTIONS.debug,
      scene: { url: undefined },
      offers: { url: undefined },
      analytics: { mode: 'on', endpoint: undefined },
      settings: { show: false, side: 'end' },
      lighting: { temperature: 5000, hdri: {} },
      onLog: logged.sink,
    });
    expect(Object.keys(resolved)).toEqual([
      'view',
      'tour',
      'doors',
      'interiors',
      'chrome',
      'fullscreenButton',
      'readonly',
      'capture',
      'plan',
      'locale',
      'motion',
      'interaction',
      'select',
      'slots',
      'edits',
      'debug',
      'scene',
      'offers',
      'analytics',
      'settings',
      'lighting',
      'onLog',
    ]);
  });

  test('the host objects of a scene source are copied through, not validated', () => {
    const repository = { load: async () => ({}) };
    const document = { schemaVersion: '2.0' };
    const resolved = resolve({ scene: { repository, document, url: '/a.json' } });
    // Same identity: a live loader cannot survive being re-created.
    expect(resolved.scene.repository).toBe(repository);
    expect(resolved.scene.document).toBe(document);
    expect(resolved.scene.url).toBe('/a.json');
    expect(warnings()).toEqual([]);
  });

  test('a hostile key cannot reach Object.prototype', () => {
    resolve(JSON.parse('{"__proto__": {"polluted": true}}') as never);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('view', () => {
  test('every mode of the bar is accepted, in either adapter', () => {
    for (const mode of ['plan2d', 'plan3d', 'orbit', 'walk', 'tour'] as const) {
      expect(resolve(optionsFromQuery(`?view=${mode}`)).view.mode).toBe(mode);
      expect(resolve(optionsFromDataset({ view: mode })).view.mode).toBe(mode);
    }
    expect(warnings()).toEqual([]);
  });

  test('an unknown mode falls back to 360 with one warning', () => {
    expect(resolve({ view: { mode: 'sideways' as never } }).view.mode).toBe('orbit');
    expect(resolve(optionsFromQuery('?view=plan4d')).view.mode).toBe('orbit');
    expect(warnings().length).toBe(2);
    expect(warnings().every((line) => line.includes('view.mode'))).toBe(true);
  });

  test('the mini-map switch is parsed from the query and the dataset', () => {
    expect(optionsFromQuery('?view=walk&minimap=0')).toEqual({ view: { mode: 'walk', minimap: false } });
    expect(optionsFromDataset({ view: 'walk', minimap: '1' })).toEqual({ view: { mode: 'walk', minimap: true } });
    expect(resolve(optionsFromQuery('?minimap=0')).view).toEqual({ mode: 'orbit', minimap: false });
    expect(warnings()).toEqual([]);
  });

  test('garbage in the mini-map flag is caught by the resolver, not the adapter', () => {
    expect(resolve(optionsFromQuery('?minimap=maybe')).view.minimap).toBe(true);
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('view.minimap');
  });

  test('it rides along with the tour options instead of replacing them', () => {
    const resolved = resolve(optionsFromQuery('?view=tour&tour=paused&minimap=0'));
    expect(resolved.view).toEqual({ mode: 'tour', minimap: false });
    expect(resolved.tour.mode).toBe('paused');
  });
});

describe('optionsFromQuery', () => {
  test('reads the four documented parameters', () => {
    expect(optionsFromQuery('?tour=paused&tourStart=0.25&tourBar=0&tourInput=1')).toEqual({
      tour: { mode: 'paused', start: 0.25, progressBar: false, pauseOnInput: true },
    });
  });

  test('an empty or unrelated query asks for nothing', () => {
    expect(optionsFromQuery('')).toEqual({});
    expect(optionsFromQuery('?nothing=1')).toEqual({});
    // `?debug=1` IS an option now: it turns the authoring calls on.
    expect(optionsFromQuery('?debug=1')).toEqual({ debug: true });
  });

  test('accepts a search string with or without the leading question mark', () => {
    expect(optionsFromQuery('tour=off')).toEqual({ tour: { mode: 'off' } });
  });

  test('true/false spellings are accepted for the flags', () => {
    expect(optionsFromQuery('?tourBar=false&tourInput=true').tour).toEqual({ progressBar: false, pauseOnInput: true });
  });

  test('garbage survives the parser and is caught by the resolver', () => {
    const resolved = resolve(optionsFromQuery('?tour=sideways&tourStart=abc&tourBar=maybe'));
    expect(resolved.tour).toEqual({ mode: 'play', start: 0, progressBar: true, pauseOnInput: true });
    expect(warnings().length).toBe(3);
  });
});

describe('optionsFromDataset', () => {
  test('reads the data-tour-* attributes of the root element', () => {
    const dataset = { tour: 'paused', tourStart: '0.5', tourBar: '0', tourInput: '0' } as unknown as DOMStringMap;
    expect(optionsFromDataset(dataset)).toEqual({
      tour: { mode: 'paused', start: 0.5, progressBar: false, pauseOnInput: false },
    });
  });

  test('an element with no data attributes asks for nothing', () => {
    expect(optionsFromDataset({})).toEqual({});
  });
});

describe('doors.interactive', () => {
  test('defaults to on and can be switched off through either adapter', () => {
    expect(resolve().doors.interactive).toBe(true);
    expect(optionsFromQuery('?doors=0')).toEqual({ doors: { interactive: false } });
    expect(optionsFromDataset({ doors: '0' })).toEqual({ doors: { interactive: false } });
    expect(resolve(optionsFromQuery('?doors=0')).doors.interactive).toBe(false);
    expect(warnings()).toEqual([]);
  });

  test('doors.autoOpen defaults to on and has its own switch', () => {
    expect(resolve().doors.autoOpen).toBe(true);
    expect(optionsFromQuery('?doorsAuto=0')).toEqual({ doors: { autoOpen: false } });
    expect(optionsFromDataset({ doorsAuto: '0' })).toEqual({ doors: { autoOpen: false } });
    expect(resolve(optionsFromQuery('?doorsAuto=0')).doors.autoOpen).toBe(false);
    // The two switches are independent: interactive doors that do not open
    // themselves are the pre-automation viewer.
    expect(resolve(optionsFromQuery('?doorsAuto=0')).doors.interactive).toBe(true);
    expect(resolve(optionsFromQuery('?doors=0')).doors.autoOpen).toBe(true);
    expect(optionsFromQuery('?view=walk')).not.toHaveProperty('doors');
    expect(warnings()).toEqual([]);
  });

  test('both switches ride in one partial', () => {
    expect(optionsFromQuery('?doors=1&doorsAuto=0')).toEqual({ doors: { interactive: true, autoOpen: false } });
  });

  test('it rides along with the tour options instead of replacing them', () => {
    const resolved = resolve(optionsFromQuery('?tour=off&doors=0'));
    expect(resolved.tour.mode).toBe('off');
    expect(resolved.doors.interactive).toBe(false);
  });

  test('garbage is caught by the resolver, not by the adapter', () => {
    expect(resolve({ doors: { interactive: 'yes' as unknown as boolean } }).doors.interactive).toBe(true);
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('doors.interactive');
  });

  test('garbage in autoOpen is caught the same way', () => {
    expect(resolve({ doors: { autoOpen: 'yes' as unknown as boolean } }).doors.autoOpen).toBe(true);
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('doors.autoOpen');
  });
});

describe('reduced motion', () => {
  test('motion defaults to auto, and an unspecified tour.mode stays play with no reduced-motion input', () => {
    const resolved = resolveViewerOptions({ onLog: logged.sink });
    expect(resolved.motion).toBe('auto');
    expect(resolved.tour.mode).toBe('play');
    expect(warnings()).toEqual([]);
  });

  test("motion: 'auto' plus a reduced-motion environment downgrades an unspecified tour.mode to paused", () => {
    const resolved = resolveViewerOptions({ onLog: logged.sink }, { reducedMotion: true });
    expect(resolved.tour.mode).toBe('paused');
    expect(resolved.motion).toBe('auto');
  });

  test('a HOST-SET tour.mode is never overridden by reduced motion', () => {
    const resolved = resolveViewerOptions({ tour: { mode: 'play' }, onLog: logged.sink }, { reducedMotion: true });
    expect(resolved.tour.mode).toBe('play');
  });

  test("motion: 'reduced' downgrades tour.mode even when the environment says full motion", () => {
    const resolved = resolveViewerOptions({ motion: 'reduced', onLog: logged.sink }, { reducedMotion: false });
    expect(resolved.tour.mode).toBe('paused');
  });

  test("motion: 'full' keeps tour.mode: 'play' even when the environment prefers reduced motion", () => {
    const resolved = resolveViewerOptions({ motion: 'full', onLog: logged.sink }, { reducedMotion: true });
    expect(resolved.tour.mode).toBe('play');
  });

  test('reduced motion never touches an explicit tour.mode of paused or off', () => {
    expect(resolveViewerOptions({ motion: 'reduced', tour: { mode: 'off' }, onLog: logged.sink }, {}).tour.mode).toBe('off');
    expect(resolveViewerOptions({ motion: 'reduced', tour: { mode: 'paused' }, onLog: logged.sink }, {}).tour.mode).toBe('paused');
  });

  test('an omitted environment behaves exactly like { reducedMotion: false }', () => {
    expect(resolveViewerOptions({ motion: 'auto', onLog: logged.sink }).tour.mode).toBe('play');
  });

  test('?motion= and data-motion answer through the ordinary adapters', () => {
    expect(optionsFromQuery('?motion=reduced')).toEqual({ motion: 'reduced' });
    expect(optionsFromDataset({ motion: 'full' })).toEqual({ motion: 'full' });
  });

  test('garbage falls back to auto, reported once', () => {
    expect(resolve({ motion: 'sometimes' as unknown as ViewerOptions['motion'] }).motion).toBe('auto');
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('motion');
  });
});

describe('the interior-preset selector option', () => {
  test('defaults to on and takes a boolean', () => {
    expect(resolve().interiors).toEqual({ selector: true });
    expect(resolve({ interiors: { selector: false } }).interiors).toEqual({ selector: false });
    expect(warnings()).toEqual([]);
  });

  test('a non-boolean falls back to on with a warning naming the path', () => {
    expect(resolve({ interiors: { selector: 'no' as unknown as boolean } }).interiors).toEqual({ selector: true });
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('interiors.selector');
  });

  test('?presets=0 turns it off and leaves the tour alone', () => {
    expect(optionsFromQuery('?presets=0')).toEqual({ interiors: { selector: false } });
    expect(optionsFromQuery('?presets=1&tour=off')).toEqual({
      tour: { mode: 'off' },
      interiors: { selector: true },
    });
  });

  test('data-presets is the embedding spelling', () => {
    expect(optionsFromDataset({ presets: 'false' })).toEqual({ interiors: { selector: false } });
    expect(optionsFromDataset({})).toEqual({});
  });
});

describe('chrome.status, chrome.modeSwitcher, chrome.hint', () => {
  test('all three default to on', () => {
    expect(resolve().chrome).toEqual({ brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: true });
    expect(warnings()).toEqual([]);
  });

  test('each takes a boolean independently of the others', () => {
    const resolved = resolve({ chrome: { status: false, modeSwitcher: false, hint: false } });
    expect(resolved.chrome).toEqual({ brand: true, controls: true, status: false, modeSwitcher: false, hint: false, autoHide: true });
    expect(warnings()).toEqual([]);
  });

  test("hint is its own flag: controls:false leaves hint's own value alone", () => {
    expect(resolve({ chrome: { controls: false } }).chrome.hint).toBe(true);
    expect(resolve({ chrome: { controls: false, hint: false } }).chrome.hint).toBe(false);
  });

  test('optionsFromRecord({ chrome-status: 0 }) turns off only the status pill', () => {
    expect(optionsFromRecord((key) => (key === 'chromeStatus' ? '0' : undefined), 'attr')).toEqual({
      chrome: { status: false },
    });
    expect(optionsFromDataset({ chromeStatus: '0' })).toEqual({ chrome: { status: false } });
    expect(optionsFromQuery('?chromeStatus=0')).toEqual({ chrome: { status: false } });
  });

  test('the three attribute spellings are chrome-status, chrome-mode-switcher and chrome-hint', () => {
    expect(OPTION_SCHEMA['chrome.status'].attr).toBe('chrome-status');
    expect(OPTION_SCHEMA['chrome.modeSwitcher'].attr).toBe('chrome-mode-switcher');
    expect(OPTION_SCHEMA['chrome.hint'].attr).toBe('chrome-hint');
    expect(OPTION_SCHEMA['chrome.status'].query).toBe('chromeStatus');
    expect(OPTION_SCHEMA['chrome.modeSwitcher'].query).toBe('chromeModeSwitcher');
    expect(OPTION_SCHEMA['chrome.hint'].query).toBe('chromeHint');
  });
});

describe('chrome.autoHide', () => {
  test('it defaults to true, so every host that says nothing keeps the idle collapse', () => {
    expect(resolve().chrome.autoHide).toBe(true);
    expect(DEFAULT_VIEWER_OPTIONS.chrome.autoHide).toBe(true);
    expect(warnings()).toEqual([]);
  });

  test('false is taken and leaves every visibility flag alone', () => {
    const resolved = resolve({ chrome: { autoHide: false } });
    expect(resolved.chrome).toEqual({ brand: true, controls: true, status: true, modeSwitcher: true, hint: true, autoHide: false });
    expect(warnings()).toEqual([]);
  });

  test('the spellings are chromeAutoHide and chrome-auto-hide, and both adapters read them', () => {
    expect(OPTION_SCHEMA['chrome.autoHide'].attr).toBe('chrome-auto-hide');
    expect(OPTION_SCHEMA['chrome.autoHide'].query).toBe('chromeAutoHide');
    expect(optionsFromDataset({ chromeAutoHide: '0' })).toEqual({ chrome: { autoHide: false } });
    expect(optionsFromQuery('?chromeAutoHide=0')).toEqual({ chrome: { autoHide: false } });
    expect(resolve(optionsFromQuery('?chromeAutoHide=0')).chrome.autoHide).toBe(false);
  });

  test('a non-boolean falls back to true with a warning naming the path', () => {
    expect(resolve({ chrome: { autoHide: 'sometimes' as unknown as boolean } }).chrome.autoHide).toBe(true);
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('chrome.autoHide');
  });

  test('the compound chrome attribute never touches it: it says what is on screen, not how the bar behaves', () => {
    expect(optionsFromDataset({ chrome: 'false' })).toEqual({
      chrome: { brand: false, controls: false, status: false, modeSwitcher: false, hint: false },
    });
    expect(resolve(optionsFromDataset({ chrome: 'false', controls: 'true' })).chrome.autoHide).toBe(true);
  });

  test('no overlay preset decides it either; each leaves the default standing', () => {
    for (const overlay of ['none', 'kiosk', 'embed', 'unbranded'] as const) {
      expect({ overlay, autoHide: resolve(optionsFromQuery(`?overlay=${overlay}`)).chrome.autoHide }).toEqual({ overlay, autoHide: true });
    }
  });
});

describe('the compound chrome attribute (all: unset)', () => {
  test('chrome="false" zeroes every chrome.* flag, and an individual attribute after it still wins', () => {
    expect(optionsFromDataset({ chrome: 'false', chromeStatus: 'true' })).toEqual({
      chrome: { brand: false, controls: false, status: true, modeSwitcher: false, hint: false },
    });
    expect(optionsFromQuery('?chrome=0&chromeStatus=1')).toEqual({
      chrome: { brand: false, controls: false, status: true, modeSwitcher: false, hint: false },
    });
  });

  test('resolved: chrome="false" chrome-status="true" leaves only status on', () => {
    const resolved = resolve(optionsFromDataset({ chrome: 'false', chromeStatus: 'true' }));
    expect(resolved.chrome).toEqual({ brand: false, controls: false, status: true, modeSwitcher: false, hint: false, autoHide: true });
  });

  test('chrome="true" (and 1) is a no-op: the individual attributes decide everything', () => {
    expect(optionsFromDataset({ chrome: 'true', brand: 'false' })).toEqual({ chrome: { brand: false } });
    expect(optionsFromQuery('?chrome=1&controls=0')).toEqual({ chrome: { controls: false } });
  });

  test('chrome absent contributes nothing', () => {
    expect(optionsFromDataset({ brand: 'false' })).toEqual({ chrome: { brand: false } });
  });

  test('object callers set every chrome.* field directly; there is no boolean chrome field to collide with', () => {
    expect(resolve({ chrome: { brand: false, controls: false, status: false, modeSwitcher: false, hint: false } }).chrome).toEqual({
      brand: false,
      controls: false,
      status: false,
      modeSwitcher: false,
      hint: false,
      autoHide: true,
    });
  });

  test('an unknown compound value is reported through the given log sink with option-invalid and ignored', () => {
    const probe = collectLog();
    expect(optionsFromQuery('?chrome=sideways', probe.sink)).toEqual({});
    expect(probe.codes()).toEqual(['option-invalid']);
    expect(probe.messages()[0]).toContain('chrome');
    probe.clear();
    expect(optionsFromDataset({ chrome: 'sideways' }, probe.sink)).toEqual({});
    expect(probe.codes()).toEqual(['option-invalid']);
  });

  test('COMPOUND_SCHEMA names the query and attribute spelling', () => {
    expect(COMPOUND_SCHEMA.chrome.query).toBe('chrome');
    expect(COMPOUND_SCHEMA.chrome.attr).toBe('chrome');
    expect(COMPOUND_SCHEMA.chrome.default).toBe(true);
  });
});

describe('interaction', () => {
  test('defaults to full', () => {
    expect(resolve().interaction).toBe('full');
    expect(warnings()).toEqual([]);
  });

  test('every documented value is accepted, in either adapter', () => {
    for (const value of ['full', 'none', 'passive'] as const) {
      expect(resolve({ interaction: value }).interaction).toBe(value);
      expect(resolve(optionsFromQuery(`?interaction=${value}`)).interaction).toBe(value);
      expect(resolve(optionsFromDataset({ interaction: value })).interaction).toBe(value);
    }
    expect(warnings()).toEqual([]);
  });

  test('an unknown value falls back to full with one warning', () => {
    expect(resolve({ interaction: 'sideways' as unknown as ViewerOptions['interaction'] }).interaction).toBe('full');
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('interaction');
  });

  test('?interaction= and data-interaction answer through the ordinary adapters', () => {
    expect(optionsFromQuery('?interaction=none')).toEqual({ interaction: 'none' });
    expect(optionsFromDataset({ interaction: 'passive' })).toEqual({ interaction: 'passive' });
  });
});

describe('overlay presets', () => {
  test('none is a no-op', () => {
    expect(optionsFromQuery('?overlay=none')).toEqual({});
    expect(resolve(optionsFromQuery('?overlay=none'))).toEqual(resolve());
  });

  test('each documented preset row is exactly what it merges', () => {
    expect(optionsFromDataset({ overlay: 'kiosk' })).toEqual({
      chrome: { controls: false, brand: false, status: false, modeSwitcher: false, hint: false },
      interaction: 'none',
    });
    expect(optionsFromDataset({ overlay: 'embed' })).toEqual({
      chrome: { controls: false, brand: false },
      tour: { progressBar: true, pauseOnInput: false },
    });
  });

  test('resolved: kiosk turns off every chrome.* flag and sets interaction none', () => {
    const resolved = resolve(optionsFromQuery('?overlay=kiosk'));
    expect(resolved.chrome).toEqual({ brand: false, controls: false, status: false, modeSwitcher: false, hint: false, autoHide: true });
    expect(resolved.interaction).toBe('none');
  });

  test('resolved: embed hides controls and brand but keeps the progress bar and stops it pausing on input', () => {
    const resolved = resolve(optionsFromQuery('?overlay=embed'));
    expect(resolved.chrome.controls).toBe(false);
    expect(resolved.chrome.brand).toBe(false);
    expect(resolved.tour.progressBar).toBe(true);
    expect(resolved.tour.pauseOnInput).toBe(false);
    // Untouched by the preset: still their defaults.
    expect(resolved.chrome.status).toBe(true);
    expect(resolved.chrome.modeSwitcher).toBe(true);
  });

  test('an individual attribute after the preset still wins', () => {
    expect(optionsFromQuery('?overlay=kiosk&chromeStatus=1')).toEqual({
      chrome: { controls: false, brand: false, status: true, modeSwitcher: false, hint: false },
      interaction: 'none',
    });
    expect(optionsFromQuery('?overlay=kiosk&interaction=passive')).toEqual({
      chrome: { controls: false, brand: false, status: false, modeSwitcher: false, hint: false },
      interaction: 'passive',
    });
  });

  test('overlay composes with the compound chrome: the LATER pre-pass wins on a conflict (overlay -> chrome -> individual)', () => {
    // embed leaves status/modeSwitcher/hint alone; chrome="false" zeroes them too.
    expect(optionsFromQuery('?overlay=embed&chrome=0')).toEqual({
      chrome: { controls: false, brand: false, status: false, modeSwitcher: false, hint: false },
      tour: { progressBar: true, pauseOnInput: false },
    });
  });

  test('an unrecognised overlay value is reported through the given log sink and ignored', () => {
    const probe = collectLog();
    expect(optionsFromQuery('?overlay=sideways', probe.sink)).toEqual({});
    expect(probe.codes()).toEqual(['option-invalid']);
    expect(probe.messages()[0]).toContain('overlay');
  });

  test('COMPOUND_SCHEMA and OVERLAY_PRESETS agree on the four values', () => {
    expect(COMPOUND_SCHEMA.overlay.values).toEqual(['none', 'kiosk', 'embed', 'unbranded']);
    expect(Object.keys(OVERLAY_PRESETS).sort()).toEqual(['embed', 'kiosk', 'none', 'unbranded']);
    expect(COMPOUND_SCHEMA.overlay.default).toBe('none');
  });
});

describe('unbranded overlay (the strictest portal-embed rules)', () => {
  test('the documented preset row is exactly what it merges', () => {
    expect(optionsFromDataset({ overlay: 'unbranded' })).toEqual({
      chrome: { brand: false, status: false, modeSwitcher: false, hint: false, controls: true },
      tour: { mode: 'paused', progressBar: true, pauseOnInput: true },
      view: { minimap: true },
      interaction: 'full',
    });
  });

  test('resolved: hides brand, status pill, mode switcher and hint, keeps controls, does not autoplay, keeps the minimap and full interaction', () => {
    const resolved = resolve(optionsFromQuery('?overlay=unbranded'));
    expect(resolved.chrome).toEqual({ brand: false, controls: true, status: false, modeSwitcher: false, hint: false, autoHide: true });
    expect(resolved.tour.mode).toBe('paused');
    expect(resolved.tour.progressBar).toBe(true);
    expect(resolved.tour.pauseOnInput).toBe(true);
    expect(resolved.view.minimap).toBe(true);
    expect(resolved.interaction).toBe('full');
  });

  test('?unbranded=1 is exactly ?overlay=unbranded', () => {
    expect(optionsFromQuery('?unbranded=1')).toEqual(optionsFromQuery('?overlay=unbranded'));
    expect(optionsFromDataset({ unbranded: '1' })).toEqual(optionsFromDataset({ overlay: 'unbranded' }));
  });

  test('unbranded=0 (or false) is a no-op: the flag only ever turns the preset ON', () => {
    expect(optionsFromQuery('?unbranded=0')).toEqual({});
    expect(optionsFromDataset({ unbranded: 'false' })).toEqual({});
  });

  test('an explicit overlay= always wins over the unbranded flag, in either order', () => {
    expect(optionsFromQuery('?unbranded=1&overlay=kiosk')).toEqual(optionsFromQuery('?overlay=kiosk'));
    expect(optionsFromQuery('?overlay=kiosk&unbranded=1')).toEqual(optionsFromQuery('?overlay=kiosk'));
  });

  test('an individual attribute after the flag still wins', () => {
    expect(optionsFromQuery('?unbranded=1&chromeStatus=1')).toEqual({
      chrome: { brand: false, status: true, modeSwitcher: false, hint: false, controls: true },
      tour: { mode: 'paused', progressBar: true, pauseOnInput: true },
      view: { minimap: true },
      interaction: 'full',
    });
  });

  test('an unrecognised unbranded value is reported through the given log sink and ignored', () => {
    const probe = collectLog();
    expect(optionsFromQuery('?unbranded=sideways', probe.sink)).toEqual({});
    expect(probe.codes()).toEqual(['option-invalid']);
    expect(probe.messages()[0]).toContain('unbranded');
  });

  test('COMPOUND_SCHEMA.unbranded is a flag, off by default, spelled the same in the query and the attribute', () => {
    expect(COMPOUND_SCHEMA.unbranded).toEqual({ kind: 'flag', default: false, query: 'unbranded', attr: 'unbranded' });
  });
});

describe('OPTION_SCHEMA', () => {
  test('describes exactly the options the contract documents', () => {
    expect(Object.keys(OPTION_SCHEMA).sort()).toEqual(
      [
        'view.mode',
        'view.minimap',
        'tour.mode',
        'tour.start',
        'tour.progressBar',
        'tour.pauseOnInput',
        'doors.interactive',
        'doors.autoOpen',
        'interiors.selector',
        'chrome.brand',
        'chrome.controls',
        'chrome.status',
        'chrome.modeSwitcher',
        'chrome.hint',
        'chrome.autoHide',
        'fullscreenButton.show',
        'fullscreenButton.right',
        'fullscreenButton.top',
        'readonly',
        'capture.disclosure.caption',
        'capture.disclosure.text',
        'plan.labels',
        'plan.dimensions',
        'plan.camera',
        'locale',
        'motion',
        'interaction',
        'select',
        'slots',
        'edits',
        'debug',
        'scene.url',
        'offers.url',
        'analytics.mode',
        'analytics.endpoint',
        'settings.show',
        'settings.side',
        'lighting.temperature',
      ].sort(),
    );
  });

  for (const [path, spec] of Object.entries(OPTION_SCHEMA)) {
    describe(path, () => {
      test('absent -> default, no warning', () => {
        expect(readPath(resolve(), path)).toEqual(spec.default);
        expect(warnings()).toEqual([]);
      });

      test('valid -> accepted', () => {
        const { resolved } = sampleValueFor(spec);
        expect(readPath(resolve(partialAt(path, resolved)), path)).toEqual(resolved);
        expect(warnings()).toEqual([]);
      });

      test('invalid -> default (an endpoint: off) + one warning naming the path', () => {
        const bogus = spec.kind === 'string' ? { nope: true } : 'not-a-valid-value-9x';
        // A refused endpoint override must never fall back to the DEFAULT endpoint.
        // A switch fails CLOSED: anything it does not know is off.
        const closed = spec.kind === 'endpoint' ? '' : spec.kind === 'switch' ? 'off' : spec.default;
        expect(readPath(resolve(partialAt(path, bogus)), path)).toEqual(closed);
        expect(warnings().length).toBe(1);
        expect(warnings()[0]).toContain(path);
      });

      test('optionsFromQuery and optionsFromDataset agree', () => {
        const { raw } = sampleValueFor(spec);
        const query = optionsFromQuery(`?${spec.query}=${encodeURIComponent(raw)}`);
        const datasetKey = spec.attr.replaceAll(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        const dataset = optionsFromDataset({ [datasetKey]: raw });
        expect(readPath(query as Record<string, unknown>, path)).toEqual(readPath(dataset as Record<string, unknown>, path));
        // And both resolve to the same value once validated.
        expect(readPath(resolve(query), path)).toEqual(readPath(resolve(dataset), path));
      });
    });
  }
});

describe('the locale option', () => {
  test('accepts a BCP-47 tag by its primary subtag', () => {
    expect(resolve({ locale: 'ru-RU' }).locale).toBe('ru');
    expect(resolve(optionsFromQuery('?lang=RU')).locale).toBe('ru');
    expect(warnings()).toEqual([]);
  });

  test('accepts a locale the HOST registered, which no build-time table could', () => {
    // Guards against `?lang=` being validated against a literal list, which
    // would leave a host that added a language unable to select it.
    const catalogue = Object.fromEntries(MESSAGE_KEYS.map((key) => [key, `qac:${key}`])) as Record<MessageKey, string>;
    registerLocale('qac', catalogue);
    expect(locales()).toContain('qac');
    expect(resolve(optionsFromQuery('?lang=qac')).locale).toBe('qac');
    expect(warnings()).toEqual([]);
  });

  test('a language nobody registered falls back with one warning', () => {
    expect(resolve({ locale: 'qzz' }).locale).toBe('en');
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('locale');
  });
});

describe('DeepPartial', () => {
  test('leaves a function alone rather than turning it into `{}`', () => {
    // Guards against `DeepPartial<(entry) => void>` collapsing to `{}`, a type
    // that accepts any object and rejects nothing, so `onLog: {}` would type-check.
    // The assertion is a COMPILE-time one: the two
    // declarations below are the test, and `@ts-expect-error` fails the build
    // if the second one ever starts type-checking.
    const sink: DeepPartial<ViewerOptions>['onLog'] = (entry) => {
      expect(typeof entry.code).toBe('string');
    };
    expect(typeof sink).toBe('function');
    // @ts-expect-error a number is not a sink, and the type has to say so
    const wrong: DeepPartial<ViewerOptions>['onLog'] = 42;
    expect(typeof wrong).toBe('number');
  });

  test('leaves `scene` whole: its document is the host’s own object', () => {
    const document = { schemaVersion: '2.0' };
    const scene: DeepPartial<ViewerOptions>['scene'] = { document, url: '/a.json' };
    expect(scene?.document).toBe(document);
  });

  test('still makes every ordinary leaf optional, section by section', () => {
    const partial: DeepPartial<ViewerOptions> = { tour: { start: 0.5 }, view: {} };
    expect(resolve(partial).tour.start).toBe(0.5);
    expect(resolve(partial).view.mode).toBe('orbit');
  });
});

describe('slots (the first `kind: list` option)', () => {
  test('defaults to empty: nobody asked for a box, so nothing is built', () => {
    expect(resolve().slots).toEqual([]);
    expect(warnings()).toEqual([]);
  });

  test('a list of names passes through as it is', () => {
    expect(resolve({ slots: ['bottom-center', 'selection-anchor'] }).slots).toEqual(['bottom-center', 'selection-anchor']);
    expect(warnings()).toEqual([]);
  });

  test('every documented name is accepted', () => {
    expect(resolve({ slots: [...SLOT_NAMES] }).slots).toEqual([...SLOT_NAMES]);
    expect(warnings()).toEqual([]);
  });

  test('one unknown name refuses the whole list, once, naming the path', () => {
    expect(resolve({ slots: ['nope'] as never }).slots).toEqual([]);
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('slots');
  });

  test('a bare string is not a list and is refused once', () => {
    expect(resolve({ slots: 'bottom-center' as never }).slots).toEqual([]);
    expect(warnings().length).toBe(1);
  });

  test('never hands back the defaults array itself', () => {
    const resolved = resolve();
    expect(resolved.slots).not.toBe(DEFAULT_VIEWER_OPTIONS.slots);
  });

  test('?slots= is a comma-separated list, with the spaces a hand-written URL carries', () => {
    expect(optionsFromQuery('?slots=bottom-center,selection-anchor')).toEqual({ slots: ['bottom-center', 'selection-anchor'] });
    expect(optionsFromQuery('?slots=bottom-center, top-right ')).toEqual({ slots: ['bottom-center', 'top-right'] });
  });

  test('an empty ?slots= asks for no box, and is not a warning', () => {
    expect(optionsFromQuery('?slots=')).toEqual({ slots: [] });
    expect(resolve(optionsFromQuery('?slots=')).slots).toEqual([]);
    expect(warnings()).toEqual([]);
  });

  test('data-slots is the embedding spelling', () => {
    expect(optionsFromDataset({ slots: 'modal-root' })).toEqual({ slots: ['modal-root'] });
    expect(resolve(optionsFromDataset({ slots: 'modal-root' })).slots).toEqual(['modal-root']);
  });

  /**
   * HTML turns a valueless boolean attribute into `'true'`, which is not a
   * slot name — so `<jeex-viewer slots>` asks for nothing and says so once.
   */
  test('a valueless attribute reads as `true`, which is one warning and no box', () => {
    expect(resolve(optionsFromDataset({ slots: 'true' })).slots).toEqual([]);
    expect(warnings().length).toBe(1);
  });

  test('a near-miss key is still ignored', () => {
    expect(optionsFromQuery('?slot=bottom-center')).toEqual({});
  });
});

describe('edits', () => {
  test('defaults to local: a published tour behaves exactly as it did', () => {
    expect(resolve().edits).toBe('local');
    expect(warnings()).toEqual([]);
  });

  test('every documented mode is accepted, in either adapter', () => {
    for (const value of ['local', 'emit', 'off'] as const) {
      expect(resolve({ edits: value }).edits).toBe(value);
      expect(resolve(optionsFromQuery(`?edits=${value}`)).edits).toBe(value);
      expect(resolve(optionsFromDataset({ edits: value })).edits).toBe(value);
    }
    expect(warnings()).toEqual([]);
  });

  test('an unknown mode falls back to local with one warning', () => {
    expect(resolve(optionsFromQuery('?edits=maybe')).edits).toBe('local');
    expect(warnings().length).toBe(1);
    expect(warnings()[0]).toContain('edits');
  });

  test('?edits= and data-edits answer through the ordinary adapters', () => {
    expect(optionsFromQuery('?edits=emit')).toEqual({ edits: 'emit' });
    expect(optionsFromDataset({ edits: 'off' })).toEqual({ edits: 'off' });
  });
});

describe('fullscreenButton and readonly', () => {
  test('both are off by default and the button sits 32 px from the top-right corner', () => {
    const resolved = resolve();
    expect(resolved.fullscreenButton).toEqual({ show: false, right: 32, top: 32 });
    expect(resolved.readonly).toBe(false);
    expect(warnings()).toEqual([]);
  });

  test('the query and attribute spellings follow the documented table', () => {
    expect(OPTION_SCHEMA['fullscreenButton.show']).toMatchObject({ query: 'fullscreenButton', attr: 'fullscreen-button' });
    expect(OPTION_SCHEMA['fullscreenButton.right']).toMatchObject({ query: 'fullscreenButtonRight', attr: 'fullscreen-button-right' });
    expect(OPTION_SCHEMA['fullscreenButton.top']).toMatchObject({ query: 'fullscreenButtonTop', attr: 'fullscreen-button-top' });
    expect(OPTION_SCHEMA.readonly).toMatchObject({ query: 'readonly', attr: 'readonly' });
  });

  test('a query string turns the button and read-only mode on', () => {
    const resolved = resolve(optionsFromQuery('?controls=0&fullscreenButton=1&fullscreenButtonRight=12&fullscreenButtonTop=0&readonly=1'));
    expect(resolved.fullscreenButton).toEqual({ show: true, right: 12, top: 0 });
    expect(resolved.readonly).toBe(true);
    expect(resolved.chrome.controls).toBe(false);
    expect(warnings()).toEqual([]);
  });

  test('the element attributes say the same', () => {
    const resolved = resolve(
      optionsFromDataset({ fullscreenButton: 'true', fullscreenButtonRight: '24.5', fullscreenButtonTop: '40', readonly: 'true' }),
    );
    expect(resolved.fullscreenButton).toEqual({ show: true, right: 24.5, top: 40 });
    expect(resolved.readonly).toBe(true);
  });

  test('a negative, non-numeric, empty or infinite offset falls back to 32 with a warning naming the path', () => {
    expect(resolve({ fullscreenButton: { right: -1 } }).fullscreenButton.right).toBe(32);
    expect(resolve(optionsFromQuery('?fullscreenButtonTop=far')).fullscreenButton.top).toBe(32);
    expect(resolve({ fullscreenButton: { top: Number.POSITIVE_INFINITY } }).fullscreenButton.top).toBe(32);
    expect(resolve(optionsFromQuery('?fullscreenButtonRight=')).fullscreenButton.right).toBe(32);
    expect(warnings().length).toBe(4);
    expect(warnings()[0]).toContain('fullscreenButton.right');
    expect(warnings()[1]).toContain('fullscreenButton.top');
  });

  test('the JS options take `fullscreenButton: true | false` as shorthand for `{ show }`', () => {
    expect(resolve({ fullscreenButton: true }).fullscreenButton).toEqual({ show: true, right: 32, top: 32 });
    expect(resolve({ fullscreenButton: false }).fullscreenButton).toEqual({ show: false, right: 32, top: 32 });
    // The object form is unchanged, and the shorthand agrees with the query spelling.
    expect(resolve({ fullscreenButton: { show: true, top: 8 } }).fullscreenButton).toEqual({ show: true, right: 32, top: 8 });
    expect(resolve({ fullscreenButton: true })).toEqual(resolve(optionsFromQuery('?fullscreenButton=1')));
    expect(warnings()).toEqual([]);
  });

  test('the shorthand is the fullscreenButton section only: a boolean anywhere else answers no field', () => {
    expect(resolve({ chrome: false } as never).chrome.controls).toBe(true);
    expect(resolve({ tour: true } as never).tour.mode).toBe('play');
  });

  test('the compound chrome attribute and the overlay presets leave both alone', () => {
    const resolved = resolve(optionsFromQuery('?chrome=0&overlay=kiosk&fullscreenButton=1&readonly=1'));
    expect(resolved.fullscreenButton.show).toBe(true);
    expect(resolved.readonly).toBe(true);
    expect(resolve(optionsFromQuery('?chrome=0')).fullscreenButton.show).toBe(false);
  });
});

describe('analytics', () => {
  test('on by default, off by the attribute, the query or the object', () => {
    expect(resolve().analytics.mode).toBe('on');
    expect(resolve(optionsFromDataset({ analytics: 'off' })).analytics.mode).toBe('off');
    expect(resolve(optionsFromQuery('?analytics=off')).analytics.mode).toBe('off');
    expect(resolve({ analytics: { mode: 'off' } }).analytics.mode).toBe('off');
  });

  test('it fails closed: only an absent mode or exactly on is on, every other spelling is off', () => {
    expect(resolve({ analytics: { mode: 'on' } }).analytics.mode).toBe('on');
    expect(resolve(optionsFromDataset({ analytics: 'on' })).analytics.mode).toBe('on');
    const off: unknown[] = ['off', false, null, 'OFF', 'Off', 'false', '0', 'none', '', 'no', 0, {}];
    for (const value of off) {
      expect({ value, object: resolve({ analytics: { mode: value as 'off' } }).analytics.mode }).toEqual({ value, object: 'off' });
      // `analytics: {}` is an options object with no mode, which is the default; every other value is a mode.
      if (typeof value !== 'object' || value === null) {
        expect({ value, shorthand: resolve({ analytics: value as 'off' }).analytics.mode }).toEqual({ value, shorthand: 'off' });
      }
    }
    for (const raw of ['off', 'OFF', 'false', 'none', '0', '']) {
      expect({ raw, attribute: resolve(optionsFromDataset({ analytics: raw })).analytics.mode }).toEqual({ raw, attribute: 'off' });
      expect({ raw, query: resolve(optionsFromQuery(`?analytics=${raw}`)).analytics.mode }).toEqual({ raw, query: 'off' });
    }
  });

  test('analytics: off is shorthand for { mode: off }, and only off and false are silent', () => {
    expect(resolve({ analytics: 'off' }).analytics).toEqual({ mode: 'off', endpoint: undefined });
    expect(resolve({ analytics: false as unknown as 'off' }).analytics.mode).toBe('off');
    expect(warnings()).toEqual([]);
    expect(resolve({ analytics: 'OFF' as 'off' }).analytics.mode).toBe('off');
    expect(warnings().length).toBe(1);
  });

  test('an endpoint override is kept when it is https or local http', () => {
    expect(resolve(optionsFromDataset({ analyticsEndpoint: 'https://stats.example/p' })).analytics.endpoint).toBe(
      'https://stats.example/p',
    );
    expect(resolve(optionsFromQuery('?analyticsEndpoint=http%3A%2F%2Flocalhost%3A3700%2Ft')).analytics.endpoint).toBe(
      'http://localhost:3700/t',
    );
    expect(warnings()).toEqual([]);
  });

  test('a refused or non-string endpoint resolves to off, never to the default, with exactly one warning', () => {
    for (const endpoint of ['ftp://stats.example/', 'http://stats.example/', 42, { url: 'https://x.example/' }]) {
      logged.clear();
      expect(resolve({ analytics: { endpoint: endpoint as string } }).analytics.endpoint).toBe('');
      expect(warnings().length).toBe(1);
    }
  });
});

describe('resolveTexture: a host object', () => {
  test('is copied through verbatim, never re-created or validated', () => {
    const resolveTexture = (path: string): string => `https://signed.example.test/${path}`;
    expect(resolveViewerOptions({ resolveTexture }).resolveTexture).toBe(resolveTexture);
  });

  test('is absent unless the host passes one', () => {
    expect('resolveTexture' in resolveViewerOptions({})).toBe(false);
  });

  test('has no query or attribute spelling', () => {
    expect(optionsFromQuery('?resolveTexture=x&resolve-texture=y')).not.toHaveProperty('resolveTexture');
    expect(optionsFromDataset({ resolveTexture: 'x' })).not.toHaveProperty('resolveTexture');
  });
});

describe('settings.show and lighting.temperature', () => {
  test('the settings button is off and the temperature a neutral 5000 K by default', () => {
    const options = resolve();
    expect(options.settings).toEqual({ show: false, side: 'end' });
    expect(options.lighting).toEqual({ temperature: 5000, hdri: {} });
  });

  test('a host turns the button on and sets a temperature, or «Original» with null', () => {
    expect(resolve({ settings: { show: true }, lighting: { temperature: 2700 } })).toMatchObject({
      settings: { show: true },
      lighting: { temperature: 2700 },
    });
    expect(resolve({ lighting: { temperature: null } }).lighting.temperature).toBeNull();
    expect(warnings()).toEqual([]);
  });

  test('a temperature outside the range, off its step or not a number falls back to the default with one warning each', () => {
    for (const bad of [2000, 7000, 3050, Number.NaN, '3000', true]) {
      logged.clear();
      expect(resolve({ lighting: { temperature: bad as never } }).lighting.temperature).toBe(5000);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain('lighting.temperature');
    }
  });

  test('?settings= and ?lightTemperature= are the query spellings; original means «Original»', () => {
    expect(optionsFromQuery('?settings=1&lightTemperature=3000')).toEqual({ settings: { show: true }, lighting: { temperature: 3000 } });
    expect(optionsFromQuery('?lightTemperature=original')).toEqual({ lighting: { temperature: null } });
    expect(resolve(optionsFromQuery('?lightTemperature=warm') as ViewerOptionsInput).lighting.temperature).toBe(5000);
    expect(warnings()).toHaveLength(1);
  });

  test('data-settings and data-light-temperature are the attribute spellings', () => {
    expect(optionsFromDataset({ settings: 'true', lightTemperature: '6500' })).toEqual({
      settings: { show: true },
      lighting: { temperature: 6500 },
    });
    expect(OPTION_SCHEMA['settings.show'].attr).toBe('settings');
    expect(OPTION_SCHEMA['lighting.temperature'].attr).toBe('light-temperature');
  });
});

describe('lighting.hdri', () => {
  const entry = {
    environmentUrl: 'https://cdn.example.test/noon.jpg',
    skyUrl: 'https://cdn.example.test/noon.avif',
    sun: { azimuthDeg: 54, elevationDeg: 43, colourLinear: [1, 0.94, 0.87] as const, horizontalIrradianceShare: 0.78 },
  };

  test('is empty by default', () => {
    expect(resolve().lighting.hdri).toEqual({});
    expect(warnings()).toEqual([]);
  });

  test('keeps a valid entry as given, beside the temperature', () => {
    const options = resolve({ lighting: { temperature: 3000, hdri: { noon: entry } } });
    expect(options.lighting).toEqual({ temperature: 3000, hdri: { noon: entry } });
    expect(warnings()).toEqual([]);
  });

  test('drops a refused entry with one option-invalid warning naming it, and keeps its sibling', () => {
    const options = resolve({ lighting: { hdri: { morning: { ...entry, skyUrl: 'sky.avif' }, noon: entry } } });
    expect(Object.keys(options.lighting.hdri)).toEqual(['noon']);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('lighting.hdri.morning');
    expect(logged.codes()).toEqual(['option-invalid']);
  });

  test('no query parameter or attribute reaches it', () => {
    expect(optionsFromQuery('?hdri=x&lightingHdri=x&lighting.hdri=x')).toEqual({});
    expect(optionsFromDataset({ hdri: 'x', lightingHdri: 'x' })).toEqual({});
    expect(Object.keys(OPTION_SCHEMA).filter((path) => path.includes('hdri'))).toEqual([]);
  });
});

describe('settings.side', () => {
  test("the plate attaches to the bar's end by default, and to its start on request", () => {
    expect(resolve().settings.side).toBe('end');
    expect(resolve({ settings: { show: true, side: 'start' } }).settings).toEqual({ show: true, side: 'start' });
    expect(resolve({ settings: { side: 'end' } }).settings).toEqual({ show: false, side: 'end' });
    expect(warnings()).toEqual([]);
  });

  test('a side alone never turns the button on', () => {
    expect(resolve({ settings: { side: 'start' } }).settings.show).toBe(false);
    expect(resolve(optionsFromQuery('?settingsSide=start') as ViewerOptionsInput).settings).toEqual({ show: false, side: 'start' });
  });

  test('?settingsSide= and settings-side are the spellings, for both values', () => {
    for (const side of ['start', 'end'] as const) {
      expect(optionsFromQuery(`?settings=1&settingsSide=${side}`)).toEqual({ settings: { show: true, side } });
      expect(optionsFromDataset({ settings: 'true', settingsSide: side })).toEqual({ settings: { show: true, side } });
    }
    expect(OPTION_SCHEMA['settings.side'].query).toBe('settingsSide');
    expect(OPTION_SCHEMA['settings.side'].attr).toBe('settings-side');
  });

  test('any other value keeps the end with one warning', () => {
    for (const bad of ['left', 'START', '', 1]) {
      logged.clear();
      expect(resolve({ settings: { side: bad as never } }).settings.side).toBe('end');
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toContain('settings.side');
    }
  });
});

/**
 * `ViewerChrome.bind()` is IDEMPOTENT, and that is the whole of this file.
 *
 * The Retry button re-runs the same instance's boot, which calls `bind()` a
 * second time. Without the guard every control ended up with two handlers and
 * one click on Fullscreen entered and immediately left it. Bun has no DOM, so the shell is a recorder that
 * keeps exactly the surface the chrome touches — which is enough, because what
 * is under test is HOW MANY handlers land on each node.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ViewerChrome } from './viewer-chrome.js';
import { createMessages } from './messages.js';
import type { ViewerRoots, ShellName } from './viewer-shell.js';

type FakeElement = {
  dataset: Record<string, string>;
  className: string;
  title: string;
  tabIndex: number;
  inert: boolean;
  hidden: boolean;
  listeners: Map<string, Array<(event: unknown) => void>>;
  children: FakeElement[];
  classList: { add: (name: string) => void; remove: (name: string) => void; toggle: (name: string, on?: boolean) => void };
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  querySelector: () => FakeElement | null;
  querySelectorAll: () => FakeElement[];
  getBoundingClientRect: () => { left: number; width: number; bottom: number };
  contains: () => boolean;
  matches: () => boolean;
  getRootNode: () => { activeElement: null };
  /** Fires every handler bound for `type`; one call per handler. */
  fire: (type: string) => number;
};

function fakeElement(children: FakeElement[] = []): FakeElement {
  const classes = new Set<string>();
  const element: FakeElement = {
    dataset: {},
    className: '',
    title: '',
    tabIndex: 0,
    inert: false,
    hidden: false,
    listeners: new Map(),
    children,
    classList: {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
      toggle: (name, on) => (on === false ? classes.delete(name) : classes.add(name)),
    },
    addEventListener: (type, handler) => {
      element.listeners.set(type, [...(element.listeners.get(type) ?? []), handler]);
    },
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    querySelector: () => null,
    querySelectorAll: () => children,
    getBoundingClientRect: () => ({ left: 0, width: 0, bottom: 0 }),
    contains: () => false,
    matches: () => false,
    getRootNode: () => ({ activeElement: null }),
    fire: (type) => {
      const handlers = [...(element.listeners.get(type) ?? [])];
      for (const handler of handlers) handler({});
      return handlers.length;
    },
  };
  return element;
}

/**
 * Installs a global for the duration of a test and puts the environment back
 * exactly as it was.
 *
 * `globalThis.x = undefined` is NOT the same as no `x` at all: another test
 * file probing `'window' in globalThis` would then find one and skip its own
 * setup, and Bun runs every file in one process.
 */
function stubGlobal(name: string, value: unknown): () => void {
  const had = name in globalThis;
  const previous = Reflect.get(globalThis, name);
  Reflect.set(globalThis, name, value);
  return () => {
    if (had) Reflect.set(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  };
}

let restoreWindow = (): void => undefined;

function harness() {
  const nodes = new Map<string, FakeElement>();
  const modeButton = fakeElement();
  modeButton.dataset['mode'] = 'walk';
  const node = (name: string): FakeElement => {
    const existing = nodes.get(name);
    if (existing) return existing;
    const made = name === 'control-bar' ? fakeElement([modeButton]) : fakeElement();
    nodes.set(name, made);
    return made;
  };
  const root = node('viewer');
  const calls: string[] = [];
  const roots = {
    root: root as unknown as HTMLElement,
    canvas: node('scene-canvas') as unknown as HTMLCanvasElement,
    viewport: root as unknown as HTMLElement,
    byName: (<T>(name: ShellName) => node(name) as unknown as T) as ViewerRoots['byName'],
  } satisfies ViewerRoots;
  const chrome = new ViewerChrome({
    roots,
    viewport: { isFullscreen: () => false } as never,
    messages: createMessages('en'),
    commands: {
      setMode: () => calls.push('setMode'),
      resetCamera: () => calls.push('resetCamera'),
      toggleTour: () => calls.push('toggleTour'),
      toggleFullscreen: () => {
        calls.push('toggleFullscreen');
      },
      toggleFurniture: () => calls.push('toggleFurniture'),
      openInteriors: () => calls.push('openInteriors'),
      setLightTemperature: () => calls.push('setLightTemperature'),
    },
    onModePressed: () => calls.push('modePressed'),
    onCollapseChanged: () => calls.push('collapse'),
    onDismiss: () => calls.push('dismiss'),
    onRetry: () => calls.push('retry'),
  });
  return { chrome, node, root, modeButton, calls };
}

beforeEach(() => {
  restoreWindow = stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => undefined });
});

afterEach(() => {
  restoreWindow();
});

describe('ViewerChrome.bind', () => {
  test('a second bind adds no second handler to any control', () => {
    const { chrome, node, modeButton } = harness();
    chrome.bind();
    const once = {
      fullscreen: node('fullscreen-button').listeners.get('click')?.length ?? 0,
      furniture: node('furniture-button').listeners.get('click')?.length ?? 0,
      retry: node('retry-button').listeners.get('click')?.length ?? 0,
      mode: modeButton.listeners.get('click')?.length ?? 0,
    };
    chrome.bind();
    chrome.bind();
    expect(once).toEqual({ fullscreen: 1, furniture: 1, retry: 1, mode: 1 });
    expect(node('fullscreen-button').listeners.get('click')?.length).toBe(1);
    expect(node('furniture-button').listeners.get('click')?.length).toBe(1);
    expect(node('retry-button').listeners.get('click')?.length).toBe(1);
    expect(modeButton.listeners.get('click')?.length).toBe(1);
  });

  test('one click on Fullscreen after a rebind toggles it once, not twice', () => {
    const { chrome, node, calls } = harness();
    chrome.bind();
    chrome.bind();
    const fired = node('fullscreen-button').fire('click');
    expect(fired).toBe(1);
    expect(calls.filter((call) => call === 'toggleFullscreen')).toEqual(['toggleFullscreen']);
  });

  test('the root keeps one handler per event however often bind runs', () => {
    const { chrome, root } = harness();
    chrome.bind();
    chrome.bind();
    expect(root.listeners.get('pointermove')?.length).toBe(1);
    expect(root.listeners.get('focusin')?.length).toBe(1);
    expect(root.listeners.get('keydown')?.length).toBe(1);
    // `pointerdown` is bound twice ON PURPOSE — the auto-hide wake and the
    // panel dismiss are two different concerns on the same event.
    expect(root.listeners.get('pointerdown')?.length).toBe(2);
  });

  test('a rebind after dispose brings the chrome back to life', () => {
    const { chrome, node, calls } = harness();
    chrome.bind();
    chrome.dispose();
    chrome.bind();
    node('retry-button').fire('click');
    expect(calls).toContain('retry');
  });
});

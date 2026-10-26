/**
 * The shell contract, tested where it can be tested without a browser.
 *
 * The shell is DATA now, not an HTML string, and that is what makes all three
 * properties checkable without a parser: the TREE declares exactly the names
 * the rest of the viewer asks for and no page id, the BUILDER turns each
 * declaration into exactly one node in the right namespace, and
 * `ensureViewerStyles` delivers one sheet per root however often it is called.
 * That two containers get disjoint trees is still asserted in the real browser
 * (`scripts/browser-check`, `dev/embed-two.html`).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import {
  MissingShellNodeError,
  OVERLAY_NAMES,
  SHELL_ATTRIBUTE,
  SHELL_NAMES,
  THEME_PROPERTIES,
  VIEWER_ROOT_CLASS,
  VIEWER_ROOT_SELECTOR,
  VIEWER_SHELL_TREE,
  buildShellNode,
  ensureViewerStyles,
  releaseViewerStyles,
  type ShellNode,
} from './viewer-shell.js';
import { isMessageKey } from './messages.js';

/** Every node of the tree, depth first — the order they are built in. */
function walk(node: ShellNode): ShellNode[] {
  return [node, ...(node.children ?? []).flatMap((child) => walk(child))];
}

const NODES = walk(VIEWER_SHELL_TREE);

describe('the shell tree', () => {
  test('declares every ShellName exactly once', () => {
    const names: string[] = NODES.flatMap((node) => (node.name === undefined ? [] : [node.name]));
    for (const name of SHELL_NAMES) {
      expect([name, names.filter((declared) => declared === name).length]).toEqual([name, 1]);
    }
  });

  test('declares no name the ShellName union does not carry', () => {
    const names: string[] = NODES.flatMap((node) => (node.name === undefined ? [] : [node.name]));
    expect([...names].sort()).toEqual([...SHELL_NAMES].sort());
  });

  test('carries no page id: two viewers on one page must stay valid HTML', () => {
    expect(NODES.filter((node) => node.attrs?.['id'] !== undefined)).toEqual([]);
  });

  test('names no apartment: the brand context is filled from scene.name', () => {
    const context = NODES.find((node) => node.name === 'brand-context');
    expect(context?.text).toBeUndefined();
    expect(context?.children).toBeUndefined();
  });

  test('the root carries the stylesheet class, the name the selector looks for and a tab stop', () => {
    expect(VIEWER_SHELL_TREE.attrs?.['class']).toBe(VIEWER_ROOT_CLASS);
    expect(VIEWER_ROOT_SELECTOR).toBe(`[${SHELL_ATTRIBUTE}="${String(VIEWER_SHELL_TREE.name)}"]`);
    expect(VIEWER_SHELL_TREE.attrs?.['tabindex']).toBe('0');
  });

  test('every translation marker names a key the catalogue has', () => {
    const text = NODES.map((node) => node.attrs?.['data-i18n']).filter((key): key is string => key !== undefined);
    const attrs = NODES.flatMap((node) => (node.attrs?.['data-i18n-attr'] ?? '').split(',').filter(Boolean)).map((pair) =>
      pair.split(':')[1]!.trim(),
    );
    expect([...text, ...attrs].filter((key) => !isMessageKey(key))).toEqual([]);
  });

  test('every node with a data-i18n key also carries the English default it translates', () => {
    const missing = NODES.filter((node) => node.attrs?.['data-i18n'] !== undefined && node.text === undefined);
    expect(missing.map((node) => node.attrs?.['data-i18n'])).toEqual([]);
  });

  test('a node has text or children, never both', () => {
    const both = NODES.filter((node) => node.text !== undefined && (node.children?.length ?? 0) > 0);
    expect(both.map((node) => node.tag)).toEqual([]);
  });

  test('the overlay names stay disjoint from the tree names', () => {
    for (const name of Object.values(OVERLAY_NAMES)) {
      expect(SHELL_NAMES as readonly string[]).not.toContain(name);
    }
  });

  test('the icons are declared in the SVG namespace, so they render at all', () => {
    const svgRoots = NODES.filter((node) => node.tag === 'svg');
    expect(svgRoots.length).toBeGreaterThan(0);
    expect(svgRoots.every((node) => node.svg === true)).toBe(true);
  });
});

/**
 * A document that records what was built, with just the surface the builder
 * touches. It is what lets the BUILD be tested without an HTML parser — the
 * thing the string template made impossible.
 */
function recordingDocument() {
  type Built = { tag: string; ns: string | null; attrs: Record<string, string>; text: string; children: Built[] };
  const made: Built[] = [];
  const element = (tag: string, ns: string | null): Built => {
    const node: Built = {
      tag,
      ns,
      attrs: {},
      text: '',
      children: [],
      setAttribute(name: string, value: string) {
        node.attrs[name] = value;
      },
      append(child: Built) {
        node.children.push(child);
      },
      set textContent(value: string) {
        node.text = value;
      },
      get textContent() {
        return node.text;
      },
    } as unknown as Built;
    made.push(node);
    return node;
  };
  return {
    made,
    document: {
      createElement: (tag: string) => element(tag, null),
      createElementNS: (ns: string, tag: string) => element(tag, ns),
    } as unknown as Document,
  };
}

describe('buildShellNode', () => {
  test('stamps the name, the attributes and the text of every node', () => {
    const { document } = recordingDocument();
    const built = buildShellNode(document, VIEWER_SHELL_TREE) as unknown as {
      attrs: Record<string, string>;
      children: Array<{ attrs: Record<string, string> }>;
    };
    expect(built.attrs[SHELL_ATTRIBUTE]).toBe('viewer');
    expect(built.attrs['class']).toBe(VIEWER_ROOT_CLASS);
    expect(built.children[0]?.attrs[SHELL_ATTRIBUTE]).toBe('scene-canvas');
  });

  test('builds icons in the SVG namespace and everything else in none', () => {
    const { made, document } = recordingDocument();
    buildShellNode(document, VIEWER_SHELL_TREE);
    const svg = (made as unknown as Array<{ tag: string; ns: string | null }>).filter((node) => node.ns !== null);
    // Every `<path>` is inside an `<svg>`, so both must have the namespace.
    expect(svg.every((node) => node.ns === 'http://www.w3.org/2000/svg')).toBe(true);
    expect(svg.map((node) => node.tag).filter((tag) => tag === 'svg').length).toBeGreaterThan(0);
    expect(svg.map((node) => node.tag).filter((tag) => tag === 'path').length).toBeGreaterThan(0);
    const html = (made as unknown as Array<{ tag: string; ns: string | null }>).filter((node) => node.ns === null);
    expect(html.some((node) => node.tag === 'svg' || node.tag === 'path')).toBe(false);
  });

  test('builds one node per declaration, and no more', () => {
    const { made, document } = recordingDocument();
    buildShellNode(document, VIEWER_SHELL_TREE);
    expect(made.length).toBe(NODES.length);
  });
});

describe('MissingShellNodeError', () => {
  test('names the node that is missing', () => {
    const error = new MissingShellNodeError('tour-track');
    expect(error).toBeInstanceOf(Error);
    expect(error.shellName).toBe('tour-track');
    expect(error.message).toContain('tour-track');
  });
});

/**
 * A root that supports constructed stylesheets, which is now the ONLY delivery
 * there is: a `<style>` element written from script needs `'unsafe-inline'`
 * from the host's `style-src`, and a component may not ask a host for that.
 * Bun has no `CSSStyleSheet`, so the capability itself is stubbed.
 */
class FakeSheet {
  css = '';
  replaceSync(css: string): void {
    this.css = css;
  }
}

const restoreSheets = ((): (() => void) => {
  const had = 'CSSStyleSheet' in globalThis;
  const previous = Reflect.get(globalThis, 'CSSStyleSheet');
  Reflect.set(globalThis, 'CSSStyleSheet', FakeSheet);
  return () => {
    if (had) Reflect.set(globalThis, 'CSSStyleSheet', previous);
    else Reflect.deleteProperty(globalThis, 'CSSStyleSheet');
  };
})();

afterAll(() => {
  restoreSheets();
});

/** A document-shaped object with just the surface `ensureViewerStyles` touches. */
function fakeDocumentRoot(): { adoptedStyleSheets: unknown[] } {
  return { adoptedStyleSheets: [] };
}

describe('ensureViewerStyles', () => {
  test('adopts one constructed sheet per root, however often it is called', () => {
    const root = fakeDocumentRoot();
    ensureViewerStyles(root as unknown as Document);
    ensureViewerStyles(root as unknown as Document);
    ensureViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(1);
    expect(root.adoptedStyleSheets[0]).toBeInstanceOf(FakeSheet);
  });

  test('a second root gets its own delivery of the SAME sheet', () => {
    const first = fakeDocumentRoot();
    const second = fakeDocumentRoot();
    ensureViewerStyles(first as unknown as Document);
    ensureViewerStyles(second as unknown as Document);
    expect(second.adoptedStyleSheets.length).toBe(1);
    // One sheet per PROCESS: N mounted viewers cost one, not N.
    expect(second.adoptedStyleSheets[0]).toBe(first.adoptedStyleSheets[0]);
  });

  test('keeps whatever the host had already adopted', () => {
    const hostSheet = {};
    const root = { adoptedStyleSheets: [hostSheet] };
    ensureViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets[0]).toBe(hostSheet);
    expect(root.adoptedStyleSheets.length).toBe(2);
  });

  test('a root that cannot adopt is left alone rather than given a <style> tag', () => {
    const root = {} as unknown as Document;
    expect(() => ensureViewerStyles(root)).not.toThrow();
    expect('adoptedStyleSheets' in root).toBe(false);
  });
});

/**
 * The claim is a COUNT. Two viewers in one document share one adopted sheet,
 * and the first one disposed must not take the styling off the second —
 * `dispose()` has to leave the host document exactly as it found it, and
 * `adoptedStyleSheets` is part of that document.
 */
describe('releaseViewerStyles', () => {
  test('the last holder takes the sheet away', () => {
    const root = fakeDocumentRoot();
    ensureViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(1);
    releaseViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(0);
  });

  test('a second viewer keeps the sheet when the first one goes', () => {
    const root = fakeDocumentRoot();
    ensureViewerStyles(root as unknown as Document);
    ensureViewerStyles(root as unknown as Document);
    releaseViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(1);
    releaseViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(0);
  });

  test("the host's own sheets survive the release", () => {
    const hostSheet = {};
    const root = { adoptedStyleSheets: [hostSheet] };
    ensureViewerStyles(root as unknown as Document);
    releaseViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets).toEqual([hostSheet]);
  });

  test('releasing a root that was never styled does nothing', () => {
    const root = fakeDocumentRoot();
    releaseViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(0);
  });

  test('a released root can be styled again', () => {
    const root = fakeDocumentRoot();
    ensureViewerStyles(root as unknown as Document);
    releaseViewerStyles(root as unknown as Document);
    ensureViewerStyles(root as unknown as Document);
    expect(root.adoptedStyleSheets.length).toBe(1);
  });
});

describe('THEME_PROPERTIES', () => {
  test('is the fourteen properties the library promises, and nothing is listed twice', () => {
    expect(THEME_PROPERTIES).toHaveLength(14);
    expect(new Set(THEME_PROPERTIES).size).toBe(THEME_PROPERTIES.length);
  });

  test('carries the four the backdrop and the accent theming added', () => {
    for (const name of ['--jeex-backdrop', '--jeex-backdrop-top', '--jeex-on-accent', '--jeex-state-surface'] as const) {
      expect(THEME_PROPERTIES).toContain(name);
    }
  });

  test('carries the two the host slots added', () => {
    expect(THEME_PROPERTIES).toContain('--jeex-color-scheme');
    expect(THEME_PROPERTIES).toContain('--jeex-slot-inset');
  });

  test('every name is one of ours: a host sets these on its own element', () => {
    expect(THEME_PROPERTIES.every((property) => property.startsWith('--jeex-'))).toBe(true);
  });
});

/**
 * The shell, against a real parser.
 *
 * `src/ui/viewer-shell.test.ts` (bun) asserts what it can without a DOM: that
 * the name list has no duplicates, that the template string mentions each one.
 * It cannot assert the thing that actually matters — that PARSING the template
 * yields exactly those nodes, one each, and none of the ids the shell was
 * converted away from. That is what this file is for.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createViewerShell,
  ensureViewerStyles,
  MissingShellNodeError,
  SHELL_ATTRIBUTE,
  SHELL_NAMES,
  SHELL_PARTS,
  THEME_PROPERTIES,
  styleRootOf,
  VIEWER_ROOT_CLASS,
  VIEWER_ROOT_SELECTOR,
  type ShellName,
} from '../../src/ui/viewer-shell.js';
import { createMessages } from '../../src/ui/messages.js';
import { createViewerContext } from '../../src/app/viewer-context.js';

let container: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('createViewerShell', () => {
  test('every name in SHELL_NAMES resolves to exactly one node of the parsed tree', () => {
    const roots = createViewerShell(container, createMessages('en'));
    for (const name of SHELL_NAMES) {
      if (name === 'viewer') {
        expect(roots.byName(name)).toBe(roots.root);
        continue;
      }
      const found = roots.root.querySelectorAll(`[${SHELL_ATTRIBUTE}="${name}"]`);
      expect(found.length, `name "${name}"`).toBe(1);
      expect(roots.byName(name)).toBe(found[0]);
    }
  });

  test('the parsed shell carries no id attributes at all', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const withIds = [...roots.root.querySelectorAll('[id]')].map((node) => node.id);
    expect(withIds).toEqual([]);
    expect(roots.root.id).toBe('');
  });

  test('a name the template does not carry throws MissingShellNodeError', () => {
    const roots = createViewerShell(container, createMessages('en'));
    expect(() => roots.byName('no-such-node' as ShellName)).toThrow(MissingShellNodeError);
  });

  test('the root is the container’s only added child and keeps the viewer class', () => {
    const roots = createViewerShell(container, createMessages('en'));
    expect(container.children.length).toBe(1);
    expect(container.firstElementChild).toBe(roots.root);
    expect(roots.root.classList.contains(VIEWER_ROOT_CLASS)).toBe(true);
    expect(roots.root.matches(VIEWER_ROOT_SELECTOR)).toBe(true);
    expect(roots.root.tabIndex).toBe(0);
  });

  test('the canvas reference is the shell’s own canvas element', () => {
    const roots = createViewerShell(container, createMessages('en'));
    expect(roots.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(roots.canvas.dataset['jeex']).toBe('scene-canvas');
    expect(roots.viewport).toBe(roots.root);
  });

  test('two shells in two containers share nothing but the stylesheet', () => {
    const second = document.createElement('div');
    document.body.appendChild(second);
    const a = createViewerShell(container, createMessages('en'));
    const b = createViewerShell(second, createMessages('en'));
    expect(a.root).not.toBe(b.root);
    expect(a.canvas).not.toBe(b.canvas);
    expect(a.byName('control-bar')).not.toBe(b.byName('control-bar'));
    expect(container.contains(b.root)).toBe(false);
  });

  test('the translated fragment never rewrites the host page’s own data-i18n nodes', () => {
    const foreign = document.createElement('p');
    foreign.dataset['i18n'] = 'loading.title';
    foreign.textContent = 'host copy';
    document.body.appendChild(foreign);
    createViewerShell(container, createMessages('en'));
    expect(foreign.textContent).toBe('host copy');
  });

  test('the brand context line is left empty for the scene name to fill', () => {
    const roots = createViewerShell(container, createMessages('en'));
    expect(roots.byName('brand-context').textContent?.trim()).toBe('');
  });

  test('the root carries lang from the catalogue it was built with', () => {
    const roots = createViewerShell(container, createMessages('ru'));
    expect(roots.root.lang).toBe('ru');
  });

  test('the canvas has no aria-describedby (that would need an id, and the shell carries none)', () => {
    const roots = createViewerShell(container, createMessages('en'));
    expect(roots.canvas.hasAttribute('aria-describedby')).toBe(false);
    expect(roots.canvas.getAttribute('aria-keyshortcuts')).toContain('ArrowUp');
  });

  test('the live region is visually hidden but present, not display:none', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const live = roots.byName('live-region');
    expect(live.getAttribute('aria-live')).toBe('polite');
    const rect = live.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(1);
    expect(getComputedStyle(live).display).not.toBe('none');
  });
});

describe('lang follows setLocale', () => {
  test('createViewerContext.retranslate updates the shell root', () => {
    const context = createViewerContext(container, 'en', []);
    expect(context.roots.root.lang).toBe('en');
    context.retranslate('ru');
    expect(context.roots.root.lang).toBe('ru');
    context.release();
  });
});

describe('ensureViewerStyles', () => {
  test('adopts one constructed sheet on a document, and only once', () => {
    const before = document.adoptedStyleSheets.length;
    ensureViewerStyles(document);
    const after = document.adoptedStyleSheets.length;
    // Either this document already had it from an earlier test file in the
    // same page, or this call added exactly one.
    expect(after - before).toBeLessThanOrEqual(1);
    ensureViewerStyles(document);
    expect(document.adoptedStyleSheets.length).toBe(after);
    expect(document.querySelectorAll('style[data-jeex]').length).toBe(0);
  });

  test('a shadow root adopts the sheet, once, and shares the instance with the document', () => {
    ensureViewerStyles(document);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    expect(shadow.adoptedStyleSheets.length).toBe(0);
    ensureViewerStyles(shadow);
    expect(shadow.adoptedStyleSheets.length).toBe(1);
    // ONE sheet for N roots is the whole point of `adoptedStyleSheets` here.
    expect(document.adoptedStyleSheets).toContain(shadow.adoptedStyleSheets[0]);
    ensureViewerStyles(shadow);
    expect(shadow.adoptedStyleSheets.length).toBe(1);
  });

  test('the adopted sheet really carries the component CSS', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    ensureViewerStyles(shadow);
    const sheet = shadow.adoptedStyleSheets[0]!;
    const selectors = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
    expect(selectors).toContain(`.${VIEWER_ROOT_CLASS}`);
  });
});

describe('styleRootOf', () => {
  test('a container in the document resolves to the document', () => {
    expect(styleRootOf(container)).toBe(document);
  });

  test('a container inside a shadow root resolves to that shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    shadow.appendChild(inner);
    expect(styleRootOf(inner)).toBe(shadow);
  });
});

describe('the shell inside a shadow root', () => {
  test('builds there, is invisible to document-wide lookups, and styles that root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);

    const roots = createViewerShell(mount, createMessages('en'));

    expect(shadow.querySelector(VIEWER_ROOT_SELECTOR)).toBe(roots.root);
    expect(document.querySelector(VIEWER_ROOT_SELECTOR)).toBeNull();
    expect(shadow.adoptedStyleSheets.length).toBe(1);
    // The canvas is inside the shadow boundary, so `elementFromPoint` on the
    // document cannot reach it — the property the embed form depends on.
    expect(roots.canvas.getRootNode()).toBe(shadow);
  });
});

describe('theming', () => {
  test('every documented custom property is declared on the root with its default', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const style = getComputedStyle(roots.root);
    for (const property of THEME_PROPERTIES) {
      expect(style.getPropertyValue(property).trim(), property).not.toBe('');
    }
  });

  test('a host override of --jeex-accent reaches the active mode button', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const active = roots.root.querySelector<HTMLElement>('.mode-button.is-active')!;
    const before = getComputedStyle(active).backgroundColor;
    const beforeShadow = getComputedStyle(active).boxShadow;

    // Set the way a host sets it: on the viewer's own element, inherited down.
    roots.root.style.setProperty('--jeex-accent', 'rgb(79, 140, 255)');
    const after = getComputedStyle(active).backgroundColor;
    expect(after).not.toBe(before);
    expect(after).toBe('rgb(79, 140, 255)');

    // And the derived glow follows the same override, at its own alpha. The
    // serialisation is the engine's (`rgb(from …)` computes to `color(srgb …)`),
    // so the assertion is that it MOVED and carries the new alpha, not its text.
    const shadow = getComputedStyle(active).boxShadow;
    expect(shadow).not.toBe(beforeShadow);
    expect(shadow).toMatch(/0\.2\)/);
  });

  test('--jeex-radius reshapes the panel it names', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const bar = roots.byName('control-bar');
    roots.root.style.setProperty('--jeex-radius', '4px');
    expect(getComputedStyle(bar).borderTopLeftRadius).toBe('4px');
  });

  test('the styled nodes carry the documented `part` names', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const parts = [...roots.root.querySelectorAll('[part]')].map((node) => node.getAttribute('part'));
    // `minimap` is built by `ui/minimap.ts`, not by the shell tree, so it is
    // the one promised part this tree does not carry.
    expect(new Set(parts)).toEqual(new Set(SHELL_PARTS.filter((part) => part !== 'minimap')));
  });

  test('the sheet is layered, so an unlayered host rule wins without !important', () => {
    ensureViewerStyles(document);
    const sheet = document.adoptedStyleSheets.at(-1)!;
    const layerStatement = [...sheet.cssRules].find((rule) => rule.cssText.startsWith('@layer'));
    expect(layerStatement?.cssText).toContain('reset');
    expect(layerStatement?.cssText).toContain('component');
  });
});

describe('a host page with global CSS (light DOM)', () => {
  /** The host's own unlayered sheet, as a page `<style>`; removed after each case. */
  let hostSheet: HTMLStyleElement;
  const hostCss = (css: string): void => {
    hostSheet = document.createElement('style');
    hostSheet.textContent = css;
    document.head.appendChild(hostSheet);
  };
  afterEach(() => hostSheet?.remove());

  const look = (element: Element): string => {
    const style = getComputedStyle(element);
    return [
      style.padding,
      style.minHeight,
      style.backgroundColor,
      style.borderTopWidth,
      style.fontSize,
      style.lineHeight,
      style.fontFamily,
    ].join(' | ');
  };

  test('element rules, `*` and body typography do not reach the chrome', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const active = roots.root.querySelector('.mode-button.is-active')!;
    const hint = roots.byName('hint-text');
    const clean = [look(active), look(hint)];
    hostCss(`
      * { line-height: 1.8; font-family: serif; }
      body { font: 14px/1.4 serif; }
      select, button { font: inherit; padding: 8px 10px; min-height: 40px; background: rgb(25, 29, 36); border: 1px solid rgb(42, 48, 58); }
      .site-content button, button:hover { background: rgb(255, 45, 138); }
    `);
    expect([look(active), look(hint)]).toEqual(clean);
  });

  test('CMS nesting of one class and two element names does not reach the chrome', () => {
    const site = document.createElement('div');
    site.className = 'site-content';
    const main = document.createElement('main');
    site.append(main);
    document.body.append(site);
    main.append(container);
    const roots = createViewerShell(container, createMessages('en'));
    const active = roots.root.querySelector('.mode-button.is-active')!;
    const hint = roots.byName('hint-text');
    const clean = [look(active), look(hint)];
    hostCss(`
      .site-content main button { padding: 14px 18px; min-height: 44px; background: rgb(255, 212, 0); }
      .site-content main span { font-size: 20px; line-height: 3; }
    `);
    expect([look(active), look(hint)]).toEqual(clean);
  });

  test('a rule that names the viewer root and the element still overrides it', () => {
    const roots = createViewerShell(container, createMessages('en'));
    hostCss('.jeex-viewer .mode-button { padding-left: 21px; }');
    expect(getComputedStyle(roots.root.querySelector('.mode-button')!).paddingLeft).toBe('21px');
  });

  test('theming properties on the root still reach the chrome under hostile rules', () => {
    const roots = createViewerShell(container, createMessages('en'));
    hostCss('button { background: rgb(1, 2, 3); } .jeex-viewer { --jeex-accent: rgb(79, 140, 255); }');
    expect(getComputedStyle(roots.root.querySelector('.mode-button.is-active')!).backgroundColor).toBe('rgb(79, 140, 255)');
  });

  test("the host's own content in a slot box keeps the host's rules", () => {
    const roots = createViewerShell(container, createMessages('en'));
    const slot = document.createElement('div');
    slot.dataset['jeexSlot'] = 'top-left';
    const own = document.createElement('button');
    slot.appendChild(own);
    roots.root.appendChild(slot);
    hostCss('button { padding: 13px 17px; } [data-jeex-slot] { line-height: 3; }');
    expect(getComputedStyle(own).padding).toBe('13px 17px');
    expect(getComputedStyle(slot).lineHeight).not.toBe('normal');
  });

  test("a host's own cascade layer still hides chrome with `!important` and places the floating fullscreen button", () => {
    // The shape of a real host: a site block that renders `<jeex-viewer shadow="none">`, hides chrome it
    // does not want with layered `!important`, and positions the floating fullscreen button with
    // margins and `translate`, none of which the player's layers set on that button.
    const roots = createViewerShell(container, createMessages('en'));
    container.className = 'host-block';
    hostCss(`
      @layer host-base, host-blocks;
      @layer host-blocks {
        .host-block :is(.tour-status, .hint-card, .brand-lockup, .control-bar) { display: none !important; }
        .host-block .fullscreen-float { margin-block-start: 136px; margin-right: 42px; translate: 50% 0; }
      }
    `);
    for (const name of ['tour-status', 'hint-card', 'brand-lockup', 'control-bar'] as const) {
      expect(getComputedStyle(roots.byName(name)).display, name).toBe('none');
    }
    const float = getComputedStyle(roots.byName('fullscreen-float'));
    expect([float.marginTop, float.marginRight, float.translate]).toEqual(['136px', '42px', '50%']);
  });

  test('an `!important` host rule still reaches the chrome, as the README documents', () => {
    const roots = createViewerShell(container, createMessages('en'));
    hostCss('button { padding: 20px !important; }');
    expect(getComputedStyle(roots.root.querySelector('.mode-button')!).padding).toBe('20px');
  });

  test('a `::part()` rule of the page still styles the chrome inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    const roots = createViewerShell(mount, createMessages('en'));
    hostCss('div::part(control-bar) { padding-left: 33px; }');
    expect(getComputedStyle(roots.byName('control-bar')).paddingLeft).toBe('33px');
  });

  test("the body's typography does not reach the chrome inside a shadow root either", () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    const roots = createViewerShell(mount, createMessages('en'));
    const text = (): string => {
      const style = getComputedStyle(roots.byName('hint-text'));
      return [
        style.fontSize,
        style.fontWeight,
        style.lineHeight,
        style.letterSpacing,
        style.textTransform,
        style.textAlign,
        style.wordSpacing,
      ].join(' | ');
    };
    const clean = text();
    hostCss(
      'body { font-size: 20px; font-weight: 300; line-height: 3; letter-spacing: 0.2em; word-spacing: 0.3em; text-transform: uppercase; text-align: center; }',
    );
    expect(text()).toEqual(clean);
  });

  test('inside a shadow root a sheet the host adds there still wins as before', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    const roots = createViewerShell(mount, createMessages('en'));
    const own = new CSSStyleSheet();
    own.replaceSync('button { padding: 13px 17px; }');
    shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, own];
    expect(getComputedStyle(roots.root.querySelector('.mode-button')!).padding).toBe('13px 17px');
  });
});

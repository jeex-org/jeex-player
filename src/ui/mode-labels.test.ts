/**
 * Mode names are never translated: the visible
 * labels of the mode switcher are `2D`, `3D`, `360`, `Walk`, `Tour` in every
 * locale. The guarantee is structural — the labels are not message keys and
 * the buttons carry no `data-i18n` — and these tests fail the moment a
 * catalogue or the shell tries to make them locale text again.
 */
import { describe, expect, test } from 'bun:test';
import { EN } from '../shared/messages.js';
import { DE } from './locales/de.js';
import { ES } from './locales/es.js';
import { FR } from './locales/fr.js';
import { IT } from './locales/it.js';
import { RU } from './locales/ru.js';
import { SR_LATN } from './locales/sr-latn.js';
import { MODE_LABELS } from './mode-labels.js';
import { VIEWER_SHELL_TREE, type ShellNode } from './viewer-shell.js';

const CATALOGUES: Record<string, Readonly<Record<string, string>>> = {
  en: EN,
  de: DE,
  es: ES,
  fr: FR,
  it: IT,
  ru: RU,
  'sr-Latn': SR_LATN,
};

const MODES = Object.keys(MODE_LABELS);

function walk(node: ShellNode): ShellNode[] {
  return [node, ...(node.children ?? []).flatMap((child) => walk(child))];
}

const MODE_BUTTONS = walk(VIEWER_SHELL_TREE).filter((node) => node.attrs?.['data-mode'] !== undefined);

describe('mode labels', () => {
  test('are the five product terms, in switcher order', () => {
    expect(Object.values(MODE_LABELS)).toEqual(['2D', '3D', '360', 'Walk', 'Tour']);
  });

  test('no shipped catalogue can override a mode name: none carries a mode label key', () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const overrides = Object.keys(catalogue).filter((key) => MODES.some((mode) => key === `mode.${mode}`) || key === 'tour.button.play');
      expect(overrides, locale).toEqual([]);
    }
  });

  test('the switcher buttons show MODE_LABELS and carry no text translation marker', () => {
    expect(MODE_BUTTONS.map((node) => node.attrs?.['data-mode'])).toEqual(MODES);
    for (const node of MODE_BUTTONS) {
      const mode = node.attrs?.['data-mode'] as keyof typeof MODE_LABELS;
      expect(node.text, mode).toBe(MODE_LABELS[mode]);
      expect(node.attrs?.['data-i18n'], mode).toBeUndefined();
      // Only the description is localized.
      expect(node.attrs?.['data-i18n-attr'], mode).toBe(`title:live.mode.${mode}`);
    }
  });
});

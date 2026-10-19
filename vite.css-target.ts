/**
 * The CSS baseline of the shipped stylesheet, and it is deliberately NOT
 * `build.target`.
 *
 * `build.target: 'es2022'` is about JavaScript syntax. Vite hands the same
 * value to Lightning CSS as `build.cssTarget` when nothing else is said, and
 * ES2022 maps onto browsers that predate `light-dark()` — so Lightning CSS
 * DOWN-LEVELS every `light-dark()` colour of `src/ui/styles/viewer.css` into
 * its own polyfill:
 *
 *   --jeex-surface: var(--lightningcss-light, #faf7f0d1) var(--lightningcss-dark, #0e1615c2);
 *
 * That polyfill only works when Lightning CSS can also emit the two companion
 * declarations, which it does by READING a static `color-scheme` on the same
 * rule. Ours is `color-scheme: var(--jeex-color-scheme, dark)` — themeable by
 * the host, which is the whole point of the property — so the companions are
 * never emitted, both `var()`s fall back to their defaults and the value
 * becomes two colours side by side: invalid at computed-value time.
 *
 * The consequence, observed in a host editor: every chrome
 * background silently became `transparent` and every chrome text colour fell
 * back to INHERITING the host page's foreground, so the mode-switcher pill on
 * a white 2D plan was white text on white paper. Nothing in the source was
 * wrong; the build had rewritten it.
 *
 * So the stylesheet declares its own floor: the first version of each engine
 * that ships `light-dark()` (Chrome/Edge 123, Firefox 120, Safari 17.5 —
 * Baseline newly available 2024-05-13). Lightning CSS then leaves the function
 * alone. `scripts/css-contract-check.ts` guards the built artefact against a
 * regression, and `tests/component/host-slots.test.ts` guards the behaviour.
 */
export const CSS_TARGET = ['chrome123', 'edge123', 'firefox120', 'safari17.5'] as const;

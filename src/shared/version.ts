/**
 * The library's own semver (`package.json#version`), read through ONE point
 * so the two substitution mechanisms that feed it — Vite's `define` in a real
 * build and Bun's `bunfig.toml` `[define]` under `bun test`/`bun run` — never
 * have to be reasoned about at more than one call site.
 *
 * `__JEEX_VIEWER_VERSION__` is declared ambient in `src/assets.d.ts`. `typeof`
 * never throws on an identifier that was never substituted at all (an
 * invocation neither Vite nor `bunfig.toml`'s `[define]` covers, e.g. a
 * one-off `node` run of a compiled file) — the fallback below is that guard,
 * not the normal path: `bunfig.toml`'s `[define]` is what actually supplies
 * the test-time value (Bun 1.4.2 supports it as a top-level runtime option,
 * not scoped to `[test]` — verified against docs.bun.com, 2026-09-08).
 *
 * Lowest layer: this module imports nothing.
 */

/** The published semver of this build; `0.0.0-test` when nothing substituted the global. */
export const VIEWER_VERSION: string = typeof __JEEX_VIEWER_VERSION__ === 'string' ? __JEEX_VIEWER_VERSION__ : '0.0.0-test';

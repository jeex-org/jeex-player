/**
 * Whether screenshot comparisons run: only off CI.
 *
 * The baselines are rendered on the maintainers' machines; a hosted runner's
 * fonts and rasteriser differ from them. `playwright.config.ts` sets
 * `ignoreSnapshots` from this, and `screenshotOnly()` in `support.ts` skips a
 * test whose only purpose is a comparison, so both read one predicate.
 */
export const SCREENSHOTS_IGNORED = !!process.env['CI'];

# Dependency versions

Every dependency in `package.json` is pinned exactly (no `^`, no `~`). From 2026-10-23 on,
each change is recorded here with the registry query that returned it; the version is the
registry's `latest` tag on that date.
Never take a version from memory or from another project's lockfile.

## 2026-10-23: shared dependency alignment

| Package                    | Version     | Was                  | Command                            |
| -------------------------- | ----------- | -------------------- | ---------------------------------- |
| `zod`                      | `4.6.7`     | `4.6.2`              | `npm view zod version`             |
| `@types/bun`               | `1.4.4`     | `1.4.1`              | `npm view @types/bun version`      |
| `vite`                     | `8.3.5`     | `8.2.4`              | `npm view vite version`            |
| `@playwright/test`         | `1.64.1`    | range `^1.63`        | `npm view @playwright/test version` |
| `@axe-core/playwright`     | `4.14.0`    | range `^4.13.0`      | `npm view @axe-core/playwright version` |
| `oxfmt`                    | `0.74.0`    | `0.72.0`             | `npm view oxfmt version`           |
| `oxlint`                   | `1.89.0`    | `1.81.0`             | `npm view oxlint version`          |
| `oxlint-tsgolint`          | `7.0.2005`  | `7.0.2001`           | `npm view oxlint-tsgolint version` |
| `vitest`                   | `5.0.5`     | range `^5.0.5`       | `npm view vitest version`          |
| `@vitest/browser-playwright` | `5.0.5`   | range `^5.0.5`       | `npm view @vitest/browser-playwright version` |
| `@vitest/coverage-v8`      | `5.0.5`     | range `^5.0.5`       | `npm view @vitest/coverage-v8 version` |
| Bun (`packageManager`, `.bun-version`) | `1.4.4` | `1.4.2`     | `npm view bun version`             |

Five of the former pins were caret ranges (`@playwright/test`, `@axe-core/playwright`,
`vitest`, `@vitest/browser-playwright`, `@vitest/coverage-v8`); they are exact now. The other
pins did not change in this update.

## 2026-10-24: knip for a Zod advisory

`bun audit` reported GHSA-mrhx-c7xc-m3w5 (high: Zod before 4.6.6 can exhaust memory while
validating oversized constrained collections) through `knip > zod@4.5.4`. knip 6.42.1 depends
on `zod ^4.6.5`, which resolves to the patched release the project already uses.

| Package | Version  | Was      | Command                  |
| ------- | -------- | -------- | ------------------------ |
| `knip`  | `6.42.1` | `6.34.0` | `npm view knip version`  |

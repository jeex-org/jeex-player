# Contributing to JEEX Player

Thank you for helping. JEEX Player is the embeddable 3D apartment player; its
package and its element are named `jeex-viewer`. This file says how to set the
project up, what a change has to pass and how it reaches `main`.

## Licence

The project is licensed under the Apache License, Version 2.0 (`LICENSE`).
Contributions are accepted inbound=outbound: by opening a pull request you
license your contribution under the same Apache-2.0 terms as the rest of the
project, as section 5 of the licence describes. There is no contributor
licence agreement and no sign-off line to add.

Only submit work you have the right to license this way. Code copied from
another project needs a compatible licence and its notice in `NOTICE`.

## Setup

- Node 22.12 or newer (`engines` in `package.json`; `.node-version` pins the
  version used in development).
- Bun, at the version in `.bun-version` (also `packageManager` in
  `package.json`).
- Chromium for the browser tests, once: `bunx playwright install chromium`.

```bash
bun install
npm run dev          # the demo page on http://localhost:3700/
```

Install the git hooks of `lefthook.yml` once with `bun run hooks:install`. The
pre-commit hook is deliberately small: `scripts/no-docs-refs.sh --staged`,
which refuses a staged file that points at a documents folder outside this
repository.

`README.md` lists the other dev pages and the build commands.

## Checks

Every change passes the quality gate before review:

```bash
bun run check [fast|standard|full]
```

The gate is `scripts/check.sh`, in three nested tiers:

- `fast` is the edit loop: type checks, lint, format, source hygiene, module
  size, layer rules, dead code, the schema check, and the unit tests the
  change can affect. No browser, no build.
- `standard` runs before a commit: the whole unit run with its coverage
  floors, the component tests in a real browser (Vitest browser mode) with
  their floors, and the demo build with its bundle budget.
- `full` (the default) runs before a pull request: the Playwright end-to-end
  suite, the library build and its per-file budgets, `publint` and `attw`,
  the site build, and `bun audit`.

Run the full gate (`bash scripts/check.sh`) before you open a pull request:
it is the proof a change is ready. CI splits the same step list in two:

- `.github/workflows/ci.yml` runs on every push to `main` and every pull
  request, and weekly for new dependency advisories. It runs every step that
  needs no browser: type checks, lint, format, the unit tests with their
  coverage floors, the demo, site and library builds with their budgets,
  the static checks and `bun audit`. It takes about a minute and a half.
- `.github/workflows/browser.yml` runs the browser levels (the component
  tests in Vitest browser mode with their coverage floors, and the
  Playwright end-to-end suite) on hosted runners. A push does not start it:
  a maintainer starts it by hand (Actions, "Browser tests", "Run workflow")
  when a change needs them checked on a machine nobody owns. On hosted
  runners without a GPU it takes about twenty minutes.

Two things run only on a contributor's machine:

- **Screenshot comparisons.** The baselines of the end-to-end suite are
  rendered locally and depend on the platform's GPU and fonts, so CI skips
  them. When your change alters a picture on purpose, update the baseline
  with `bunx playwright test --update-snapshots <spec>` and say so in the
  pull request. The repository ships only the `linux` baselines
  (`tests/e2e/__screenshots__/linux/`); on macOS, generate your own set once
  with `bunx playwright test --update-snapshots` before comparing (the
  `darwin` directory it writes is git-ignored).
- **`code-ranker`** (dependency cycles, coupling, complexity; configured in
  `code-ranker.toml`) is optional: install it with `npm i -g code-ranker`.
  The gate runs it when it is installed and skips it with one line when it
  is not; CI does not run it.

`npm run test:browser` is an extra scripted smoke check against a running
dev server (`npm run dev`, or `VIEWER_URL` for another address). It needs
the `agent-browser` CLI and is not part of the gate.

The browser tests render WebGL on SwiftShader, Chromium's software
rasteriser, by default, so they run on any machine. Two optional environment
switches make them faster where the hardware allows; the pictures and the
baselines stay the same:

- `JEEX_BROWSER_GPU=nvidia` renders on an NVIDIA GPU of a Linux host with the
  NVIDIA driver installed, and falls back to SwiftShader with a one-line note
  when the driver's EGL vendor file is missing.
- `JEEX_BROWSER_GPU=d3d12` renders on the host GPU under Windows Subsystem for
  Linux, through Mesa's D3D12 driver.
- `JEEX_E2E_ANGLE=swiftshader` stays on the software rasteriser but skips its
  per-frame read-back, which roughly doubles the frame rate.

`tests/headless-webgl.ts` documents each switch.

When a test fails, re-run only that file (`bun test <file>`,
`bunx vitest run <file>`, `bunx playwright test <spec>`) before running the
whole gate again. A browser test that times out on a heavily loaded machine
is usually load, not a defect: run that file once more before investigating.

## Code style

- **British spelling** in identifiers, comments and documentation (`centre`,
  `colour`, `catalogue`, `metres`). The source-hygiene step
  (`scripts/spelling-check.ts`) fails on American spellings; the only
  exceptions are names an outside API forces, each listed there with its
  reason.
- **Module headers.** Every non-test module under `src/` starts with a `/**`
  block that states its responsibility and its main invariant. The same step
  enforces it.
- **Formatting and lint** are `oxfmt` and `oxlint`; run `npm run format`
  before committing.
- **Layers.** `src/` is split into layer directories; the allowed import
  directions are in `.dependency-cruiser.cjs`, and the pure layer imports
  neither `three` nor the DOM.
- **Tests come with the change.** Pure logic (validators, solvers,
  navigation, catalogues) is written test-first in a colocated
  `src/**/*.test.ts`; DOM components get a component test under
  `tests/component`; whole-page behaviour gets an end-to-end spec under
  `tests/e2e`.
- **No new dependencies without discussion.** Open an issue first. Runtime
  code is bundled into the library and counts against its size budgets.
- **Commit messages** follow `type(scope): summary` in English, for example
  `fix(camera): clamp pitch at the pole`. Keep the subject under about 72
  characters and use the body for the reason.

## Contracts to keep

These surfaces are public. Changing one is a breaking change: describe it in
the pull request, update `README.md` and `CHANGELOG.md`, and follow the
versioning rules at the end of `CHANGELOG.md`.

- The package entry points and their exports (`jeex-viewer`,
  `jeex-viewer/element`, `jeex-viewer/host`, `jeex-viewer/ops`, the IIFE
  builds, `style.css`, the JSON Schemas). `src/embed/ops.test.ts` pins the
  export list of `jeex-viewer/ops`.
- `ViewerOptions` keys, their query and attribute spellings and their
  defaults; the `ViewerHandle` methods and events.
- The iframe protocol: `CommandMethod`, `ErrorCode`, the events and
  `PROTOCOL_VERSION` (`src/embed/protocol.ts`).
- The scene document (`schemaVersion`) and the baked project format
  (`formatVersion`), with their validators and generated schemas
  (`scripts/schema-gate.sh` fails when the generated schema drifts from the
  types).
- The theming custom properties (`THEME_PROPERTIES`) and the shadow parts
  (`SHELL_PARTS`).
- The `userData` keys the scene builder writes and `window.__viewerDebug`,
  which the browser tests read.

## Issues and pull requests

- **Bugs:** open an issue with the browser and version, the integration path
  (ES module, `<jeex-viewer>` or iframe), the scene or project if you can
  share it, what you expected and what happened, and any console output.
- **Proposals:** open an issue describing the problem before writing a large
  change, so the approach can be agreed first.
- **Security issues:** never in a public issue; see `SECURITY.md`.
- **Pull requests:** branch from `main`, keep one coherent change per pull
  request, and fill in the pull request template: what changed and why, the
  gate result, screenshots for visible changes, and any contract touched.
  A maintainer reviews it; CI must be green before it is merged.

Be respectful and assume good faith in issues and reviews.

## Releases

Maintainers cut releases. A release bumps `version` in `package.json`,
records its changes under a new version heading in `CHANGELOG.md` and is
tagged in git.

The package is not published to npm yet; a release is a tagged source tree
you build yourself. The `unpkg`, `jsdelivr` and `publishConfig` fields in
`package.json` prepare a future npm release, and the dist-tag rule below
applies once the package is on npm:

A published artefact that carries a `latest` alias (the JSON Schemas, the
type declarations, API documentation) is updated under that alias only when
the release's tag is also the npm `latest` dist-tag. A backport fix on an
older line publishes only its own versioned path, so it never replaces the
current schema or types with older ones.

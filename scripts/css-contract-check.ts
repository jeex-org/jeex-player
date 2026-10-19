/**
 * The stylesheet contract gate: what the BUILD did to `light-dark()`.
 *
 * `src/ui/styles/viewer.css` themes the whole chrome through one property —
 * `color-scheme: var(--jeex-color-scheme, dark)` on the root, and every colour
 * with two halves written `light-dark(light, dark)` (README «Theming»). That
 * contract lives in the source, and this gate checks that it survives the
 * bundler.
 *
 * Without it, it did not. Vite hands `build.target` to Lightning CSS as the CSS baseline
 * when `build.cssTarget` says nothing, and `es2022` maps onto browsers older
 * than `light-dark()`, so Lightning CSS down-levelled every such colour into
 * its own polyfill:
 *
 *   --jeex-surface: var(--lightningcss-light, #faf7f0d1) var(--lightningcss-dark, #0e1615c2);
 *
 * The polyfill needs two companion declarations that Lightning CSS emits only
 * where it can READ a static `color-scheme` on the same rule. Ours is a
 * `var()`, by design, so the companions were never emitted, both `var()`s fell
 * back to their defaults and the property became two colours side by side —
 * invalid at computed-value time. Every chrome background silently became
 * `transparent` and every chrome text colour fell back to INHERITING the host
 * page's foreground; on a host editor's white 2D plan the mode-switcher pill
 * was white text on white paper.
 *
 * Nothing in the source was wrong, so no test over the source could see it.
 * This one reads the ARTEFACT: it runs at the end of each build script, which
 * is why the step list of `check.sh` and `ci.yml` does not change — a build
 * that emits a broken stylesheet fails the build that emitted it.
 *
 * Usage: `bun run scripts/css-contract-check.ts [dist-dir]`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The marker of the down-levelled form. Lightning CSS names both of its
 * companion properties with this prefix, so one occurrence anywhere in an
 * emitted file means the polyfill was applied.
 */
export const POLYFILL_MARKER = '--lightningcss-';

/**
 * A declaration that only exists in `viewer.css`, used to find the file the
 * chrome stylesheet ended up in — inlined into a JS chunk for the library
 * build, a real `.css` file for the demo one.
 */
export const STYLESHEET_MARKER = '--jeex-surface:';

/** What the chrome stylesheet must still say after the build. */
export const THEME_FUNCTION = 'light-dark(';

/** Files worth reading: the CSS itself, and the JS the CSS is inlined into. */
const EXTENSIONS = ['.js', '.css'];

export type CssDefect = { readonly file: string; readonly problem: string };

/**
 * The defects in one emitted file, as sentences. Pure, so the two failure
 * shapes are asserted without a build (`css-contract-check.test.ts`).
 */
export function findCssDefects(file: string, text: string): CssDefect[] {
  const defects: CssDefect[] = [];
  if (text.includes(POLYFILL_MARKER)) {
    defects.push({
      file,
      problem: `Lightning CSS down-levelled \`light-dark()\` into \`${POLYFILL_MARKER}*\`; the polyfill cannot work with \`color-scheme: var(--jeex-color-scheme, dark)\`. Raise \`build.cssTarget\` (vite.css-target.ts).`,
    });
  }
  // `else`, not a second `if`: a down-levelled sheet has lost `light-dark()`
  // by definition, and saying so twice about one file buries the fix.
  else if (text.includes(STYLESHEET_MARKER) && !text.includes(THEME_FUNCTION)) {
    defects.push({
      file,
      problem: `the chrome stylesheet is here but no \`${THEME_FUNCTION}\` survived it: the theme contract of README «Theming» is gone from the artefact.`,
    });
  }
  return defects;
}

/**
 * Every emitted file worth reading, recursively, as paths relative to `dir`.
 *
 * `withFileTypes`, not a `statSync` per entry: one syscall for the whole
 * listing, and a symlinked DIRECTORY is not `isDirectory()` — so a symlink
 * cycle in the output tree cannot recurse forever, while a symlinked `.js` or
 * `.css` is still read like any other file.
 */
export function emittedFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(relative(dir, full));
    }
  };
  walk(dir);
  return found;
}

/**
 * Every defect in a built directory — including the one a per-file check cannot
 * see: the chrome stylesheet MISSING from the whole build.
 *
 * `findCssDefects` can only judge a file it can see, so a build that emitted no
 * stylesheet at all would have passed with «nothing wrong found anywhere».
 * The gate's promise is that a build which
 * does not ship the themed chrome fails, and a build that ships none of it is
 * the loudest case of that.
 */
export function checkDirectory(dir: string): CssDefect[] {
  const files = emittedFiles(dir);
  const defects = files.flatMap((file) => findCssDefects(file, readFileSync(join(dir, file), 'utf8')));
  const found = files.some((file) => readFileSync(join(dir, file), 'utf8').includes(STYLESHEET_MARKER));
  if (!found) {
    defects.push({
      file: dir,
      problem: `no emitted file carries \`${STYLESHEET_MARKER}\`: the chrome stylesheet is not in this build at all.`,
    });
  }
  return defects;
}

if (import.meta.main) {
  const dir = Bun.argv[2] ?? 'dist';
  // A gate whose whole point is a readable failure does not hand the reader an
  // `ENOENT` stack trace: a directory that is not there is a sentence too.
  if (!existsSync(dir)) {
    console.error(`css-contract: ${dir} does not exist; run the build this check belongs to first.`);
    process.exit(1);
  }
  const defects = checkDirectory(dir);
  for (const defect of defects) console.error(`css-contract: ${defect.file}: ${defect.problem}`);
  if (defects.length > 0) {
    console.error(`css-contract: ${String(defects.length)} defect(s) in ${dir}`);
    process.exit(1);
  }
  console.log(`css-contract: OK (${dir})`);
}

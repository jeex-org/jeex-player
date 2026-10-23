/**
 * Ambient types for Vite's asset query suffixes.
 *
 * `?inline` on a stylesheet hands the file over as TEXT instead of injecting a
 * `<style>` tag, which is what lets `viewer-shell.ensureViewerStyles` put the
 * component sheet into a shadow root as well as a document. The project does
 * not pull in `vite/client` (it would drag `import.meta.env` typings the code
 * declares itself), so the one suffix in use is declared here.
 */

declare module '*.css?inline' {
  const css: string;
  export default css;
}

/**
 * A bare `.css` import is a side effect: Vite injects the stylesheet and the
 * module has no value. TypeScript 7 defaults `noUncheckedSideEffectImports` to
 * `true`, so a side-effect import of a file the compiler cannot resolve is an
 * error unless the module is declared — this is that declaration.
 */
declare module '*.css';

/**
 * The library's own semver, textually substituted by `vite.config.ts` /
 * `vite.lib.config.ts` (`define`, from `package.json#version`) in a Vite
 * build, and by `bunfig.toml`'s `[define]` under `bun test`/`bun run`
 * (verified against the Bun 1.4.2 documentation). Read
 * through exactly one point, `src/shared/version.ts`.
 */
declare const __JEEX_VIEWER_VERSION__: string;

/**
 * The content hash of the Basis transcoder pair the build emits beside the
 * bundles (`scripts/basis-transcoder-plugin.ts`, `define`). Absent under
 * `bun test`; read through exactly one point, `src/materials/ktx2.ts`.
 */
declare const __JEEX_BASIS_TRANSCODER__: string | undefined;

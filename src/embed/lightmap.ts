/**
 * `jeex-viewer/lightmap`: the published entry for a LIGHT BAKE pipeline — the
 * tool that renders a scene's lightmaps offline and hands them back to the
 * player. It takes the two inputs of that bake from the player itself, so the
 * baked light matches what the player draws live:
 *
 * - the lights: `bakeLights` (sun, sky and every lamp of a scene, in the units
 *   of the lighting standard) with `SHIPPED_BANK` for the player's own asset
 *   bank, the recipes it records (`BAKE_LIGHTS_RECIPE`,
 *   `BAKE_SKY_HEMISPHERE_RECIPE`), and `bakeLightsSchema` / `judgeBakeLights`
 *   to check an answer read back from disk;
 * - the shell: `exportShellForBake` (the walls, floors and ceilings as a GLB
 *   whose node names the caller mints) with `SHIPPED_FINISHES` for the
 *   player's own finishes, and `shellGltfSchema` / `judgeShellGltf` for the
 *   glTF JSON of such a file.
 *
 * Unlike `jeex-viewer/schema`, this entry builds geometry, so it runs three.js:
 * the consumer's own, which the library build leaves as an import
 * (`vite.lib.config.ts`, pass `lightmap`), like Zod. It needs no browser.
 */

export { SHIPPED_BANK, bakeLights } from '../lightmap/bake-lights.js';
export type { BakeBank, LampCollector } from '../lightmap/bake-lights.js';
export { BAKE_LIGHTS_RECIPE, BAKE_SKY_HEMISPHERE_RECIPE, bakeLightsSchema, judgeBakeLights } from '../lightmap/bake-lights.schema.js';
export type { BakeLamp, BakeLights, BakeLightsVerdict } from '../lightmap/bake-lights.schema.js';
export { SHIPPED_FINISHES, exportShellForBake } from '../lightmap/shell-export.js';
export type { ShellExport, ShellExportOptions } from '../lightmap/shell-export.js';
export { judgeShellGltf, shellGltfSchema } from '../lightmap/shell-extras.schema.js';
export type { ShellGltf, ShellGltfVerdict, ShellNodeExtras } from '../lightmap/shell-extras.schema.js';

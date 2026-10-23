/**
 * Where a scene document's plan faces and which sun lights it (schema 2.3):
 * split out of `types.ts`, which re-exports both names unchanged, to keep the
 * document schema one table a reader can hold. Same `scene/types` layer; it
 * imports nothing.
 *
 * Types only: no `three`, no DOM.
 */

/** The sun presets a `site` may name (schema 2.3). */
export type SiteSun = 'morning' | 'noon' | 'evening';

/** Where the plan faces (schema 2.3): `northDeg` is true north's world azimuth, degrees clockwise from +Z towards +X; absent 0. `sun` absent is `noon`. */
export type SceneSite = { readonly northDeg?: number; readonly sun?: SiteSun };

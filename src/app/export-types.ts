/**
 * Option and state shapes shared between the export modules
 * (`export-gltf.ts`, `export-usdz.ts`) and `viewer-handle.ts`.
 *
 * A genuine LEAF: no imports at all. `viewer-handle.ts`'s `ViewerHandle`
 * contract needs `ExportGlbOptions`/`ExportUsdzOptions` for its `exportGlb`/
 * `exportUsdz` members, and the export modules need the same two types for
 * their own function signatures — declaring either type in EITHER of those
 * modules made the other side import it, and `export-gltf.ts` separately
 * needed `ViewerState`'s two fields for `ExportDeps.getState()`, which closed
 * the loop back to `viewer-handle.ts`. `dependency-cruiser` counts type-only
 * edges the same as value ones (`.dependency-cruiser.cjs` header: "Type-only
 * imports count"), so that shape was a real `no-circular` violation, not
 * just an import-order nit. This module is where such shared shapes live
 * instead, so neither side ever imports the other.
 */

export type ExportGlbOptions = {
  /** Whether the furniture group is exported. Default `true`. */
  includeFurniture?: boolean;
  /** `'current'` exports the scene's painted finishes; `'default'` exports the catalogue's own looks, with every override stripped. Default `'current'`. */
  state?: 'current' | 'default';
  /** Whether the full `SceneData` document rides along in `extras.jeex.document`. Default `true`. */
  embedDocument?: boolean;
};

export type ExportUsdzOptions = {
  /** Whether the furniture group is exported. Default `true`. */
  includeFurniture?: boolean;
};

/**
 * The two `ViewerState` fields an export needs, spelled out here rather than
 * imported from `viewer-handle.ts` (see the module header) — `sceneId` and
 * `rev` are `ViewerState`'s own contract, so a change there is expected to
 * touch this literal too.
 */
export type ExportSceneState = { sceneId: string | null; rev: number };

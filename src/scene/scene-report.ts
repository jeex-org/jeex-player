/**
 * The completeness report's shape: what `scene/completeness.ts` raises and an
 * importer outside this repository builds to the SAME shape for its own import
 * report, which is why `embed/ops.ts` and `embed/index.ts` publish it (the
 * shared shape is a package boundary).
 *
 * Pure leaf module: types only, no imports, so every layer may name it.
 */

/** How serious one completeness finding is. */
export type SceneReportSeverity = 'info' | 'warning' | 'error';

/** One finding `checkCompleteness` raised, in the shape an import report uses. */
export type SceneReportEntry = {
  /** kebab-case, stable across versions, e.g. `'room-no-door'`. */
  readonly code: string;
  readonly severity: SceneReportSeverity;
  /** One sentence, English, numbers included (no separate formatting step). */
  readonly message: string;
  readonly entity?: { readonly kind: string; readonly id: string };
  /** JSON path in the scene document. */
  readonly path?: string;
  /** The numeric/boolean/string payload behind `message`. */
  readonly detail?: Readonly<Record<string, number | string | boolean | null>>;
};

/** `checkCompleteness`'s whole log, plus a running count by severity. */
export type SceneReport = {
  readonly entries: readonly SceneReportEntry[];
  readonly counts: Readonly<Record<SceneReportSeverity, number>>;
};

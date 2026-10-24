/**
 * The refusal of a light bake: a sidecar, a shell, a page or a binding that
 * does not fit. Whatever the reason, the whole bake is discarded and the
 * shell keeps its live lighting, so the code is `project-invalid` (a light
 * bake belongs to a published project) and `reason` names the rule.
 */

import { ViewerLibError, type ViewerLibErrorOptions } from '../shared/errors.js';

/** Why a light bake was refused. */
export type LightBakeRefusal = 'sidecar' | 'shell' | 'page' | 'binding' | 'shader';

export class LightBakeError extends ViewerLibError {
  readonly reason: LightBakeRefusal;

  constructor(reason: LightBakeRefusal, message: string, options?: ViewerLibErrorOptions) {
    super('project-invalid', message, options);
    this.name = 'LightBakeError';
    this.reason = reason;
  }
}

/**
 * The modes the authoring rig lives in: the tour-camera overlay, its preview
 * card and the asset move tool work in `orbit` and `plan3d`, and `walk` and
 * `tour` hide them, because there the visitor sees the flat.
 *
 * A module of its own so the eager stage and the lazily loaded tools read the
 * same set without the boot bundle importing either tool.
 */

import type { ViewerMode } from '../scene/types.js';

/** Where the authoring rig is drawn: hidden in `walk` and `tour`, where the visitor sees the flat. */
export const AUTHORING_MODES: ReadonlySet<ViewerMode> = new Set<ViewerMode>(['orbit', 'plan3d']);

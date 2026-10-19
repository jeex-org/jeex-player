/**
 * The visible names of the five viewing modes.
 *
 * They are product terms, like a brand name, and read the same in every
 * locale: a Spanish
 * page shows `Walk`, never `Paseo`. That is why they are NOT message keys —
 * no shipped catalogue and no host catalogue passed to `registerLocale` can
 * override them, because nothing ever asks a catalogue for them. What stays
 * localized is the accessible description (`title`, from `live.mode.*`) and
 * the Tour button's Pause state, which is an action, not a mode name.
 */
import type { ViewerMode } from '../scene/types.js';

export const MODE_LABELS: Readonly<Record<ViewerMode, string>> = Object.freeze({
  plan2d: '2D',
  plan3d: '3D',
  orbit: '360',
  walk: 'Walk',
  tour: 'Tour',
});

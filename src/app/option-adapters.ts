/**
 * The two READ adapters over `OPTION_SCHEMA`: how a query string and an HTML
 * dataset spell the options.
 *
 * They live beside the contract (`viewer-options.ts`) rather than in it: that
 * file sits at its 700-line limit and these two are leaves — both are two-line
 * wrappers over `optionsFromRecord`, which is syntactic (it reads a string and
 * puts it where the option lives, garbage included), so an invalid value is
 * reported once, in one place, with one message, whatever door it came in
 * through. This module imports the contract one way; nothing imports it back.
 *
 * Pure module: no `three`, no DOM (a `DOMStringMap` is read as a plain record,
 * and `URLSearchParams` is a language global).
 */

import { optionsFromRecord, type DeepPartial, type ViewerOptions } from './viewer-options.js';
import type { LogSink } from '../shared/logger.js';

/** Every `OPTION_SCHEMA` row's `?<query>=` spelling (demo, dev, iframe embed), e.g. `?view=walk&tourStart=0.25&chrome=0`. */
export function optionsFromQuery(search: string, log?: LogSink): DeepPartial<ViewerOptions> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return optionsFromRecord((key) => params.get(key) ?? undefined, 'query', log);
}

/** Every `OPTION_SCHEMA` row's `data-<attr>` spelling (embedding), e.g. `data-view`, `data-tour-start`, `data-chrome`. */
export function optionsFromDataset(dataset: DOMStringMap, log?: LogSink): DeepPartial<ViewerOptions> {
  return optionsFromRecord((key) => dataset[key], 'attr', log);
}

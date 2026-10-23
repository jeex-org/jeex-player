/**
 * The half of `<jeex-viewer>` that is the viewer: imported by the element's
 * first start (`element.ts`, `loadRuntime`), never by the element bundle
 * itself, so a page that pastes the tag downloads the viewer only when a
 * player is about to be seen.
 *
 * It is the one place the element reaches the composition root, which is
 * what lets the bundler leave the whole viewer — three.js included — out of
 * the element entry's static graph.
 */

import { mountViewerAs } from '../app/viewer-api.js';
import type { DeepPartial, ViewerOptions } from '../app/viewer-options.js';
import type { ViewerHandle } from '../app/viewer-handle.js';
import { ensureViewerStyles } from '../ui/viewer-shell.js';

/** What the element needs from the viewer, once it starts. */
export type ElementRuntime = {
  /**
   * Builds the viewer into `container`. A container inside a shadow root
   * gets the component stylesheet first, as one holder of it for the life of
   * the element (`ensureViewerStyles`).
   */
  mount(container: HTMLElement, options: DeepPartial<ViewerOptions>): ViewerHandle;
};

export const elementRuntime: ElementRuntime = {
  mount(container, options) {
    const root = container.getRootNode();
    if (root instanceof ShadowRoot) ensureViewerStyles(root);
    return mountViewerAs({ embed: 'element' }, container, options);
  },
};

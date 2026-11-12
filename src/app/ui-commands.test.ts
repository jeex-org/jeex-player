/**
 * The control bar's command bag: what it hands on when fullscreen cannot be
 * entered.
 */

import { describe, expect, test } from 'bun:test';
import { uiCommands } from './ui-commands.js';
import { createMessages, renderText, type LocalisedText, type Messages } from '../ui/messages.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';
import type { TourControls } from '../camera/tour-controls.js';
import type { SceneMount } from './scene-mount.js';
import type { HandleCommands } from './handle-commands.js';

describe('toggleFullscreen in a browser without the API', () => {
  test('the hint it raises follows setLocale while it is on screen', async () => {
    // The hint card as the chrome keeps it: the text as raised, written in the catalogue of the moment.
    let messages: Messages = createMessages('en');
    let hint: LocalisedText = '';
    const shown = (): string => renderText(hint, messages);
    const commands = uiCommands({
      mount: () => ({}) as SceneMount,
      shell: () => ({ toggle: () => Promise.resolve(false), isFullscreen: () => false }) as unknown as FullscreenController,
      tour: {} as TourControls,
      director: () => undefined,
      handle: () => ({}) as HandleCommands,
      onFullscreenUnavailable: (text) => {
        hint = text;
      },
    });
    await commands.toggleFullscreen();
    expect(shown()).toBe(createMessages('en').t('hint.fullscreenUnavailable'));
    messages = createMessages('de');
    expect(shown()).toBe(createMessages('de').t('hint.fullscreenUnavailable'));
  });
});

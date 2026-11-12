/**
 * The handle's mode switch before the stage exists: nothing is on screen to
 * switch, so the mode is remembered for the start view rather than announced.
 */

import { describe, expect, test } from 'bun:test';
import { handleCommands } from './handle-commands.js';
import { ViewerEvents } from './viewer-events.js';
import { DEFAULT_VIEWER_OPTIONS } from './viewer-options.js';
import type { ViewerMode } from '../scene/types.js';
import { defaultLogger } from '../shared/logger.js';

/** The commands over a viewer whose stage has not been built yet. */
function beforeTheStage() {
  const events = new ViewerEvents();
  const modes: ViewerMode[] = [];
  const buttons: ViewerMode[] = [];
  events.on('mode', (mode) => modes.push(mode));
  const commands = handleCommands({
    stage: () => undefined,
    ui: {
      setLightTemperature: () => undefined,
      setModeButtons: (mode: ViewerMode) => buttons.push(mode),
      setHintForMode: () => undefined,
    } as never,
    events,
    tour: {} as never,
    mount: () => ({}) as never,
    animator: {} as never,
    context: { slots: {} } as never,
    options: DEFAULT_VIEWER_OPTIONS,
    furnitureVisible: () => true,
    setFurnitureVisible: () => undefined,
    messages: () => ({}) as never,
    setMessages: () => undefined,
    log: defaultLogger,
  });
  return { commands, modes, buttons };
}

describe('setMode before the stage exists', () => {
  test('is remembered for the start view, not announced, and getMode reads it back', () => {
    const { commands, modes, buttons } = beforeTheStage();
    commands.setMode('walk');
    expect(modes).toEqual([]);
    expect(buttons).toEqual([]);
    expect(commands.getMode()).toBe('walk');
    expect(commands.takeRequestedMode()).toBe('walk');
    expect(commands.takeRequestedMode()).toBeNull();
  });
});

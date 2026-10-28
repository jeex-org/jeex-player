/**
 * The debug host's own judgements. Everything else is a one-hop getter onto a
 * collaborator (`debug-parts.ts`); what is worth pinning here is the read that
 * must NOT follow the stage: the application-level quality control outlives
 * the stage, and a no-stage window must still answer for it.
 */

import { describe, expect, test } from 'bun:test';
import { debugHostFor } from './debug-parts.js';
import type { QualityControl } from './quality-control.js';
import type { SceneModel } from '../scene/scene-model.js';
import type { DoorController } from './door-controller.js';
import type { SceneMount } from './scene-mount.js';
import type { ViewerOptions } from './viewer-options.js';
import type { FullscreenController } from '../ui/fullscreen-controller.js';
import type { TourControls } from '../camera/tour-controls.js';

describe('debugHostFor', () => {
  test('quality reads the application-level control where no stage exists', () => {
    // Before the first boot, between boots and after teardown `stage()` is
    // undefined, and a `quality="low"` mount must still report `fixed/low`
    // (the control belongs to the application, not the stage).
    const host = debugHostFor({} as SceneModel, {
      options: {} as ViewerOptions,
      mount: {} as SceneMount,
      doors: {} as DoorController,
      shell: {} as FullscreenController,
      tour: {} as TourControls,
      messages: () => {
        throw new Error('debugHostFor: the messages are not part of this test');
      },
      stage: () => undefined,
      furnitureVisible: () => true,
      quality: () => ({ debug: () => ({ mode: 'fixed', tier: 'low' }) }) as QualityControl,
      projectLibrary: () => undefined,
    });
    expect(host.quality()).toEqual({ mode: 'fixed', tier: 'low' });
  });
});

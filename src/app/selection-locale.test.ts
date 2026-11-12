/**
 * The selection a host reads speaks the viewer's CURRENT language: the mount
 * locale from the first answer, and the locale `setLocale` chose from the
 * next answer on. `ViewerHandle.describeSelection` answers through the scene
 * mount's editor, so the test wires the mount, the editor and the handle the
 * way `viewer-app.ts` does, with the real catalogues and a real document.
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { shippedAssetFacts } from '../assets/asset-facts.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { L_SHAPE } from '../fixtures/plan-l-shape-ids.js';
import { FurnitureAnimator } from '../geometry/furniture-animator.js';
import { Picker } from '../geometry/picker.js';
import { SceneModel } from '../scene/scene-model.js';
import { defaultLogger } from '../shared/logger.js';
import type { Dollhouse } from '../geometry/dollhouse.js';
import { createMessages, type Locale, type Messages } from '../ui/messages.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import { editsWiring } from './edits-wiring.js';
import { handleCommands } from './handle-commands.js';
import { SceneMount } from './scene-mount.js';
import { ViewerEvents } from './viewer-events.js';
import { DEFAULT_VIEWER_OPTIONS, resolveViewerOptions } from './viewer-options.js';

const DOOR = L_SHAPE.opening.doorAb;
const SOFA = L_SHAPE.asset.sofa;

/** A viewer mounted in `locale`: the scene mount and the handle over it, sharing one catalogue as `viewer-app.ts` does. */
function viewerIn(locale: Locale) {
  let messages: Messages = createMessages(locale);
  const ui = {
    showDegradedNotice: () => {},
    closePanel: () => {},
    openPanel: () => {},
    setHint: () => {},
    wakeControls: () => {},
    setProjectMark: () => {},
    retranslate: () => {},
    setLightTemperature: () => {},
  } as unknown as ViewerUI;
  const mount = new SceneMount({
    runtime: () => ({ scene: new THREE.Scene(), demand: { invalidate: () => {} } }),
    picker: new Picker({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }),
    dollhouse: { prepare: () => {}, isExterior: () => false, update: () => {} } as unknown as Dollhouse,
    animator: new FurnitureAnimator(),
    ui,
    messages: () => messages,
    renderPreview: () => null,
    edits: editsWiring(resolveViewerOptions({}), () => {}),
    onDocument: () => {},
    onAssetsChanged: () => {},
    onModelsSettled: () => {},
    onError: (error) => {
      throw new Error(error.message);
    },
  });
  const handle = handleCommands({
    stage: () => undefined,
    ui,
    events: new ViewerEvents(),
    tour: {} as never,
    mount: () => mount,
    animator: new FurnitureAnimator(),
    context: { slots: {}, retranslate: (next: Locale) => createMessages(next) } as never,
    options: DEFAULT_VIEWER_OPTIONS,
    furnitureVisible: () => true,
    setFurnitureVisible: () => {},
    messages: () => messages,
    setMessages: (next) => {
      messages = next;
    },
    log: defaultLogger,
  });
  mount.mountDocument({
    model: new SceneModel(lShapePlan, CATALOGUE_REGISTRIES),
    project: {
      key: 'selection-locale',
      info: { manifest: {}, baseUrl: '' } as never,
      offers: null,
      facts: shippedAssetFacts,
      registries: CATALOGUE_REGISTRIES,
      variants: undefined as never,
      builderOptions: {},
    },
    revisionGiven: false,
  });
  return handle;
}

describe('describeSelection speaks the current locale', () => {
  test('the door heading: German from the mount locale, French after setLocale', () => {
    const handle = viewerIn('de');
    expect(handle.describeSelection({ kind: 'opening', id: DOOR, mode: 'orbit' })?.title).toBe('Ersetzen · Tür');
    handle.setLocale('fr');
    expect(handle.describeSelection({ kind: 'opening', id: DOOR, mode: 'orbit' })?.title).toBe('Remplacer · Porte');
  });

  test('the furniture heading follows the same catalogue', () => {
    const handle = viewerIn('de');
    expect(handle.describeSelection({ kind: 'furniture', id: SOFA, mode: 'orbit' })?.title).toStartWith('Ersetzen · ');
    handle.setLocale('fr');
    expect(handle.describeSelection({ kind: 'furniture', id: SOFA, mode: 'orbit' })?.title).toStartWith('Remplacer · ');
  });
});

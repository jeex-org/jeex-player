/**
 * The asset move wiring between the tool and the running viewer: an edit the
 * host has not answered survives the `scene` event a host fires when it hands
 * the SAME document back at the same revision (`SceneMount.present` commits
 * nothing and re-seeds), so a refusal after it still puts the body back.
 *
 * Real tool, session and model; the stage, the mount and the DOM roots are
 * stand-ins (no WebGL and no pointer are needed for a turn and a revert).
 */

import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { DEMO } from '../demo/demo-ids.js';
import { apartmentScene } from '../demo/scene-data.js';
import { shippedFacts } from '../layout/layout-lint.js';
import { SceneModel } from '../scene/scene-model.js';
import type { ViewerUI } from '../ui/viewer-ui.js';
import type { ViewerRoots } from '../ui/viewer-shell.js';
import { assetMoveWiring } from './asset-move-wiring.js';
import type { SceneMount } from './scene-mount.js';
import { ViewerEvents } from './viewer-events.js';
import type { ViewerStage } from './viewer-stage.js';

const SOFA = DEMO.asset.livingSofa;

/** The wiring over a mounted demo flat in `orbit`, with the sofa's body in the graph and selected. */
function wired() {
  const model = SceneModel.load(apartmentScene, CATALOGUE_REGISTRIES);
  const placement = model.scene.assets.find((asset) => asset.id === SOFA)!;
  const body = new THREE.Group();
  body.userData = { assetId: SOFA, archetypeId: placement.type };
  body.position.set(placement.position.x, placement.position.y, placement.position.z);
  body.rotation.y = placement.rotationY ?? 0;
  const sceneRoot = new THREE.Group();
  sceneRoot.add(body);
  const mount = { model, sceneRoot, layoutCatalogue: () => shippedFacts } as unknown as SceneMount;
  const camera = new THREE.PerspectiveCamera();
  const stage = {
    mode: 'orbit',
    camera,
    pickCamera: () => camera,
    planModes: { activeCamera: () => null },
    selection: { selected: () => ({ kind: 'asset', id: SOFA }), tint: () => {} },
    runtime: { scene: new THREE.Scene(), demand: { invalidate: () => {} }, addFrameHook: () => {}, removeFrameHook: () => {} },
  } as unknown as ViewerStage;
  const element = { addEventListener: () => {}, removeEventListener: () => {}, style: {}, parentElement: null };
  const events = new ViewerEvents();
  const wiring = assetMoveWiring({
    stage: () => stage,
    mount: () => mount,
    events,
    ui: { setHintForMode: () => {} } as unknown as ViewerUI,
    roots: { canvas: element, viewport: element, root: element } as unknown as ViewerRoots,
    signal: new AbortController().signal,
  });
  return { model, body, events, wiring, start: { x: body.position.x, z: body.position.z, yaw: body.rotation.y } };
}

describe('the same document handed back at the same revision answers no pending edit', () => {
  test('an asset edit, the `scene` event for that document again, then revert: the body is back where it stood', async () => {
    const { model, body, events, wiring, start } = wired();
    wiring.setEnabled(true);
    await wiring.loaded();
    const edits: unknown[] = [];
    events.on('assetEdit', (edit) => edits.push(edit));
    expect(wiring.turnAsset(SOFA, 2)).toBe(true);
    expect(edits).toHaveLength(1);
    expect(body.rotation.y).not.toBeCloseTo(start.yaw, 6);

    events.emit('scene', { sceneId: model.scene.id, rev: model.rev });
    wiring.revert();
    expect(body.rotation.y).toBeCloseTo(start.yaw, 6);
    expect(body.position.x).toBeCloseTo(start.x, 6);
    expect(body.position.z).toBeCloseTo(start.z, 6);
    wiring.dispose();
  });
});

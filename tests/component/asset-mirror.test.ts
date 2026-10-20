/**
 * Mirroring on a real WebGL mount: `handle.mirrorAsset` emits `mirror_object` for the host to commit,
 * says `false` for an axis the asset does not allow, and once the host has
 * committed the edit the selection description and the glTF export both carry
 * the mirror.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import type { ViewerHandle } from '../../src/app/viewer-handle.js';
import type { AssetEdit } from '../../src/edit/asset-move-tool.js';
import type { AssetMoveDebug } from '../../src/edit/asset-move-session.js';
import { DEMO } from '../../src/demo/demo-ids.js';
import type { SceneOp } from '../../src/scene/types.js';
import { ASSET_MOVE_CHUNK_TIMEOUT_MS, closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

type Debug = {
  mode: () => string | undefined;
  assetMove: () => AssetMoveDebug;
  applyOps: (ops: SceneOp[]) => { rev?: number; error?: unknown };
};

const handles: ViewerHandle[] = [];

function debug(): Debug {
  return (window as unknown as { __viewerDebug: Debug }).__viewerDebug;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  closeContainers();
});

/** The glTF JSON chunk of a GLB. */
async function gltfJson(blob: Blob): Promise<{ nodes: Array<{ name?: string; scale?: number[]; matrix?: number[] }> }> {
  const bytes = new DataView(await blob.arrayBuffer());
  const length = bytes.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.buffer, 20, length))) as {
    nodes: Array<{ name?: string; scale?: number[]; matrix?: number[] }>;
  };
}

/** How many nodes of the GLB export are reflected: the exporter writes a column-major matrix, a reflection has a negative determinant. */
async function reflectedNodes(handle: ViewerHandle): Promise<number> {
  const json = await gltfJson(await handle.exportGlb({ embedDocument: false }));
  return json.nodes.filter((node) => {
    const m = node.matrix;
    if (!m) return (node.scale ?? []).some((value) => value < 0);
    return (
      m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!) < 0
    );
  }).length;
}

/**
 * The test below mounts the demo apartment and exports it to GLB twice
 * (before and after the commit), so it declares its own budget the way the
 * other export tests do instead of living on the 60 s light-path default. On
 * SwiftShader one export of the apartment costs 30-40 s: the test measured
 * 61-62 s inside a full tier run, where the default killed it, and 90-105 s
 * alone on a busy machine.
 */
const MOUNT_PLUS_TWO_EXPORTS_TIMEOUT_MS = 180_000;

describe('mirrorAsset', { timeout: MOUNT_PLUS_TWO_EXPORTS_TIMEOUT_MS }, () => {
  test('emits mirror_object; the committed mirror reaches describeSelection and the glTF export', async () => {
    const container = openContainer();
    const handle = mountViewer(container, {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      debug: true,
    });
    handles.push(handle);
    await handle.ready;
    const edits: AssetEdit[] = [];
    handle.on('assetEdit', (edit) => edits.push(edit));
    handle.setMode('orbit');
    await until(() => debug().mode() === 'orbit', 'orbit');
    const sofa = DEMO.asset.livingSofa;
    // Not armed yet: nothing happens.
    expect(handle.mirrorAsset(sofa, 'x')).toBe(false);
    handle.setAssetMoveTool(true);
    await until(() => debug().assetMove().loaded, 'the asset move chunk', ASSET_MOVE_CHUNK_TIMEOUT_MS);
    await nextFrame();

    expect(handle.describeSelection({ kind: 'furniture', id: sofa, mode: 'orbit' })?.mirror).toEqual({
      allowed: ['x'],
      current: [],
    });
    expect(handle.mirrorAsset(sofa, 'z')).toBe(false);
    expect(handle.mirrorAsset(DEMO.asset.livingTvUnit, 'x')).toBe(false);
    expect(handle.mirrorAsset(sofa, 'x')).toBe(true);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.ops[0]).toEqual({ op: 'mirror_object', assetId: sofa, mirror: { x: true } });
    expect(edits[0]!.gesture).toBe('mirror');

    const before = await reflectedNodes(handle);
    // The host commits what it was handed.
    const applied = debug().applyOps([...edits[0]!.ops]);
    expect(applied, JSON.stringify(applied)).toHaveProperty('rev');
    await nextFrame();
    expect(handle.getScene()?.assets.find((asset) => asset.id === sofa)?.mirror).toEqual({ x: true });
    expect(handle.describeSelection({ kind: 'furniture', id: sofa, mode: 'orbit' })?.mirror?.current).toEqual(['x']);

    expect(await reflectedNodes(handle)).toBeGreaterThan(before);
  });
});

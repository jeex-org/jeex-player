/**
 * Painting: a floor, a room's walls, one face on its own and the facade — and
 * the exported draft, which is what makes the model the source of truth.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import type { FaceKey } from '../../src/scene/types.js';
import type { CheckContext } from './context.js';
import type { Pick } from './probes.js';
import { PICK_FACADE, pickFloorScript, pickWallFaceScript } from './page-code.js';
import { pressControl, waitForCameraStill } from './step.js';

const { room: ROOM, wall: WALL } = DEMO;

/** The bay's exterior face: the facade side of the curved living-room wall. */
const BAY_EXTERIOR: FaceKey = { wallId: WALL.bayLiving, side: 'R' };

/** Floor, room-wall, per-face and facade painting, and the exported draft. */
export async function checkFinishes(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, applyFinish, literal } = ctx;
  /** Every kitchen face with the wall finish it shows, as `[face, finish]` pairs. */
  const kitchenFaces = `(() => { const d = window.__viewerDebug; return JSON.stringify(d.faces(${literal(ROOM.kitchen)}).map((f) => [f, d.faceWall(f)])); })()`;
  // ---- Floor finish: the bathroom floor ----
  await pressControl(ctx, '[data-mode="orbit"]');
  await pressControl(ctx, '[data-jeex="reset-button"]');
  await waitForCameraStill(ctx, 'the reset flight to land');
  const bathroomFloor = await evalValue<Pick>(pickFloorScript(ROOM.bathroom));
  assert(bathroomFloor.hit, `finish panel should open for the bathroom floor (${bathroomFloor.reason ?? ''})`);
  await applyFinish(FINISH.walnut);
  const floorFinish = await evalValue<string>(`window.__viewerDebug?.floorFinish(${literal(ROOM.bathroom)})`);
  assert(floorFinish === FINISH.walnut, `bathroom floor finish should switch to walnut, got ${floorFinish}`);
  await run(['press', 'Escape']);

  // ---- Wall finish: a kitchen face, room scope ----
  const livingWallBefore = await evalValue<string>(`window.__viewerDebug?.wallFinish(${literal(ROOM.living)})`);
  const kitchenWallPick = await evalValue<Pick>(pickWallFaceScript(ROOM.kitchen));
  assert(kitchenWallPick.hit, `finish panel should open for a kitchen wall face (${kitchenWallPick.reason ?? ''})`);
  await applyFinish(FINISH.sage);
  const kitchenWall = await evalValue<string>(`window.__viewerDebug?.wallFinish(${literal(ROOM.kitchen)})`);
  const livingWall = await evalValue<string>(`window.__viewerDebug?.wallFinish(${literal(ROOM.living)})`);
  assert(kitchenWall === FINISH.sage, `kitchen wall finish should switch to sage, got ${kitchenWall}`);
  assert(livingWall === livingWallBefore, `living wall finish should stay ${livingWallBefore}, got ${livingWall}`);

  // "Only this wall": exactly one kitchen face repaints, the room finish stands.
  await run(['eval', "document.querySelector('[data-jeex=\"finish-scope-wall\"]').checked = true; 'scoped'"]);
  await applyFinish(FINISH.graphite);
  const scoped = await evalValue<{ graphite: FaceKey[]; room: string | null }>(
    `(() => { const d = window.__viewerDebug; const kitchen = ${literal(ROOM.kitchen)};` +
      ` return JSON.stringify({ graphite: d.faces(kitchen).filter((f) => d.faceWall(f) === ${literal(FINISH.graphite)}), room: d.wallFinish(kitchen) }); })()`,
  );
  assert(scoped.graphite.length === 1, `corner-to-corner scope should repaint exactly one face, got ${JSON.stringify(scoped.graphite)}`);
  const repainted = scoped.graphite[0];
  assert(
    repainted?.room === ROOM.kitchen && (repainted.side === 'L' || repainted.side === 'R'),
    `the repainted face must be a kitchen face key, got ${JSON.stringify(repainted)}`,
  );
  assert(scoped.room === FINISH.sage, `room finish should stay sage after the face-scoped repaint, got ${scoped.room}`);
  summary.push(`face-scoped repaint: ${JSON.stringify(repainted)} = graphite, kitchen room = sage`);
  await run(['press', 'Escape']);

  // ---- Painting the living room must not touch a single kitchen face ----
  // The bearing spine is 0.24 m thick and shared: kitchen owns its north side, living its south side.
  const kitchenFacesBefore = await evalValue<Array<[FaceKey, string | null]>>(kitchenFaces);
  const livingWallPick = await evalValue<Pick>(pickWallFaceScript(ROOM.living));
  assert(livingWallPick.hit, `finish panel should open for a living-room wall face (${livingWallPick.reason ?? ''})`);
  await applyFinish(FINISH.terra);
  const livingPainted = await evalValue<string>(`window.__viewerDebug?.wallFinish(${literal(ROOM.living)})`);
  assert(livingPainted === FINISH.terra, `living wall finish should switch to terra, got ${livingPainted}`);
  const kitchenFacesAfter = await evalValue<Array<[FaceKey, string | null]>>(kitchenFaces);
  assert(
    JSON.stringify(kitchenFacesBefore) === JSON.stringify(kitchenFacesAfter),
    `painting the living room must leave every kitchen face unchanged | before=${JSON.stringify(kitchenFacesBefore)} | after=${JSON.stringify(kitchenFacesAfter)}`,
  );
  assert(
    kitchenFacesAfter.some(([face]) => face.wallId === WALL.spineKitchen),
    'the kitchen must own a face of the shared 0.24 m bearing spine',
  );
  summary.push(`living painted terra, ${kitchenFacesAfter.length} kitchen faces unchanged`);
  await run(['press', 'Escape']);

  // ---- Facade: the bay exterior paints on its own ----
  const facadePick = await evalValue<Pick>(PICK_FACADE);
  assert(facadePick.hit, `finish panel should open for the facade (${facadePick.reason ?? ''})`);
  await run(['eval', "document.querySelector('[data-jeex=\"finish-scope-wall\"]').checked = true; 'scoped'"]);
  await applyFinish(FINISH.terra);
  const bayFace = await evalValue<string>(`window.__viewerDebug?.faceWall(${literal(BAY_EXTERIOR)})`);
  assert(bayFace === FINISH.terra, `the picked facade face should be the bay exterior, got ${bayFace}`);
  await run(['eval', "document.querySelector('[data-jeex=\"finish-scope-wall\"]').checked = false; 'unscoped'"]);
  await applyFinish(FINISH.terra);
  const facade = await evalValue<string>('window.__viewerDebug?.facadeWall()');
  const livingAfterFacade = await evalValue<string>(`window.__viewerDebug?.wallFinish(${literal(ROOM.living)})`);
  assert(facade === FINISH.terra, `facade finish should switch to terra, got ${facade}`);
  assert(livingAfterFacade === FINISH.terra, `living wall finish should stay terra after painting the facade, got ${livingAfterFacade}`);
  summary.push('facade painted terra through the bay exterior');
  await run(['press', 'Escape']);

  // ---- The model is the source of truth: every paint is exportable ----
  const exported = await evalValue<{
    rev: number;
    finishes: { rooms?: Record<string, { floor?: string; walls?: string }>; faces?: Array<FaceKey & { finish: string }>; facade?: string };
  }>(
    '(() => { const d = window.__viewerDebug; return JSON.stringify({ rev: d.revision(), finishes: d.exportScene().finishes ?? {} }); })()',
  );
  assert(exported.rev > 0, `painting should advance the scene revision, got ${exported.rev}`);
  assert(
    exported.finishes.rooms?.[ROOM.bathroom]?.floor === FINISH.walnut,
    `exportScene should record the bathroom floor as walnut, got ${JSON.stringify(exported.finishes.rooms?.[ROOM.bathroom])}`,
  );
  assert(
    exported.finishes.rooms?.[ROOM.kitchen]?.walls === FINISH.sage && exported.finishes.rooms?.[ROOM.living]?.walls === FINISH.terra,
    `exportScene should record the painted room walls, got ${JSON.stringify(exported.finishes.rooms)}`,
  );
  assert(exported.finishes.facade === FINISH.terra, `exportScene should record the facade finish, got ${String(exported.finishes.facade)}`);
  summary.push(`export after painting: rev ${exported.rev}, finishes ${JSON.stringify(exported.finishes)}`);
}

/**
 * Editing the document: furniture and opening variants, the wall joints that
 * survive a rebuild, a plan-level op, the export round trip, a removed doorway
 * reaching the collision system, a suggested free-space pose, and floors
 * running through the doorways.
 *
 * State handed to the next area: this one COMMITS two changes it does not undo
 * — an interior doorway is removed, and one bar stool is placed at the pose
 * the free-space helper suggested (there is no furniture-removal op). Both are
 * memoised on `window` against a retried `eval`.
 */

import { ARCHETYPE } from '../../src/assets/catalogue-ids.js';
import { DEMO } from '../../src/demo/demo-ids.js';
import { FINISH } from '../../src/materials/finish-ids.js';
import type { FaceKey } from '../../src/scene/types.js';
import type { CheckContext } from './context.js';
import type { Pick } from './probes.js';
import { HELPERS, pickFloorScript, swapVariant } from './page-code.js';
import { pressControl, waitFor, waitForCameraStill } from './step.js';

const { room: ROOM, asset: ASSET, opening: OPENING, wall: WALL } = DEMO;

/**
 * Id of the bar stool the free-space block places. `place_object` takes its id
 * from the caller, and the viewer never mints one, so the check brings a fixed
 * literal of its own.
 */
const PLACED_STOOL = '01a12fe6-af12-7488-bbf1-47b3cb0d1c06';

/** Furniture and opening variants, wall joints, a plan op, the export round
 * trip, a removed doorway, a suggested free-space pose (both committed and
 * left in place for the next area) and floor continuity. */
export async function checkEditing(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal } = ctx;
  // ---- Furniture: select and swap a variant (ids come from the panel) ----
  const bedPick = await evalValue<{ hit: boolean; id: string | null; seen?: string[] }>(`(() => {${HELPERS}
    const bedroom = D.plan().rooms.find((r) => r.id === ${literal(ROOM.bedroom)});
    const box = bedroom.bbox;
    const found = [];
    for (let u = 0.25; u <= 0.8; u += 0.1) {
      for (let v = 0.25; v <= 0.8; v += 0.1) {
        const p = D.projectPoint(box.minX + (box.maxX - box.minX) * u, 0.55, box.minZ + (box.maxZ - box.minZ) * v);
        if (!ONSCREEN(p)) continue;
        CLICK(p.x, p.y);
        const id = D.selectedFurniture();
        if (id) found.push({ id, x: p.x, y: p.y });
      }
    }
    // The bed is the tallest object of the room and the most telling variant
    // swap; anything else selecting instead means the pick proxies moved.
    const chosen = found.find((item) => item.id === ${literal(ASSET.bedroomBed)});
    if (!chosen) return JSON.stringify({ hit: false, id: null, seen: [...new Set(found.map((item) => item.id))] });
    CLICK(chosen.x, chosen.y);
    return JSON.stringify({ hit: D.selectedFurniture() === chosen.id, id: chosen.id, seen: [] });
  })()`);
  assert(bedPick.hit && Boolean(bedPick.id), `clicking the bedroom bed should select it, picked ${JSON.stringify(bedPick.seen ?? [])}`);
  const replacePanel = await evalValue<{ kind?: string; asset?: string }>(
    'JSON.stringify({ ...document.querySelector(\'[data-jeex="finish-panel"]\').dataset })',
  );
  assert(
    replacePanel.kind === 'furniture' && replacePanel.asset === bedPick.id,
    `clicking furniture should open its replace panel, panel was ${JSON.stringify(replacePanel)}`,
  );
  const newVariant = await evalValue<string>(swapVariant);
  assert(newVariant !== 'none', 'the replace panel should offer another furniture variant');
  await waitFor(
    ctx,
    `window.__viewerDebug?.assetVariant(${literal(bedPick.id)}) === ${literal(newVariant)}`,
    `the ${newVariant} variant to be committed and rebuilt`,
  );
  const swappedVariant = await evalValue<string>(`window.__viewerDebug?.assetVariant(${literal(bedPick.id)})`);
  assert(swappedVariant === newVariant, `variant swap should register ${newVariant}, got ${swappedVariant}`);
  summary.push(`furniture variant: ${bedPick.id} -> ${newVariant}`);

  // ---- Openings: select a window or door and swap its variant ----
  // Back to the default orbit camera first: it frames the bay, whose window
  // sits on the ARC wall and is picked through a proxy segmented per chord.
  // Guards against a flat proxy, which would stand half a metre proud of the facade.
  await pressControl(ctx, '[data-mode="orbit"]');
  await pressControl(ctx, '[data-jeex="reset-button"]');
  await waitForCameraStill(ctx, 'the reset flight to land');
  const openingPick = await evalValue<{ hit: boolean; id: string | null; before: string | null }>(`(() => {${HELPERS}
    const list = D.openings();
    const bayWall = ${literal(WALL.bayLiving)};
    const bay = list.filter((o) => o.wallId === bayWall);
    for (const opening of [...bay, ...list.filter((o) => o.wallId !== bayWall)]) {
      for (const dy of [0, 0.25, -0.25]) {
        const p = D.projectPoint(opening.center.x, opening.center.y + dy, opening.center.z);
        if (!ONSCREEN(p)) continue;
        CLICK(p.x, p.y);
        if (D.selectedOpening() === opening.id) return JSON.stringify({ hit: true, id: opening.id, before: D.openingVariant(opening.id) });
      }
    }
    return JSON.stringify({ hit: false, id: null, before: null });
  })()`);
  assert(openingPick.hit && Boolean(openingPick.id), 'clicking a window or door should select it');
  assert(
    openingPick.id === OPENING.windowLivingBay,
    `the curved bay window must be the first opening the default view can pick, got ${String(openingPick.id)}`,
  );
  const openingPanel = await evalValue<{ kind?: string; opening?: string; openingType?: string }>(
    'JSON.stringify({ ...document.querySelector(\'[data-jeex="finish-panel"]\').dataset })',
  );
  assert(
    openingPanel.kind === 'opening' &&
      openingPanel.opening === openingPick.id &&
      ['window', 'door', 'passage'].includes(openingPanel.openingType ?? ''),
    `picking an opening should open its replace panel, panel was ${JSON.stringify(openingPanel)}`,
  );
  const newOpeningVariant = await evalValue<string>(swapVariant);
  assert(newOpeningVariant !== 'none', 'the replace panel should offer another opening variant');
  await waitFor(
    ctx,
    `window.__viewerDebug?.openingVariant(${literal(openingPick.id)}) === ${literal(newOpeningVariant)}`,
    `the ${newOpeningVariant} opening variant to be committed and rebuilt`,
  );
  const openingVariant = await evalValue<string>(`window.__viewerDebug?.openingVariant(${literal(openingPick.id)})`);
  assert(openingVariant === newOpeningVariant, `opening variant swap should register ${newOpeningVariant}, got ${openingVariant}`);
  summary.push(`opening variant: ${openingPick.id} ${openingPick.before} -> ${newOpeningVariant}`);
  await run(['press', 'Escape']);

  // ---- The face `checkFinishes` painted, ASKED FOR rather than hard-coded ----
  // `pickWallFaceScript` walks `room.polygon` and takes the first face the
  // camera can see, so which kitchen face carries the override is a property
  // of where the room loop STARTS, not a constant — and the loop's start is a
  // canonical half-edge of the plan (`plan-graph.ts`), which
  // moved the day the traversal stopped depending on the document's wall
  // order. Reading the face back keeps the two assertions below about the
  // override SURVIVING a rebuild and a round trip, which is their subject.
  const paintedFace = await evalValue<FaceKey | null>(
    `(() => { const d = window.__viewerDebug; return JSON.stringify(d.faces(${literal(ROOM.kitchen)}).find((f) => d.faceWall(f) === ${literal(FINISH.graphite)}) ?? null); })()`,
  );
  assert(Boolean(paintedFace), 'checkFinishes should have left exactly one kitchen face painted graphite');

  // ---- Wall joints: one core per junction, and they survive a rebuild ----
  const jointsBefore = await evalValue<string[]>('JSON.stringify(window.__viewerDebug.wallJoints())');
  assert(jointsBefore.length > 0, 'the shell should build a joint core for every wall junction');
  assert(
    jointsBefore.every((name) => name.startsWith('joint-')),
    `every joint core is named joint-<nodeId>, got ${JSON.stringify(jointsBefore.slice(0, 4))}`,
  );
  summary.push(`wall joints: ${jointsBefore.length} cores`);

  // ---- Plan-level op: set_ceiling rebuilds the whole shell in place ----
  // Furniture is hidden FIRST: a rebuild builds a visible furniture group, so
  // the authoritative hidden state has to be re-applied to the new group, not
  // to the disposed one (which would bring the furniture back).
  // Idempotent on purpose: `agent-browser` retries a failed `eval`, and a
  // retried TOGGLE would put the furniture back.
  await evalValue<boolean>(
    '(() => { if (window.__viewerDebug.furniture()) document.querySelector(\'[data-jeex="furniture-button"]\').click(); return true; })()',
  );
  await run(['wait', '--fn', 'window.__viewerDebug.furnitureRendered() === false']);
  const hidden = await evalValue<{ flag: boolean; rendered: boolean | null }>(
    '(() => { const d = window.__viewerDebug; return JSON.stringify({ flag: d.furniture(), rendered: d.furnitureRendered() }); })()',
  );
  assert(!hidden.flag && hidden.rendered === false, `furniture should be hidden before the rebuild, got ${JSON.stringify(hidden)}`);

  const rebuild = await evalValue<{
    ok: boolean;
    message?: string;
    rev: number;
    ceiling: number;
    children: string[];
    openings: number;
    faceWall: string | null;
    furniture: boolean;
  }>(`(() => {
    const d = window.__viewerDebug;
    const before = d.revision();
    const result = d.applyOps([{ op: 'set_ceiling', height: 2.8 }]);
    return JSON.stringify({
      ok: !('error' in result) && d.revision() === before + 1,
      message: result.message,
      rev: d.revision(),
      ceiling: d.exportScene().ceilingHeight,
      children: d.children(),
      openings: d.openings().length,
      faceWall: d.faceWall(${literal(paintedFace)}),
      furniture: d.furniture(),
    });
  })()`);
  assert(rebuild.ok, `set_ceiling should commit (${rebuild.message ?? ''})`);
  assert(rebuild.ceiling === 2.8, `the exported ceiling height should be 2.8, got ${rebuild.ceiling}`);
  assert(
    rebuild.children.includes('parametric-shell') && rebuild.children.includes('demo-assets'),
    `the rebuilt root should still carry the shell and the furniture, got ${JSON.stringify(rebuild.children)}`,
  );
  assert(rebuild.openings > 0, 'the rebuilt shell should still expose its openings');
  assert(rebuild.faceWall === FINISH.graphite, `a face override must survive the rebuild, got ${String(rebuild.faceWall)}`);
  assert(!rebuild.furniture, 'the furniture toggle must stay off across a shell rebuild');
  const jointsAfter = await evalValue<string[]>('JSON.stringify(window.__viewerDebug.wallJoints())');
  assert(
    jointsAfter.length === jointsBefore.length,
    `the rebuilt shell must keep every joint core, ${jointsBefore.length} -> ${jointsAfter.length}`,
  );
  // The hidden state is re-applied to the NEW group as an animated ripple
  // (190 ms plus a 450 ms stagger); the END of it is observable, so wait for
  // that rather than for the duration.
  await waitFor(ctx, 'window.__viewerDebug.furnitureRendered() === false', 'the hide ripple to finish on the rebuilt group');
  const furnitureAfterRebuild = await evalValue<{ flag: boolean; rendered: boolean | null }>(
    '(() => { const d = window.__viewerDebug; return JSON.stringify({ flag: d.furniture(), rendered: d.furnitureRendered() }); })()',
  );
  assert(
    !furnitureAfterRebuild.flag && furnitureAfterRebuild.rendered === false,
    `hidden furniture must stay hidden through a shell rebuild, got ${JSON.stringify(furnitureAfterRebuild)}`,
  );
  // The rebuilt root must still be pickable: a floor click has to open its panel.
  const afterRebuildPick = await evalValue<Pick>(pickFloorScript(ROOM.living));
  assert(afterRebuildPick.hit, `the rebuilt root should stay pickable (${afterRebuildPick.reason ?? ''})`);
  // ... and walk collision has to be on the REBUILT plan, not the previous one.
  const walkAfterRebuild = await evalValue<{ inside: boolean; outside: boolean }>(`(() => {
    const d = window.__viewerDebug;
    const room = d.plan().rooms.find((r) => r.id === ${literal(ROOM.living)});
    const centre = { x: (room.bbox.minX + room.bbox.maxX) / 2, z: (room.bbox.minZ + room.bbox.maxZ) / 2 };
    return JSON.stringify({
      inside: Boolean(d.navigable(centre.x, centre.z)?.standable),
      outside: Boolean(d.navigable(room.bbox.minX - 40, room.bbox.minZ - 40)?.standable),
    });
  })()`);
  assert(walkAfterRebuild.inside, 'the living room must stay walkable after the shell rebuild');
  assert(!walkAfterRebuild.outside, 'a point outside the building must never be walkable');
  summary.push(
    `shell rebuild after set_ceiling: rev ${rebuild.rev}, ${rebuild.openings} openings, ` +
      'pickable, walkable, hidden furniture stays hidden',
  );
  // Put the furniture back, so the export round trip below sees the usual scene.
  // Idempotent on purpose: `agent-browser` retries a failed `eval`, and a
  // retried TOGGLE would hide it again.
  await evalValue<boolean>(
    '(() => { if (!window.__viewerDebug.furniture()) document.querySelector(\'[data-jeex="furniture-button"]\').click(); return true; })()',
  );
  await run(['wait', '--fn', 'window.__viewerDebug.furnitureRendered() === true']);
  await run(['press', 'Escape']);

  // ---- Export round trip: the exported draft renders identically ----
  const roundTrip = await evalValue<{
    ok: boolean;
    message?: string;
    graphite: string | null;
    before: { face: string | null; facade: string | null; floor: string | null };
    after: { face: string | null; facade: string | null; floor: string | null };
    rev: number;
  }>(`(() => {
    const face = ${literal(paintedFace)};
    // loadScene remounts the viewer and REINSTALLS the debug API around the
    // new model, so the "after" read has to go through the fresh object.
    // (No backticks in here: this whole block is a template literal.)
    const read = (api) => ({ face: api.faceWall(face), facade: api.facadeWall(), floor: api.floorFinish(${literal(ROOM.bathroom)}) });
    const before = read(window.__viewerDebug);
    const exported = window.__viewerDebug.exportScene();
    const entry = ((exported.finishes && exported.finishes.faces) || []).find(
      (f) => f.room === face.room && f.wallId === face.wallId && f.side === face.side,
    );
    const graphite = entry ? entry.finish : null;
    let ok = false;
    let message;
    try {
      ok = window.__viewerDebug.loadScene(JSON.parse(JSON.stringify(exported))) === true;
    } catch (error) {
      message = String(error && error.message ? error.message : error);
    }
    const fresh = window.__viewerDebug;
    return JSON.stringify({ ok, message, graphite, before, after: read(fresh), rev: fresh.revision() });
  })()`);
  assert(roundTrip.ok, `loadScene should accept the exported draft (${roundTrip.message ?? ''})`);
  assert(roundTrip.graphite === FINISH.graphite, `the export must carry the per-face override, got ${String(roundTrip.graphite)}`);
  assert(
    JSON.stringify(roundTrip.before) === JSON.stringify(roundTrip.after),
    `a reload must render the same finishes | before=${JSON.stringify(roundTrip.before)} | after=${JSON.stringify(roundTrip.after)}`,
  );
  assert(roundTrip.rev === 0, `a reloaded document starts at revision 0, got ${roundTrip.rev}`);
  const reloadedPick = await evalValue<Pick>(pickFloorScript(ROOM.living));
  assert(reloadedPick.hit, `the reloaded root should stay pickable (${reloadedPick.reason ?? ''})`);
  summary.push(`export round trip: ${JSON.stringify(roundTrip.after)} preserved through loadScene`);
  await run(['press', 'Escape']);

  // ---- A removed doorway reaches the collision system, not just the shell ----
  // Guarded against re-entry: `agent-browser` retries a failed `eval`, and a
  // retried removal would take a SECOND doorway out and then assert about it.
  // The first verdict is memoised on the page.
  const doorway = await evalValue<{ id: string | null; before: boolean; after: boolean; ok: boolean; message?: string }>(`(() => {
    const d = window.__viewerDebug;
    const MEMO = '__jeexRemovedDoorway';
    if (window[MEMO]) return JSON.stringify(window[MEMO]);
    const door = d.openings().find((o) => o.type !== 'window' && !o.entrance);
    if (!door) return JSON.stringify({ id: null, before: false, after: false, ok: false });
    const before = Boolean(d.navigable(door.center.x, door.center.z)?.standable);
    const result = d.applyOps([{ op: 'remove_opening', openingId: door.id }]);
    const failed = 'error' in result;
    const verdict = {
      id: door.id,
      before,
      after: Boolean(d.navigable(door.center.x, door.center.z)?.standable),
      ok: !failed,
      message: failed ? result.message : undefined,
    };
    window[MEMO] = verdict;
    return JSON.stringify(verdict);
  })()`);
  assert(doorway.ok, `removing an interior door should commit (${doorway.message ?? ''})`);
  assert(doorway.before, `the doorway of ${String(doorway.id)} should be walkable before it is removed`);
  assert(!doorway.after, `walk collision must follow the rebuilt plan: ${String(doorway.id)} is gone but still walkable`);
  summary.push(`removed ${String(doorway.id)}: doorway walkable ${doorway.before} -> ${doorway.after}`);

  // ---- Deselect by clicking a floor ----
  await evalValue<Pick>(pickFloorScript(ROOM.living));
  const deselected = await evalValue<string | null>('JSON.stringify(window.__viewerDebug?.selectedFurniture() ?? null)');
  assert(deselected === null, `clicking the floor should deselect furniture, got ${deselected}`);
  await run(['press', 'Escape']);

  // ---- Free-space helper: a suggested pose is a pose the linter accepts ----
  // Guarded against re-entry like the removed-doorway block above: a retried
  // `eval` would place a SECOND object and then assert about it.
  //
  // The room is NOT hard-coded. The demo apartment is furnished to the edges
  // (measured: the living room has no free space for a sofa or even
  // a bar stool, and the study's survivors all break rule 6), and re-authoring the
  // demo must not break this check — so it tries several rooms and reports
  // what each answered.
  await waitFor(ctx, `window.__viewerDebug.suggestPlacement(${literal(ARCHETYPE.stool_bar)}) !== null`, 'the lazy layout module to land');
  type Placed = {
    ok: boolean;
    message?: string;
    tried: string[];
    roomId: string | null;
    how: string | null;
    insidePolygon: boolean;
    before: number;
    after: number;
  };
  const placed = await evalValue<Placed>(`(() => {
    const d = window.__viewerDebug;
    const MEMO = '__jeexFreeSpace';
    if (window[MEMO]) return JSON.stringify(window[MEMO]);
    const inside = (p, poly) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
        const a = poly[i], b = poly[j];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) hit = !hit;
      }
      return hit;
    };
    const errors = () => d.layoutIssues().filter((i) => i.severity === 'error').length;
    const before = errors();
    const tried = [];
    let pose = null, roomId = null;
    for (const id of ${literal([ROOM.bedroom, ROOM.study, ROOM.guestRoom, ROOM.living])}) {
      const answer = d.suggestPlacement(${literal(ARCHETYPE.stool_bar)}, id);
      tried.push(id + ':' + (answer ? answer.how : 'null'));
      if (answer && answer.how === 'sampled') { pose = answer; roomId = id; break; }
    }
    if (!pose) {
      const none = { ok: false, tried, roomId: null, how: null, insidePolygon: false, before, after: before };
      window[MEMO] = none;
      return JSON.stringify(none);
    }
    const room = d.plan().rooms.find((r) => r.id === roomId);
    const result = d.applyOps([
      { op: 'place_object', id: ${literal(PLACED_STOOL)}, asset: ${literal(ARCHETYPE.stool_bar)}, position: pose.position, rotationY: pose.rotationY, room: pose.roomId },
    ]);
    const verdict = {
      ok: !('error' in result),
      message: 'error' in result ? result.message : undefined,
      tried,
      roomId,
      how: pose.how,
      insidePolygon: inside({ x: pose.position.x, z: pose.position.z }, room.polygon),
      before,
      after: errors(),
    };
    window[MEMO] = verdict;
    return JSON.stringify(verdict);
  })()`);
  assert(placed.how === 'sampled', `the helper should find room for a stool somewhere, tried ${JSON.stringify(placed.tried)}`);
  assert(placed.ok, `placing the suggested pose should commit (${placed.message ?? ''}), tried ${JSON.stringify(placed.tried)}`);
  assert(placed.insidePolygon, `a sampled pose must lie inside ${String(placed.roomId)}'s polygon`);
  assert(placed.after <= placed.before, `placing a suggested pose must add no layout error, ${placed.before} -> ${placed.after}`);
  summary.push(`suggestPlacement: a bar stool into ${String(placed.roomId)}, layout errors ${placed.before} -> ${placed.after}`);

  // ---- Floors run THROUGH the doorways ----
  type DoorFloor = { id: string; probes: Array<[string, string | null]> };
  const doorFloors = await evalValue<DoorFloor[]>(`(() => {
    const d = window.__viewerDebug;
    const offsets = [[0, 0], [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]];
    return JSON.stringify(${literal([OPENING.doorKitchenLiving, OPENING.doorBedroom])}.map((id) => {
      const opening = d.openings().find((entry) => entry.id === id);
      if (!opening) return { id, probes: [] };
      return {
        id,
        probes: offsets.map((o) => [o[0] + '/' + o[1], d.floorAt(opening.center.x + o[0], opening.center.z + o[1])]),
      };
    }));
  })()`);
  for (const door of doorFloors) {
    assert(door.probes.length === 5, `${door.id} should be an opening of the running scene`);
    for (const [at, room] of door.probes) {
      assert(room !== null, `no floor under ${door.id} at the centreline offset ${at} m`);
    }
    const sides = new Set(door.probes.map(([, room]) => room));
    assert(sides.size >= 2, `${door.id} should be floored from BOTH rooms, saw ${JSON.stringify([...sides])}`);
    summary.push(`${door.id}: floor continuous across the centreline (${[...sides].join(' | ')})`);
  }
}

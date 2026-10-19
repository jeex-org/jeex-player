/**
 * Doors: the hover affordance, the closing animation, a shut leaf blocking the
 * walker, the approach automation, and the `?doors=0` / `?doorsAuto=0` props.
 *
 * The area is a list of named steps (`step.ts`): a failure says which of the
 * nine it was, and the steps share the door this run happened to pick through
 * the locals they close over.
 */

import type { CheckContext } from './context.js';
import { HELPERS, WALK_HELPERS } from './page-code.js';
import { pressControl, runSteps, settle, type Step, waitFor, waitForCameraStill } from './step.js';

/**
 * The walker's deceleration after the `w` key is released, milliseconds.
 *
 * `walk-rig.ts` damps the velocity rather than dropping it, so the pose keeps
 * changing for a few frames after the keyup and there is no flag for "the
 * damping has run out". Short, and it covers a real physical duration.
 */
const WALK_STOP_MS = 200;

/** Door affordance, blocking, the approach automation and the two door props. */
export async function checkDoors(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, withQuery, url, shotDir } = ctx;

  type PlanPoint = { x: number; z: number };
  type DoorPick = { id: string | null; centre?: PlanPoint; beyond?: PlanPoint; distance?: number };

  let hovered: { id: string | null; state?: string; x?: number; y?: number } = { id: null };
  let blocked: { id: string | null; before?: boolean; after?: boolean; reopened?: boolean } = { id: null };
  let auto: DoorPick = { id: null };
  let autoId = '';
  let autoDoor = '';
  let distanceToDoor = '';
  let swingT = 0;
  let crossing = { nearOpen: false, crossedShut: false, minD: 0, hint: '' };
  let behind = { phase: '', rest: '', auto: false, armed: false, distance: 0 };
  let refused = { hint: '', distance: 0, phase: '' };

  const steps: Step[] = [
    {
      name: 'hovering a door leaf raises the HUD',
      run: async () => {
        // Which door is on screen depends on the camera, so the check SCANS the
        // doors of the running document (`doors()` + `doorScreenPoint`) and
        // works with the first one the pointer can actually reach. No pixel is
        // hard-coded.
        await pressControl(ctx, '[data-mode="orbit"]');
        await pressControl(ctx, '[data-jeex="reset-button"]');
        await waitForCameraStill(ctx, 'the reset flight to land');
        hovered = await evalValue<typeof hovered>(`(async () => {${HELPERS}
    const hud = document.querySelector('[data-jeex="door-hud"]');
    const canvas = document.querySelector('[data-jeex="scene-canvas"]');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const door of D.doors()) {
      const p = D.doorScreenPoint(door.id);
      if (!ONSCREEN(p)) continue;
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true, pointerId: 811 }));
      await frame();
      if (hud.dataset.visible === 'true' && hud.dataset.opening === door.id) {
        return JSON.stringify({ id: door.id, state: hud.dataset.state, x: p.x, y: p.y });
      }
    }
    return JSON.stringify({ id: null });
  })()`);
        assert(hovered.id !== null, 'hovering a door leaf should raise #door-hud');
        assert(hovered.state === 'open', `an open door offers "close" | data-state=${hovered.state}`);
      },
    },
    {
      name: 'pressing the HUD shuts the leaf',
      run: async () => {
        // The button is an HTML element above the canvas: pressing it toggles
        // the door and never reaches the picker.
        const door = `window.__viewerDebug.doors().find((d) => d.id === ${literal(hovered.id)})`;
        await run(['click', '[data-jeex="door-hud"]']);
        await waitFor(ctx, `${door}.phase === 'closed'`, `${String(hovered.id)} to finish shutting`);
        const shut = await evalValue<{ phase: string; t: number }>(`JSON.stringify(${door})`);
        assert(shut.phase === 'closed', `the HUD should shut the door | phase=${shut.phase} t=${shut.t}`);
      },
    },
    {
      name: 'a shut leaf blocks the walk behind it',
      run: async () => {
        // Walk collision follows the leaves: a point behind a shut door is
        // standable but not reachable, and reachable again once it opens.
        await pressControl(ctx, '[data-mode="walk"]');
        await waitForCameraStill(ctx, 'the walk entry pose');
        blocked = await evalValue<typeof blocked>(`(() => {
    const D = window.__viewerDebug;
    const cam = D.camera();
    const centres = new Map(D.openings().map((o) => [o.id, o.center]));
    for (const door of D.doors()) {
      const c = centres.get(door.id);
      if (!c || door.phase !== 'open') continue;
      const dx = c.x - cam.x;
      const dz = c.z - cam.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.4 || len > 9) continue;
      const beyond = { x: c.x + (dx / len) * 0.8, z: c.z + (dz / len) * 0.8 };
      const before = D.navigable(beyond.x, beyond.z);
      if (!before || !before.standable || !before.reachable) continue;
      D.toggleDoor(door.id);
      const after = D.navigable(beyond.x, beyond.z);
      D.toggleDoor(door.id);
      const reopened = D.navigable(beyond.x, beyond.z);
      return JSON.stringify({ id: door.id, before: before.reachable, after: after.reachable, reopened: reopened.reachable });
    }
    return JSON.stringify({ id: null });
  })()`);
        assert(blocked.id !== null, 'walk mode should find a door with walkable floor behind it');
        assert(
          blocked.before === true && blocked.after === false,
          `a closing door must block the walk behind it | ${JSON.stringify(blocked)}`,
        );
        assert(blocked.reopened === true, `re-opening the door must clear the way | ${JSON.stringify(blocked)}`);
        summary.push(`doors: HUD over ${String(hovered.id)}, click shuts it, ${String(blocked.id)} blocks and clears the walk behind it`);
      },
    },
    {
      name: '?doors=0 tracks no door state, shows no HUD, refuses to toggle',
      run: async () => {
        await run(['open', withQuery('tour=off&doors=0')]);
        await waitFor(ctx, 'window.__appReady === true', 'the ?doors=0 page to boot');
        const doorsOff = await evalValue<{ doors: number; hud: boolean; toggled: boolean }>(`(async () => {
    const D = window.__viewerDebug;
    const canvas = document.querySelector('[data-jeex="scene-canvas"]');
    const p = D.doorScreenPoint(D.openings().find((o) => o.type === 'door').id);
    if (p) canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true, pointerId: 812 }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return JSON.stringify({
      doors: D.doors().length,
      hud: Boolean(document.querySelector('[data-jeex="door-hud"]')),
      toggled: D.toggleDoor(D.openings().find((o) => o.type === 'door').id),
    });
  })()`);
        assert(doorsOff.doors === 0, `?doors=0 should track no door state | ${doorsOff.doors}`);
        assert(!doorsOff.hud, '?doors=0 should not put a HUD in the page at all');
        assert(!doorsOff.toggled, '?doors=0 should refuse to toggle a door');
        summary.push('?doors=0: no door state, no HUD, toggling refused');
      },
    },
    {
      name: 'a door three to seven metres off is picked and faced',
      run: async () => {
        // The walk is driven from the keyboard, not from a tap: a shut leaf
        // FILLS the doorway, so every pixel beyond it belongs to the door and a
        // tap there is an offer to open it by hand
        // (`camera-controller.handleClick`). The tap RULE is asserted through
        // `navigable().reachable`, which is the same `canWalkTo` a tap runs.
        await run(['set', 'viewport', '1280', '800']);
        await run(['open', withQuery('tour=off')]);
        await waitFor(ctx, 'window.__appReady === true', 'the interactive page to boot');
        await run(['click', '[data-jeex="reveal-controls"]']);
        await pressControl(ctx, '[data-mode="walk"]');
        await waitForCameraStill(ctx, 'the walk entry pose');

        // A door of the running document the walker stands well outside the
        // close radius of, with floor a metre past its leaf. No id and no metre
        // hard-coded.
        auto = await evalValue<DoorPick>(`(() => {
    const D = window.__viewerDebug;
    const cam = D.camera();
    for (const door of D.openings().filter((o) => o.type === 'door')) {
      const c = door.center;
      const dx = c.x - cam.x;
      const dz = c.z - cam.z;
      const len = Math.hypot(dx, dz);
      if (len < 3 || len > 7) continue;
      const beyond = { x: c.x + (dx / len) * 1.1, z: c.z + (dz / len) * 1.1 };
      const state = D.navigable(beyond.x, beyond.z);
      if (!state || !state.standable || !state.reachable) continue;
      return JSON.stringify({ id: door.id, centre: { x: c.x, z: c.z }, beyond, distance: len });
    }
    return JSON.stringify({ id: null });
  })()`);
        assert(auto.id !== null, 'walk mode should find a door three to seven metres off with floor beyond it');
        autoId = literal(auto.id);
        autoDoor = `window.__viewerDebug.doors().find((d) => d.id === ${autoId})`;
        distanceToDoor = `(() => { const c = window.__viewerDebug.camera(); return Math.hypot(c.x - ${auto.centre!.x}, c.z - ${auto.centre!.z}); })()`;

        await run(['eval', `(() => {${WALK_HELPERS} return FACE(${auto.beyond!.x}, ${auto.beyond!.z}); })()`]);
        await waitForCameraStill(ctx, 'the turn towards the door');
        const facing = await evalValue<{ onscreen: boolean }>(`(() => {${WALK_HELPERS}
    return JSON.stringify({ onscreen: ONSCREEN(D.projectFloorPoint(${auto.beyond!.x}, ${auto.beyond!.z})) });
  })()`);
        assert(facing.onscreen, `facing ${String(auto.id)} should put the floor beyond it on screen`);
      },
    },
    {
      name: 'a door shut from outside the close radius is rest-closed and armed',
      run: async () => {
        // Shut it from here — three metres off, outside the close radius, so
        // the automation is armed again on the very next frame.
        await run(['eval', `window.__viewerDebug.toggleDoor(${autoId})`]);
        await waitFor(ctx, `${autoDoor}.phase === 'closed'`, `${String(auto.id)} to finish shutting`);
        const armedShut = await evalValue<{ rest: string; armed: boolean; reachable: boolean }>(`(() => {
    const D = window.__viewerDebug;
    const door = ${autoDoor};
    return JSON.stringify({
      rest: door.rest,
      armed: door.armed,
      reachable: D.navigable(${auto.beyond!.x}, ${auto.beyond!.z}).reachable,
    });
  })()`);
        assert(armedShut.rest === 'closed' && armedShut.armed, `a shut door is rest-closed and armed | ${JSON.stringify(armedShut)}`);
        assert(armedShut.reachable, 'a walk tap beyond a rest-closed door is accepted while the automation is on');
      },
    },
    {
      name: 'the door opens as the walker arrives and is never crossed mid-swing',
      run: async () => {
        // Walk at it, sampling the door every frame.
        await run([
          'eval',
          `(() => {
    const D = window.__viewerDebug;
    const centre = ${literal(auto.centre)};
    const beyond = ${literal(auto.beyond)};
    const len = Math.hypot(beyond.x - centre.x, beyond.z - centre.z);
    const dir = { x: (beyond.x - centre.x) / len, z: (beyond.z - centre.z) / len };
    window.__doorProbe = { samples: [], stop: false };
    const tick = () => {
      const cam = D.camera();
      const door = ${autoDoor};
      window.__doorProbe.samples.push({
        d: Math.hypot(cam.x - centre.x, cam.z - centre.z),
        crossed: (cam.x - centre.x) * dir.x + (cam.z - centre.z) * dir.z > 0.1,
        phase: door.phase,
        t: door.t,
      });
      if (!window.__doorProbe.stop) requestAnimationFrame(tick);
    };
    tick();
    document.querySelector('[data-jeex="hint-text"]').textContent = '';
    document.querySelector('.jeex-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    return true;
  })()`,
        ]);
        // Mid-swing, as the walker arrives: the review screenshot of the approach.
        // `> 0.02` and not `< 0.98` as well: the leaf swings on the wall clock
        // (`DOOR_ANIMATION_MS`, 650 ms) while the walker moves on the frame
        // clock, so below ~1.5 fps the whole swing can fall between two frames
        // and no rendered frame is ever mid-swing (on a software rasteriser the
        // probe read t = 0 «opening», then t = 1 «open»). What the step proves
        // — open while the walker is near, never crossed while the leaf is in
        // the way — is asserted from the per-frame probe below, and `swingT`
        // in the summary says which frame the screenshot caught.
        await waitFor(ctx, `${autoDoor}.t > 0.02`, `${String(auto.id)} to start swinging`);
        swingT = await evalValue<number>(`JSON.stringify(${autoDoor}.t)`);
        await run(['screenshot', `${shotDir}/door-auto-approach.png`]);
        await waitFor(
          ctx,
          `(() => {
    const probe = window.__doorProbe;
    return probe.samples.some((s) => s.crossed) && ${distanceToDoor} > 1;
  })()`,
          'the walker to cross the doorway and get a metre past it',
          12_000,
        );
        await run([
          'eval',
          "(() => { document.querySelector('.jeex-viewer').dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true })); return true; })()",
        ]);
        await settle(ctx, WALK_STOP_MS, 'the walk velocity damping out after the keyup');
        crossing = await evalValue<typeof crossing>(`(() => {
    const probe = window.__doorProbe;
    probe.stop = true;
    return JSON.stringify({
      nearOpen: probe.samples.some((s) => s.d <= 2 && (s.phase === 'open' || s.phase === 'opening')),
      crossedShut: probe.samples.some((s) => s.crossed && s.t < 0.6),
      minD: Math.min(...probe.samples.map((s) => s.d)),
      hint: document.querySelector('[data-jeex="hint-text"]').textContent,
    });
  })()`);
        assert(crossing.nearOpen, `${String(auto.id)} should open while the walker is within two metres`);
        assert(!crossing.crossedShut, 'the walker must never cross a doorway the leaf is still in');
        assert(crossing.minD < 0.5, `the walker should reach the doorway | closest ${crossing.minD.toFixed(2)} m`);
        assert(crossing.hint === '', `a door that opens itself is not announced as shut | "${crossing.hint}"`);
      },
    },
    {
      name: 'the door shuts itself once the walker is three metres past it',
      run: async () => {
        const far = await evalValue<PlanPoint | null>(`(() => {
    const D = window.__viewerDebug;
    const centre = ${literal(auto.centre)};
    let best = null;
    for (const room of D.plan().rooms) {
      const box = room.bbox;
      for (let u = 0.1; u <= 0.9; u += 0.1) {
        for (let v = 0.1; v <= 0.9; v += 0.1) {
          const x = box.minX + (box.maxX - box.minX) * u;
          const z = box.minZ + (box.maxZ - box.minZ) * v;
          const d = Math.hypot(x - centre.x, z - centre.z);
          if (d < 3.2 || d > 6) continue;
          const state = D.navigable(x, z);
          if (!state || !state.standable || !state.reachable) continue;
          if (!best || d < best.d) best = { x, z, d };
        }
      }
    }
    return JSON.stringify(best && { x: best.x, z: best.z });
  })()`);
        assert(far !== null, 'the room beyond should offer a spot three metres from the door');
        await run(['eval', `(() => {${WALK_HELPERS} return FACE(${far!.x}, ${far!.z}); })()`]);
        await waitForCameraStill(ctx, 'the turn away from the door');
        await run([
          'eval',
          "(() => { document.querySelector('.jeex-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); return true; })()",
        ]);
        await waitFor(ctx, `${distanceToDoor} > 3`, 'the walker to get three metres past the door', 12_000);
        await run([
          'eval',
          "(() => { document.querySelector('.jeex-viewer').dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true })); return true; })()",
        ]);
        await waitFor(ctx, `${autoDoor}.phase === 'closed'`, `${String(auto.id)} to shut itself`, 4000);
        behind = await evalValue<typeof behind>(`(() => {
    const door = ${autoDoor};
    return JSON.stringify({ ...door, distance: ${distanceToDoor} });
  })()`);
        assert(
          behind.phase === 'closed' && behind.rest === 'closed' && !behind.auto && behind.armed,
          `the door should shut itself behind the walker | ${JSON.stringify(behind)}`,
        );
        // Turned round: the shut door, seen from the far side.
        await run(['eval', `(() => {${WALK_HELPERS} return FACE(${auto.centre!.x}, ${auto.centre!.z}); })()`]);
        await waitForCameraStill(ctx, 'the turn back towards the shut door');
        await run(['screenshot', `${shotDir}/door-auto-closed-behind.png`]);
        summary.push(
          `doors auto: ${String(auto.id)} shut from ${auto.distance!.toFixed(2)} m, opened on approach ` +
            `(screenshot at t=${swingT.toFixed(2)}), walked through at ${crossing.minD.toFixed(2)} m, ` +
            `shut again ${behind.distance.toFixed(2)} m past it`,
        );
      },
    },
    {
      name: '?doorsAuto=0 leaves a shut door a wall, with the hint that says so',
      run: async () => {
        await run(['open', withQuery('tour=off&doorsAuto=0')]);
        await waitFor(ctx, 'window.__appReady === true', 'the ?doorsAuto=0 page to boot');
        await run(['click', '[data-jeex="reveal-controls"]']);
        await pressControl(ctx, '[data-mode="walk"]');
        await waitForCameraStill(ctx, 'the walk entry pose');
        await run(['eval', `(() => {${WALK_HELPERS} return FACE(${auto.beyond!.x}, ${auto.beyond!.z}); })()`]);
        await waitForCameraStill(ctx, 'the turn towards the door');
        await run(['eval', `window.__viewerDebug.toggleDoor(${autoId})`]);
        await waitFor(ctx, `${autoDoor}.phase === 'closed'`, `${String(auto.id)} to shut`);
        const manual = await evalValue<{ reachable: boolean; hold: number; release: number }>(`(() => {
    const D = window.__viewerDebug;
    const hint = document.querySelector('[data-jeex="hint-text"]');
    hint.textContent = '';
    // The hint is collected per frame: it is written the frame the walker meets
    // the leaf, and a single read at the end can land after the walker has
    // slid along the wall and stopped complaining.
    window.__doorRefusal = { hints: [], stop: false };
    const tick = () => {
      if (hint.textContent) window.__doorRefusal.hints.push(hint.textContent);
      if (!window.__doorRefusal.stop) requestAnimationFrame(tick);
    };
    tick();
    document.querySelector('.jeex-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    const automation = D.doorAutomation();
    return JSON.stringify({
      reachable: D.navigable(${auto.beyond!.x}, ${auto.beyond!.z}).reachable,
      hold: automation.hold.length,
      release: automation.release.length,
    });
  })()`);
        // The refusal IS the observable: the walker meets the leaf and the hint
        // is written that frame.
        await waitFor(ctx, 'window.__doorRefusal.hints.length > 0', 'the walker to meet the shut leaf and be refused', 12_000);
        refused = await evalValue<typeof refused>(`(() => {
    document.querySelector('.jeex-viewer').dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    window.__doorRefusal.stop = true;
    return JSON.stringify({
      hint: window.__doorRefusal.hints[0] ?? '',
      distance: ${distanceToDoor},
      phase: ${autoDoor}.phase,
    });
  })()`);
        assert(!manual.reachable, '?doorsAuto=0 should close the way behind a shut door again');
        assert(manual.hold === 0 && manual.release === 0, '?doorsAuto=0 should report no automation at all');
        assert(refused.phase === 'closed', '?doorsAuto=0 must not let a door open itself');
        assert(refused.hint.includes('door is closed'), `the refusal should explain itself | "${refused.hint}"`);
        summary.push(`?doorsAuto=0: ${String(auto.id)} stays shut, the walker stops ${refused.distance.toFixed(2)} m off with the hint`);
      },
    },
    {
      name: 'back to the interactive page for the rest of the run',
      run: async () => {
        await run(['open', url]);
        await waitFor(ctx, 'window.__appReady === true', 'the demo page to boot');
        await run(['click', '[data-jeex="reveal-controls"]']);
      },
    },
  ];

  await runSteps(steps);
}

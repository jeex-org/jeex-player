/**
 * Viewport sizes, the walk spawn and its taps, the furniture toggle, room
 * focus, camera reset and fullscreen.
 *
 * Both areas are lists of named steps (`step.ts`).
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import type { Camera } from './probes.js';
import { HELPERS } from './page-code.js';
import { pressControl, runSteps, type Step, tryWaitFor, waitFor, waitForCameraStill } from './step.js';

/**
 * How long a walk started by a tap may take to show, milliseconds.
 *
 * Not a sleep: the budget on the predicate below. A headless browser throttles
 * `requestAnimationFrame`, so the walk really can take over a second to become
 * visible in the pose — and a tap that was REFUSED never will, which is the
 * other half of what the caller asserts.
 */
const WALK_START_BUDGET_MS = 2000;

/** Mobile and desktop viewports, the walk spawn and taps, the furniture toggle.
 * Leaves the page on the plain URL in orbit. */
export async function checkViewports(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, literal } = ctx;

  let spawn: Camera = { x: 0, y: 0, z: 0 };
  let blockedMoved = false;

  /** The camera has left the spawn, as a page-side expression. */
  const awayFromSpawn = (): string =>
    `(() => { const c = window.__viewerDebug?.camera(); return Boolean(c) && (Math.abs(c.x - ${spawn.x}) > 0.05 || Math.abs(c.z - ${spawn.z}) > 0.05); })()`;

  const walkTap = `(index) => {
    const room = D.plan().rooms.find((r) => r.id === ${literal(DEMO.room.living)});
    const box = room.bbox;
    const list = [];
    for (let u = 0.15; u <= 0.9; u += 0.1) {
      for (let v = 0.15; v <= 0.9; v += 0.1) {
        const p = D.projectFloorPoint(box.minX + (box.maxX - box.minX) * u, box.minZ + (box.maxZ - box.minZ) * v);
        if (ONSCREEN(p) && D.floorPoint(p.x, p.y)) list.push(p);
      }
    }
    list.sort((a, b) => b.y - a.y);
    const point = list[index];
    if (!point) return JSON.stringify({ tapped: false });
    const hint = document.querySelector('[data-jeex="hint-text"]');
    hint.textContent = '';
    CLICK(point.x, point.y);
    return JSON.stringify({ tapped: true, x: point.x, y: point.y, hint: hint.textContent });
  }`;

  const steps: Step[] = [
    {
      name: 'a phone viewport boots and switches to walk',
      run: async () => {
        await run(['set', 'viewport', '390', '844']);
        await run(['reload']);
        await waitFor(ctx, 'window.__appReady === true', 'the mobile viewport to boot');
        await run(['click', '[data-jeex="reveal-controls"]']);
        await pressControl(ctx, '[data-mode="walk"]');
        const walk = await run(['eval', "document.querySelector('[data-mode=walk]')?.getAttribute('aria-pressed') === 'true'"]);
        assert(walk.output.includes('true'), 'walk mode should activate');
      },
    },
    {
      name: 'a desktop viewport boots, and an orbit drag moves the camera',
      run: async () => {
        await run(['set', 'viewport', '1280', '800']);
        await run(['reload']);
        await waitFor(ctx, 'window.__appReady === true', 'the desktop viewport to boot');
        await run(['click', '[data-jeex="reveal-controls"]']);
        await pressControl(ctx, '[data-mode="orbit"]');
        const orbitBefore = await run(['eval', 'JSON.stringify(window.__viewerDebug?.camera())']);
        await run(['mouse', 'move', '700', '390']);
        await run(['mouse', 'down']);
        await run(['mouse', 'move', '770', '430']);
        await run(['mouse', 'up']);
        await waitForCameraStill(ctx, 'the orbit smoothing to converge after the drag');
        const orbitAfter = await run(['eval', 'JSON.stringify(window.__viewerDebug?.camera())']);
        assert(orbitBefore.output !== orbitAfter.output, 'orbit drag should change the camera');
      },
    },
    {
      name: 'walk mode snaps to the authored walkSpawn',
      run: async () => {
        // From the presentation view, not from wherever the autotour parked:
        // walk mode only snaps to `walkSpawn` when the camera it inherits is
        // not standable, and the tour leaves it standing in the middle.
        await pressControl(ctx, '[data-jeex="reset-button"]');
        await waitForCameraStill(ctx, 'the reset flight to land');
        await pressControl(ctx, '[data-mode="walk"]');
        spawn = await evalValue<Camera>('JSON.stringify(window.__viewerDebug?.camera())');
        // The expected spawn comes from the DOCUMENT (`walkSpawn`), not from a
        // copy of its coordinates: re-laying the furniture moves the spawn, and
        // a check that hard-codes metres then fails for the wrong reason. Only
        // the eye height is fixed (camera-controller EYE_HEIGHT).
        const authored = await evalValue<{ x: number; z: number }>(
          'JSON.stringify((() => { const s = window.__viewerDebug.exportScene().walkSpawn.position; return { x: s.x, z: s.z }; })())',
        );
        assert(
          Math.abs(spawn.x - authored.x) < 0.35 && Math.abs(spawn.y - 1.65) < 0.05 && Math.abs(spawn.z - authored.z) < 0.35,
          `walk mode should snap to the authored walkSpawn (${authored.x}, 1.65, ${authored.z}), got ${JSON.stringify(spawn)}`,
        );
      },
    },
    {
      name: 'a walk tap into the furnished room either walks or explains itself',
      run: async () => {
        // Candidate floor points come from the living-room bbox of the solved
        // plan; each candidate is projected and tapped inside a single eval,
        // because the walk orientation settles a frame after the mode switch and
        // a projection taken in an earlier frame would no longer match the
        // raycast of a later one.
        await waitForCameraStill(ctx, 'the walk entry orientation to settle');
        const blockedTap = await evalValue<{ tapped: boolean; hint?: string }>(`(() => {${HELPERS} return (${walkTap})(0); })()`);
        assert(blockedTap.tapped, 'walk mode should expose a reachable floor point to tap');
        blockedMoved = await tryWaitFor(ctx, awayFromSpawn(), WALK_START_BUDGET_MS);
        assert(
          blockedMoved || (blockedTap.hint ?? '').includes('No clear path'),
          `a blocked walk tap must explain itself, hint was "${blockedTap.hint ?? ''}"`,
        );
      },
    },
    {
      name: 'hiding the furniture clears the collision volumes and the same tap walks',
      run: async () => {
        // The furniture toggle is asserted unconditionally: it is a contract of
        // its own, not a fallback for a blocked tap.
        await pressControl(ctx, '[data-jeex="furniture-button"]');
        await waitFor(ctx, 'window.__viewerDebug?.furnitureRendered() === false', 'the furniture to leave the scene graph');
        assert(!(await evalValue<boolean>('window.__viewerDebug?.furniture()')), 'furniture toggle should hide furniture');

        let walkMoved = blockedMoved;
        for (let index = 0; index < 4 && !walkMoved; index += 1) {
          const tap = await evalValue<{ tapped: boolean; hint?: string }>(`(() => {${HELPERS} return (${walkTap})(${index}); })()`);
          if (!tap.tapped) break;
          walkMoved = await tryWaitFor(ctx, awayFromSpawn(), WALK_START_BUDGET_MS);
        }

        await pressControl(ctx, '[data-jeex="furniture-button"]');
        await waitFor(ctx, 'window.__viewerDebug?.furnitureRendered() === true', 'the furniture to come back');
        assert(await evalValue<boolean>('window.__viewerDebug?.furniture()'), 'furniture toggle should show furniture again');
        assert(walkMoved, `walk tap should move toward a valid floor point | spawn=${JSON.stringify(spawn)}`);
      },
    },
    {
      name: 'the furniture toggle reports both states',
      run: async () => {
        await pressControl(ctx, '[data-jeex="furniture-button"]');
        const furnitureOff = await run(['eval', 'window.__viewerDebug?.furniture()']);
        assert(furnitureOff.output.includes('false'), 'furniture toggle should hide furniture');
        await pressControl(ctx, '[data-jeex="furniture-button"]');
        const furnitureOn = await run(['eval', 'window.__viewerDebug?.furniture()']);
        assert(furnitureOn.output.includes('true'), 'furniture toggle should show furniture');
      },
    },
  ];

  await runSteps(steps);
}

/** Room focus, camera reset and the fullscreen toggle. */
export async function checkRoomFocus(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, literal } = ctx;

  const steps: Step[] = [
    {
      name: 'focusRoom flies to the room and comes back in orbit',
      run: async () => {
        // The room-name strip is gone; `focusRoom` stays.
        const beforeFocus = await run(['eval', 'JSON.stringify(window.__viewerDebug?.camera())']);
        const focused = await evalValue<boolean>(`window.__viewerDebug?.focusRoom(${literal(DEMO.room.bedroom)}) === true`);
        assert(focused, 'focusRoom should accept a room the scene has a camera for');
        await waitFor(ctx, "window.__viewerDebug?.mode() === 'orbit'", 'the flight to end in orbit mode');
        await waitFor(
          ctx,
          `JSON.stringify(window.__viewerDebug?.camera()) !== ${JSON.stringify(beforeFocus.output.trim())}`,
          'the camera to leave where it was',
        );
        assert(
          (await evalValue<number>("document.querySelectorAll('.room-pill, #room-pills').length")) === 0,
          'the room-name strip must be gone from the shell',
        );
      },
    },
    {
      name: 'reset returns to orbit',
      run: async () => {
        await pressControl(ctx, '[data-jeex="reset-button"]');
        const reset = await run(['eval', "document.querySelector('[data-mode=orbit]')?.getAttribute('aria-pressed') === 'true'"]);
        assert(reset.output.includes('true'), 'reset should return to orbit mode');
      },
    },
    {
      name: 'the fullscreen button really goes fullscreen',
      run: async () => {
        await pressControl(ctx, '[data-jeex="fullscreen-button"]');
        const fullscreen = await run(['eval', 'Boolean(document.fullscreenElement)']);
        assert(fullscreen.output.includes('true'), 'fullscreen should activate from user action');
        await run(['press', 'Escape']);
      },
    },
  ];

  await runSteps(steps);
}

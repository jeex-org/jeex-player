/**
 * Host slots, the selection anchor, the keyboard guard and `edits` (emit, and
 * off hiding the interiors button) — eight checks in one area, plus the
 * `edits: 'off'` visibility check and the notice-placement check: a degraded
 * notice steps out of a requested bottom-right slot without landing on the
 * hint card.
 *
 * What only a real browser can answer: which node `elementFromPoint` returns
 * where a slot's content overlaps the canvas, that the error card still wins
 * over a host's chrome, that a drag through the EMPTY part of a slot still
 * turns the camera, that the anchor agrees with `__viewerDebug.projectPoint`
 * to the pixel, and that four real keystrokes into a field inside a slot reach
 * the field and not the camera.
 *
 * Opens its own pages with `withViewerOptions`, never `withQuery`: an operator
 * URL may already carry `?debug=1`, and every check below reads
 * `__viewerDebug` — replacing the whole query would take that away.
 *
 * Leaves the page on a plain load for whatever runs next, and never leaves a
 * disposed viewer behind.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import { HELPERS } from './page-code.js';
import { withViewerOptions } from './session.js';
import { settle, waitForCameraStill } from './step.js';

/** How far the anchor may sit from `projectPoint`, in CSS pixels. */
const ANCHOR_TOLERANCE_PX = 2;

/**
 * One frame is not enough after `anchorTo`: the projection is published by the
 * FRAME hook, and the camera the hook reads may still be settling from the
 * page's own boot animation. `__appReady` fires before the first frame
 * (`tests/e2e/support.ts` says the same of the e2e tier), so the anchor is
 * compared only once the camera has stopped moving and a frame has published.
 */
const ANCHOR_SETTLE_MS = 400;

type AnchorReading = {
  point: { x: number; y: number; visible: boolean } | null;
  projected: { x: number; y: number } | null;
  cssX: number;
  cssY: number;
  visibleAttribute: string;
};

/** Host slots, the anchor, the keyboard guard and `edits`. Leaves the page on a plain load. */
export async function checkSlots(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, url } = ctx;

  // ---- 1. Empty by default: nobody asked, so nothing is built ----
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const bare = await evalValue<number>("document.querySelectorAll('[data-jeex-slot]').length");
  assert(bare === 0, `a viewer without ?slots= must build no slot node at all | got ${bare}`);

  // ---- 2. Exactly the named boxes; an unnamed slot is a coded refusal ----
  await run(['open', withViewerOptions(url, { tour: 'off', slots: 'bottom-center,selection-anchor' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const built = await evalValue<string[]>(
    "JSON.stringify([...document.querySelectorAll('[data-jeex-slot]')].map((b) => b.dataset.jeexSlot))",
  );
  assert(
    JSON.stringify(built) === JSON.stringify(['bottom-center', 'selection-anchor']),
    `?slots= must build exactly the names it asked for | ${JSON.stringify(built)}`,
  );
  const refusal = await evalValue<string>(`(() => {
    try { window.jeexViewer.slots.get('top-left'); return 'no-throw'; }
    catch (e) { return e.name + ':' + e.code; }
  })()`);
  assert(refusal === 'MissingSlotError:bad-params', `a slot the mount did not name must throw MissingSlotError/bad-params | ${refusal}`);

  // ---- 3. Hit-test of the content, and the error card above all of it ----
  const hit = await evalValue<{ own: boolean; tag: string }>(`(() => {
    const box = window.jeexViewer.slots.get('bottom-center');
    box.replaceChildren();
    const button = document.createElement('button');
    button.id = 'jeex-check-slot-button';
    button.textContent = 'host';
    button.style.setProperty('padding', '12px 20px');
    box.append(button);
    const r = button.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return JSON.stringify({ own: at === button, tag: at ? at.tagName + '/' + (at.id || at.className) : 'none' });
  })()`);
  assert(hit.own, `a host's own child of a slot must take the pointer | elementFromPoint gave ${hit.tag}`);

  // The error card is layer 10 and the slots are 8-9: a host's chrome may cover
  // the viewer's own panels, never the message that the scene failed.
  //
  // The card is SHOWN by hand here, by taking off the `is-hidden` class it
  // carries — the same kind of page mutation `HELPERS`' own `CLOSED()` makes to
  // the panel. A real card needs a failed BOOT, and the demo page cannot be
  // made to fail one: `main.ts` passes its fixture repository AFTER the query
  // options, so `?scene=` never reaches `resolveSceneSource`. What is under
  // test is the STACKING, and the card's own hidden state is not part of it.
  await run(['open', withViewerOptions(url, { tour: 'off', slots: 'modal-root' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const aboveCard = await evalValue<{ inCard: boolean; tag: string; cardLayer: number; slotLayer: number }>(`(() => {
    const box = window.jeexViewer.slots.get('modal-root');
    box.replaceChildren();
    const cover = document.createElement('div');
    cover.id = 'jeex-check-modal-cover';
    cover.style.setProperty('inline-size', '100%');
    cover.style.setProperty('block-size', '100%');
    box.append(cover);
    const card = document.querySelector('[data-jeex="error-state"]');
    card.classList.remove('is-hidden');
    const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const answer = {
      inCard: Boolean(at && at.closest('[data-jeex="error-state"]')),
      tag: at ? at.tagName + '/' + (at.id || at.className) : 'none',
      cardLayer: Number(getComputedStyle(card).zIndex),
      slotLayer: Number(getComputedStyle(box).zIndex),
    };
    card.classList.add('is-hidden');
    return JSON.stringify(answer);
  })()`);
  assert(
    aboveCard.slotLayer < aboveCard.cardLayer,
    `the slots must sit below the error card | slot ${aboveCard.slotLayer} vs card ${aboveCard.cardLayer}`,
  );
  assert(aboveCard.inCard, `the error card must cover the host's chrome, even a full-viewport modal-root | got ${aboveCard.tag}`);

  // ---- 4. A drag through the EMPTY part of a slot still turns the camera ----
  await run(['open', withViewerOptions(url, { tour: 'off', slots: 'bottom-center' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  await waitForCameraStill(ctx, 'the camera before the drag through a slot');
  // The drag is the `gestures-probe.ts` recipe, down to `pointerType` and the
  // frame-length pauses: a camera moves over FRAMES, so a `camera()` read taken
  // in the same task as `pointerup` reports a viewer that has not drawn yet.
  const dragged = await evalValue<{ moved: number; insideSlot: boolean }>(`(async () => {${HELPERS}
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const box = window.jeexViewer.slots.get('bottom-center');
    box.replaceChildren();
    // Stretched across the viewport and EMPTY: every pixel of it belongs to the
    // box, and none of it to the host's content.
    box.style.setProperty('inline-size', '100%');
    box.style.setProperty('block-size', '160px');
    const canvas = document.querySelector('[data-jeex="scene-canvas"]');
    const r = box.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const insideSlot = document.elementFromPoint(x, y) === canvas;
    const before = D.camera();
    const base = { bubbles: true, cancelable: true, button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse' };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 941, clientX: x, clientY: y }));
    for (let step = 1; step <= 8; step += 1) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { ...base, pointerId: 941, clientX: x + (120 * step) / 8, clientY: y }));
      await pause(16);
    }
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 941, buttons: 0 }));
    await pause(300);
    const after = D.camera();
    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    return JSON.stringify({ moved, insideSlot });
  })()`);
  assert(dragged.insideSlot, 'the empty part of a slot must be transparent to the pointer: elementFromPoint there should be the canvas');
  assert(dragged.moved > 0.05, `a drag through the empty part of a slot must turn the camera | moved ${dragged.moved.toFixed(3)} m`);

  // ---- 5. The anchor agrees with projectPoint, to the pixel ----
  await run(['open', withViewerOptions(url, { tour: 'off', slots: 'selection-anchor' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  await waitForCameraStill(ctx, 'the camera before the anchor is compared');
  const target = await evalValue<{ x: number; z: number }>(`(() => {${HELPERS}
    const room = D.plan().rooms.find((r) => r.id === ${literal(DEMO.room.living)}) ?? D.plan().rooms[0];
    const b = room.bbox;
    return JSON.stringify({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
  })()`);
  await evalValue<boolean>(
    `(() => { window.jeexViewer.slots.anchorTo({ x: ${literal(target.x)}, y: 1, z: ${literal(target.z)} }); return true; })()`,
  );
  await settle(ctx, ANCHOR_SETTLE_MS, 'the frame hook publishing the anchor onto the box');
  const reading = await evalValue<AnchorReading>(`(() => {${HELPERS}
    const box = document.querySelector('[data-jeex-slot="selection-anchor"]');
    const style = getComputedStyle(box);
    return JSON.stringify({
      point: window.jeexViewer.slots.anchorPoint(),
      projected: D.projectPoint(${literal(target.x)}, 1, ${literal(target.z)}),
      cssX: Number(style.getPropertyValue('--jeex-anchor-x')),
      cssY: Number(style.getPropertyValue('--jeex-anchor-y')),
      visibleAttribute: box.dataset.visible,
    });
  })()`);
  assert(reading.point !== null, 'anchorPoint() must answer once a target was set and a frame ran');
  assert(reading.projected !== null, 'the probe point must be in front of the camera for this comparison');
  const dx = Math.abs(reading.point!.x - reading.projected!.x);
  const dy = Math.abs(reading.point!.y - reading.projected!.y);
  assert(
    dx <= ANCHOR_TOLERANCE_PX && dy <= ANCHOR_TOLERANCE_PX,
    `the anchor must agree with __viewerDebug.projectPoint within ${ANCHOR_TOLERANCE_PX} px | dx ${dx.toFixed(2)} dy ${dy.toFixed(2)}`,
  );
  assert(
    reading.cssX === Math.round(reading.point!.x) && reading.cssY === Math.round(reading.point!.y),
    `--jeex-anchor-x/-y must be the rounded numbers the handle reports | css ${reading.cssX},${reading.cssY} vs ${reading.point!.x},${reading.point!.y}`,
  );
  assert(
    reading.visibleAttribute === 'true',
    `a target in front of the camera must be on screen | data-visible ${reading.visibleAttribute}`,
  );

  // ---- 6. Behind the camera it parks; `null` clears it ----
  await evalValue<boolean>(`(() => {${HELPERS}
    const cam = D.camera();
    // Mirrored through the eye: straight behind the camera, so the projection
    // has nowhere to put it.
    window.jeexViewer.slots.anchorTo({ x: cam.x * 2 - ${literal(target.x)}, y: 1, z: cam.z * 2 - ${literal(target.z)} });
    return true;
  })()`);
  await settle(ctx, ANCHOR_SETTLE_MS, 'the frame hook parking the anchor');
  const afterPark = await evalValue<{ visible: boolean; attribute: string }>(`(() => {
    const box = document.querySelector('[data-jeex-slot="selection-anchor"]');
    return JSON.stringify({ visible: window.jeexViewer.slots.anchorPoint().visible, attribute: box.dataset.visible });
  })()`);
  assert(!afterPark.visible, 'a point behind the camera must report visible: false');
  assert(afterPark.attribute === 'false', `a parked anchor must hide its box | data-visible ${afterPark.attribute}`);
  const cleared = await evalValue<unknown>(
    '(() => { window.jeexViewer.slots.anchorTo(null); return JSON.stringify(window.jeexViewer.slots.anchorPoint()); })()',
  );
  assert(cleared === null, `anchorTo(null) must clear anchorPoint() | ${JSON.stringify(cleared)}`);

  // ---- 7. The keyboard guard, with REAL keystrokes ----
  await run(['open', withViewerOptions(url, { tour: 'off', view: 'walk', slots: 'bottom-center' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  await waitForCameraStill(ctx, 'the walker before typing into a slot');
  await evalValue<boolean>(`(() => {
    const box = window.jeexViewer.slots.get('bottom-center');
    box.replaceChildren();
    const field = document.createElement('input');
    field.type = 'text';
    field.id = 'jeex-check-slot-field';
    box.append(field);
    return true;
  })()`);
  await run(['focus', '#jeex-check-slot-field']);
  const before = await ctx.cameraAt();
  await run(['keyboard', 'type', 'wwww']);
  await settle(ctx, ANCHOR_SETTLE_MS, 'the frames a walk would have moved in');
  const typed = await evalValue<string>("document.querySelector('#jeex-check-slot-field').value");
  const after = await ctx.cameraAt();
  assert(typed === 'wwww', `a field inside a slot must keep what was typed into it | got ${JSON.stringify(typed)}`);
  assert(
    ctx.distance(before, after) < 0.02,
    `keys typed into host chrome must not move the camera | moved ${ctx.distance(before, after).toFixed(3)} m`,
  );

  // ---- 8. `edits: 'emit'` — the panel opens, the batch goes out, rev stands ----
  await run(['open', withViewerOptions(url, { tour: 'off', edits: 'emit' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  // The subscription is armed ONCE (memoized on `window`): a retried eval here
  // must not add a second listener, or every edit would be counted twice.
  await evalValue<boolean>(
    "(() => { if (window.__jeexEditsArmed) return true; window.__jeexEdits = []; window.jeexViewer.on('edit', (e) => window.__jeexEdits.push(e)); window.__jeexEditsArmed = true; return true; })()",
  );
  // The accumulator is reset INSIDE the eval that mutates and reads it, like
  // every mutating step above: `agent-browser` retries a failed eval, and a
  // retry must count only its own attempt's edit, not the abandoned one's.
  const emitted = await evalValue<{ opened: boolean; edits: number; baseRev: number; revBefore: number; revAfter: number }>(
    `(() => {${HELPERS}
    window.__jeexEdits.length = 0;
    const revBefore = window.jeexViewer.getState().rev;
    const room = D.plan().rooms[0];
    const b = room.bbox;
    let opened = false;
    for (let u = 0.3; u <= 0.75 && !opened; u += 0.15) {
      for (let v = 0.3; v <= 0.75 && !opened; v += 0.15) {
        const p = D.projectFloorPoint(b.minX + (b.maxX - b.minX) * u, b.minZ + (b.maxZ - b.minZ) * v);
        if (!ONSCREEN(p)) continue;
        CLOSED();
        CLICK(p.x, p.y);
        opened = PANEL().open === 'true';
      }
    }
    const swatch = document.querySelector('.finish-swatch[data-finish]');
    if (swatch) swatch.click();
    const edits = window.__jeexEdits;
    return JSON.stringify({
      opened,
      edits: edits.length,
      baseRev: edits[0] ? edits[0].baseRev : -1,
      revBefore,
      revAfter: window.jeexViewer.getState().rev,
    });
  })()`,
  );
  assert(emitted.opened, "edits: 'emit' must still open the viewer's own panel");
  assert(emitted.edits === 1, `a swatch under edits: 'emit' must raise exactly one edit | got ${emitted.edits}`);
  assert(
    emitted.baseRev === emitted.revBefore,
    `the edit must carry the revision it was computed against | ${emitted.baseRev} vs ${emitted.revBefore}`,
  );
  assert(emitted.revAfter === emitted.revBefore, `edits: 'emit' must commit nothing | rev ${emitted.revBefore} -> ${emitted.revAfter}`);

  // ---- 8b. `edits: 'off'` — the interiors button is hidden and reaches nothing ----
  // The visible half of `edits: 'off'`: the control bar must not offer the panel,
  // and a click on it (the button path bypasses the pick gate) must open
  // nothing. Absolute reads on both counts: a retried eval clicks again and
  // still sees a closed panel, so the step stays idempotent.
  await run(['open', withViewerOptions(url, { tour: 'off', edits: 'off' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const off = await evalValue<{ hidden: boolean; opened: boolean }>(`(() => {
    const button = document.querySelector('[data-jeex="interiors-button"]');
    const hidden = Boolean(button && button.classList.contains('is-hidden'));
    if (button) button.click();
    const panel = document.querySelector('[data-jeex="finish-panel"]');
    return JSON.stringify({ hidden, opened: Boolean(panel && panel.getAttribute('data-open') === 'true') });
  })()`);
  assert(off.hidden, "edits: 'off' must hide the interiors button | the button is visible");
  assert(!off.opened, "edits: 'off' must open no panel, not even through the button | a panel opened");

  // ---- 9. The degraded notice steps aside for a requested bottom-right slot ----
  // Found from an editor host's 56px assistant button covering the notice's
  // text (host content must never cover a viewer notice or error card).
  // The notice is shown BY HAND, the same page mutation as the error card in
  // step 3: a real "degraded" state needs a scene with missing assets, and the
  // demo page cannot be made to load one from a URL.
  await run(['open', withViewerOptions(url, { tour: 'off', slots: 'bottom-right' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const stepsAside = await evalValue<{
    intersects: boolean;
    bothOnscreen: boolean;
    hitsHint: boolean;
    hintShown: boolean;
  }>(`(() => {
    const box = window.jeexViewer.slots.get('bottom-right');
    box.replaceChildren();
    const button = document.createElement('div');
    button.style.setProperty('inline-size', '56px');
    button.style.setProperty('block-size', '56px');
    box.append(button);
    const notice = document.querySelector('.degraded-notice');
    notice.classList.remove('is-hidden');
    const n = notice.getBoundingClientRect();
    const s = box.getBoundingClientRect();
    const intersects = n.left < s.right && n.right > s.left && n.top < s.bottom && n.bottom > s.top;
    const onscreen = (r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    const bothOnscreen = onscreen(n) && onscreen(s);
    // The corner it steps into already holds the hint card, which is shown from
    // boot: stepping out of the host's way onto the viewer's own chrome would
    // be the same overlap one element further.
    const hint = document.querySelector('.hint-card');
    const hintShown = Boolean(hint && !hint.hasAttribute('hidden'));
    const h = hint ? hint.getBoundingClientRect() : null;
    const hitsHint = Boolean(h && n.left < h.right && n.right > h.left && n.top < h.bottom && n.bottom > h.top);
    notice.classList.add('is-hidden');
    return JSON.stringify({ intersects, bothOnscreen, hitsHint, hintShown });
  })()`);
  assert(!stepsAside.intersects, 'the degraded notice must not overlap a requested bottom-right slot box');
  assert(stepsAside.bothOnscreen, 'the notice and the slot box must both stay inside the viewport once the notice steps aside');
  assert(stepsAside.hintShown, 'the hint card must be on screen for this check to mean anything | it was hidden');
  assert(!stepsAside.hitsHint, 'the notice that stepped out of the host box must not land on the hint card');

  // ---- 10. `dispose()` takes the boxes with the shell ----
  const disposed = await evalValue<number>(
    "(() => { window.jeexViewer.dispose(); return document.querySelectorAll('[data-jeex-slot]').length; })()",
  );
  assert(disposed === 0, `dispose() must leave no slot node behind | ${disposed} left`);

  summary.push(
    `slots: none by default, ${built.length} named boxes, MissingSlotError for an unnamed one, ` +
      `content hit-tested and the error card above it, a drag through an empty slot moved the camera ` +
      `${dragged.moved.toFixed(2)} m, the anchor within ${Math.max(dx, dy).toFixed(2)} px of projectPoint, ` +
      `parked behind the camera, "wwww" typed into a field in a slot with the camera still, edits=emit raised ` +
      `one batch at rev ${emitted.baseRev} and committed nothing, edits=off hid the interiors button and ` +
      `opened no panel even when it was clicked, the degraded notice stepped aside from a requested bottom-right ` +
      `slot with both on screen and clear of the hint card`,
  );

  // Back to a plain load: the next area starts from a mounted, undisposed page.
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
}

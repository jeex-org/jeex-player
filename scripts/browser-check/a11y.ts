/**
 * The three things a screenshot review can catch that a DOM
 * assertion alone reads as "present" without proving is legible — a focus
 * ring that is actually drawn, a dialog whose focus really lands and comes
 * back, and a reduced-motion boot that really opens paused.
 *
 * Reduced motion is driven through the `motion=reduced` QUERY option, not a
 * CDP media emulation: `agent-browser`'s documented surface (`--help`) has no
 * `emulate`/`setEmulatedMedia` command, and `motion: 'reduced'` is the
 * host override for exactly this case — it forces the downgrade the same way
 * a real `prefers-reduced-motion: reduce` visitor would get under
 * `motion: 'auto'`, with no extra machinery to keep in sync with the CLI.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import { byName, nameSelector } from './page-code.js';
import type { Pick } from './probes.js';
import { pickFloorScript } from './page-code.js';
import { withViewerOptions } from './session.js';
import { waitForCameraStill } from './step.js';

/** Focus ring visibility, the dialog's focus in/out, and a reduced-motion boot. Leaves the page reloaded, plain. */
export async function checkA11y(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, url, shotDir } = ctx;

  // ---- Tab -> a visible :focus-visible ring -------------------------------
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  await run(['press', 'Tab']);
  const ring = await evalValue<{ tag: string; matchesFocusVisible: boolean; outlineStyle: string; outlineWidth: string }>(`(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return JSON.stringify({
      tag: el.tagName + (el.getAttribute('data-jeex') ? '[' + el.getAttribute('data-jeex') + ']' : ''),
      matchesFocusVisible: el.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    });
  })()`);
  assert(ring.matchesFocusVisible, `Tab should land on an element matching :focus-visible, got ${ring.tag}`);
  assert(
    ring.outlineStyle !== 'none' && ring.outlineWidth !== '0px',
    `the focused element should draw a real ring, got ${JSON.stringify(ring)}`,
  );
  await run(['screenshot', `${shotDir}/a11y-focus-ring.png`]);
  summary.push(`focus ring: Tab landed on ${ring.tag}, outline ${ring.outlineWidth} ${ring.outlineStyle}`);

  // ---- The finish panel as a dialog: focus in, trapped, and back out ------
  const pick = await evalValue<Pick>(pickFloorScript(DEMO.room.bathroom));
  assert(pick.hit, `finish panel should open for the bathroom floor (${pick.reason ?? ''})`);
  const opened = await evalValue<{ activeIsClose: boolean; ariaModal: string | null; dataOpen: string | null }>(`(() => {
    const panel = ${byName('finish-panel')};
    const close = ${byName('finish-close')};
    return JSON.stringify({
      activeIsClose: document.activeElement === close,
      ariaModal: panel?.getAttribute('aria-modal'),
      dataOpen: panel?.dataset.open ?? null,
    });
  })()`);
  assert(opened.activeIsClose, 'opening the panel should move focus to its first control (the close button)');
  assert(opened.ariaModal === 'true', 'the panel should carry aria-modal="true"');
  assert(opened.dataOpen === 'true', 'the panel should report data-open="true" while shown');
  await run(['screenshot', `${shotDir}/a11y-dialog-focus.png`]);
  await run(['press', 'Escape']);
  const closed = await evalValue<{ activeIsTrigger: boolean; dataOpen: string | null }>(`(() => {
    const panel = ${byName('finish-panel')};
    return JSON.stringify({
      // The trigger for a floor pick is the CANVAS-holding root itself (a
      // click on the 3D scene, not a button): focus goes back to whatever
      // had it before the panel opened, per selection-panel.ts.
      activeIsTrigger: document.activeElement === ${byName('viewer')},
      dataOpen: panel?.dataset.open ?? null,
    });
  })()`);
  assert(closed.dataOpen === 'false', 'Escape should close the panel (data-open="false")');
  assert(closed.activeIsTrigger, 'Escape should return focus to whatever triggered the panel');
  summary.push('dialog focus: opens on the close button, aria-modal, Escape closes and restores focus');

  // ---- Reduced motion: an engaged tour opens paused, travel is instant
  // Compose, never append a bare `?`: `VIEWER_URL` may already carry a query and
  // a second `?` silently orphans `view` — see `withViewerOptions` in session.ts.
  // `view=tour` must survive, so this is the merging helper, not `withQuery`.
  await run(['open', withViewerOptions(url, { view: 'tour', motion: 'reduced' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const tourState = await evalValue<string>(`document.querySelector('${nameSelector('tour-status')}')?.dataset.state ?? 'none'`);
  assert(tourState === 'paused', `motion=reduced should open an engaged tour paused, got ${tourState}`);
  const before = await evalValue<{ x: number; y: number; z: number }>('JSON.stringify(window.__viewerDebug?.camera())');
  const focused = await evalValue<boolean>(`window.jeexViewer?.focusRoom(${literal(DEMO.room.living)}) ?? false`);
  assert(focused, 'focusRoom should still succeed under reduced motion');
  // "Within one frame": the camera is already at rest by the time the FIRST
  // poll after the call finds it, never fighting an in-flight tween.
  await waitForCameraStill(ctx, 'the instant focusRoom to have already landed', 1000);
  const after = await evalValue<{ x: number; y: number; z: number }>('JSON.stringify(window.__viewerDebug?.camera())');
  assert(
    Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 0.01,
    'focusRoom under reduced motion should still have MOVED the camera, just without the animated flight',
  );
  await run(['screenshot', `${shotDir}/a11y-reduced-motion.png`]);
  summary.push(`reduced motion: engaged tour opened paused, focusRoom(living) landed within one frame`);

  // ---- Host slots: the viewer owns the box, the host owns its role ---------
  //
  // Three claims, all of them about what the viewer must NOT do to a box: an
  // empty box may not sit in the tab order, it may not carry a role or a label
  // the host did not ask for, and whatever the host puts in it must inherit the
  // shell's language rather than the page's.
  await run(['open', withViewerOptions(url, { tour: 'off', slots: 'bottom-center,modal-root' })]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const slotAttributes = await evalValue<{ named: string[]; offenders: string[] }>(`(() => {
    const boxes = [...document.querySelectorAll('[data-jeex-slot]')];
    const offenders = [];
    for (const box of boxes) {
      for (const attribute of box.getAttributeNames()) {
        if (attribute === 'role' || attribute === 'tabindex' || attribute.startsWith('aria-')) {
          offenders.push(box.dataset.jeexSlot + ':' + attribute);
        }
      }
    }
    return JSON.stringify({ named: boxes.map((b) => b.dataset.jeexSlot), offenders });
  })()`);
  assert(slotAttributes.named.length === 2, `the a11y page should carry two boxes | ${JSON.stringify(slotAttributes.named)}`);
  assert(
    slotAttributes.offenders.length === 0,
    `a slot box must carry no role, tabindex or aria-* of the viewer's own | ${slotAttributes.offenders.join(', ')}`,
  );

  // An EMPTY box must not swallow a tab stop: the first Tab from the canvas
  // lands where it lands without the slots, which is the viewer's own chrome.
  await run(['press', 'Tab']);
  const firstStop = await evalValue<string>(
    "(() => { const el = document.activeElement; return (el.getAttribute('data-jeex-slot') ?? el.closest('[data-jeex-slot]')?.getAttribute('data-jeex-slot')) ?? 'not-a-slot'; })()",
  );
  assert(firstStop === 'not-a-slot', `an empty slot box must not be a tab stop | Tab landed in ${firstStop}`);

  // The content inherits the SHELL's language, not the host page's: a host
  // renders inside the viewer's root, and `lang` is set there.
  const slotLang = await evalValue<{ owner: string; lang: string }>(`(() => {
    const box = window.jeexViewer.slots.get('bottom-center');
    box.replaceChildren();
    const button = document.createElement('button');
    button.textContent = 'host';
    box.append(button);
    const owner = button.closest('[lang]');
    return JSON.stringify({ owner: owner ? owner.className || owner.tagName : 'none', lang: owner ? owner.lang : '' });
  })()`);
  assert(
    slotAttributes.named.includes('bottom-center') && slotLang.owner.includes('jeex-viewer'),
    `a host's content in a slot must inherit the shell's lang | nearest [lang] is ${slotLang.owner}`,
  );
  summary.push(
    `host slots: no role/tabindex/aria on the boxes, an empty box is no tab stop, slot content inherits lang="${slotLang.lang}"`,
  );

  // Leaves the page plain, for whatever runs next.
  await run(['open', url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
}

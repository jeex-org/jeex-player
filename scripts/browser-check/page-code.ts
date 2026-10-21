/**
 * Page code: the JavaScript the check pastes into the browser, and the
 * selectors it addresses the shell with.
 *
 * Invariant: the viewer's shell is addressed by NAME (`data-jeex="…"`), never
 * by id — two mounted viewers on one page would make an id ambiguous, and
 * `viewer-shell.ts` therefore stamps names instead. `nameSelector` and `byName`
 * are the only two places that spell the attribute out.
 *
 * These are strings, not functions: everything here runs in the page, not in
 * Bun. Nothing in this module may reach for a session.
 */

import { DEMO } from '../../src/demo/demo-ids.js';

/** CSS selector of one shell node, for the CLI and for page `querySelector`. */
export function nameSelector(name: string): string {
  return `[data-jeex="${name}"]`;
}

/** Page expression selecting one shell node of the first mounted viewer. */
export function byName(name: string): string {
  return `document.querySelector('${nameSelector(name)}')`;
}

/** Page expression selecting one shell node inside a given root expression. */
export function byNameIn(rootExpression: string, name: string): string {
  return `${rootExpression}.querySelector('${nameSelector(name)}')`;
}

/**
 * Preamble injected into picking evals: a canvas click, a viewport test and
 * `PANEL`, the machine-readable identity of the open panel. Assertions read
 * `data-*` rather than the title copy, so translating the UI cannot break the
 * check (`src/ui/messages.ts`).
 */
export const HELPERS = `
  const D = window.__viewerDebug;
  /**
   * The shell root of the first mounted viewer, and the keyboard target of
   * that viewer: keys are listened for on the ROOT, never on \`window\`, so
   * two viewers on one page do not walk together (\`camera-input.ts\`).
   */
  const ROOT = document.querySelector('.jeex-viewer');
  const HOLD = (key) => ROOT.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const RELEASE = (key) => ROOT.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  const PANEL = () => document.querySelector('[data-jeex="finish-panel"]').dataset;
  const CLOSED = () => { const p = document.querySelector('[data-jeex="finish-panel"]'); p.classList.add('is-hidden'); delete p.dataset.kind; };
  let pointerId = 400;
  const CLICK = (x, y) => {
    const canvas = document.querySelector('[data-jeex="scene-canvas"]');
    const opts = { clientX: x, clientY: y, bubbles: true, pointerId: (pointerId += 1) };
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    canvas.dispatchEvent(new MouseEvent('click', opts));
    canvas.dispatchEvent(new PointerEvent('pointerup', opts));
  };
  const ONSCREEN = (p) => Boolean(p) && p.x > 4 && p.y > 4 && p.x < innerWidth - 4 && p.y < innerHeight - 4;
`;

/**
 * Extra page helpers for the door-automation scenario: turning the walker on
 * the spot, and reading which way they face.
 *
 * The walk look is a pointer drag of `0.006 rad/px` (`camera-controller.ts`
 * `onPointerMove`), so facing a plan point is arithmetic once the current yaw
 * is known — and that comes from a raycast, `floorPoint` under the middle of
 * the lower screen, never from a guess. A level gaze can miss the floor
 * entirely, so the gaze is tipped down until the ray lands.
 */
export const WALK_HELPERS = `
  ${HELPERS}
  const CANVAS = document.querySelector('[data-jeex="scene-canvas"]');
  const DRAG_EVENTS = (fromX, fromY, toX, toY) => {
    const id = (pointerId += 1);
    CANVAS.dispatchEvent(new PointerEvent('pointerdown', { clientX: fromX, clientY: fromY, bubbles: true, pointerId: id }));
    for (let i = 1; i <= 4; i += 1) {
      CANVAS.dispatchEvent(new PointerEvent('pointermove', {
        clientX: Math.round(fromX + ((toX - fromX) * i) / 4),
        clientY: Math.round(fromY + ((toY - fromY) * i) / 4),
        bubbles: true,
        pointerId: id,
      }));
    }
    CANVAS.dispatchEvent(new PointerEvent('pointerup', { clientX: toX, clientY: toY, bubbles: true, pointerId: id }));
  };
  const YAW = () => {
    const cam = D.camera();
    for (const share of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65]) {
      const p = D.floorPoint(innerWidth / 2, innerHeight * share);
      if (p && Math.hypot(p.x - cam.x, p.z - cam.z) > 0.3) return Math.atan2(p.x - cam.x, p.z - cam.z);
    }
    return null;
  };
  /** Turns the walker to face a plan point; false when the floor is unreadable. */
  const FACE = (x, z) => {
    let yaw = YAW();
    for (let tries = 0; yaw === null && tries < 3; tries += 1) {
      const y = Math.round(innerHeight * 0.4);
      DRAG_EVENTS(Math.round(innerWidth / 2), y, Math.round(innerWidth / 2), y + 50);
      yaw = YAW();
    }
    if (yaw === null) return false;
    const cam = D.camera();
    let turn = Math.atan2(x - cam.x, z - cam.z) - yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    let left = turn / 0.006;
    const y = Math.round(innerHeight * 0.5);
    while (Math.abs(left) > 0.5) {
      const step = Math.max(-500, Math.min(500, left));
      left -= step;
      const from = Math.round(innerWidth / 2 - step / 2);
      DRAG_EVENTS(from, y, Math.round(from + step), y);
    }
    return true;
  };
`;

/**
 * Walks the room polygon returned by the solver, offsets each edge midpoint 3 cm
 * into the room and clicks it until the finish panel opens for that room's wall.
 * The polygon comes straight from the plan, so no wall coordinate is hard-coded.
 */
export function pickWallFaceScript(roomId: string): string {
  return `(() => {${HELPERS}
    const room = D.plan().rooms.find((r) => r.id === '${roomId}');
    if (!room) return JSON.stringify({ hit: false, reason: 'room ${roomId} missing from the plan' });
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.4) continue;
      const nx = -dz / len;
      const nz = dx / len;
      for (const s of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const y of [1.25, 1.9, 0.95]) {
          const p = D.projectPoint(a.x + dx * s + nx * 0.03, y, a.z + dz * s + nz * 0.03);
          if (!ONSCREEN(p)) continue;
          CLOSED();
          CLICK(p.x, p.y);
          if (PANEL().surface === 'wall' && PANEL().owner === '${roomId}') return JSON.stringify({ hit: true, x: p.x, y: p.y });
        }
      }
    }
    return JSON.stringify({ hit: false, reason: 'no visible wall face of ${roomId}' });
  })()`;
}

/** Same idea for a floor: sample the room bbox until the floor panel opens. */
export function pickFloorScript(roomId: string): string {
  return `(() => {${HELPERS}
    const room = D.plan().rooms.find((r) => r.id === '${roomId}');
    if (!room) return JSON.stringify({ hit: false, reason: 'room ${roomId} missing from the plan' });
    const box = room.bbox;
    for (let u = 0.2; u <= 0.85; u += 0.15) {
      for (let v = 0.2; v <= 0.85; v += 0.15) {
        const wx = box.minX + (box.maxX - box.minX) * u;
        const wz = box.minZ + (box.maxZ - box.minZ) * v;
        const p = D.projectFloorPoint(wx, wz);
        if (!ONSCREEN(p)) continue;
        CLOSED();
        CLICK(p.x, p.y);
        if (PANEL().surface === 'floor' && PANEL().owner === '${roomId}') return JSON.stringify({ hit: true, x: p.x, y: p.y });
      }
    }
    return JSON.stringify({ hit: false, reason: 'no visible floor of ${roomId}' });
  })()`;
}

/**
 * The bay window is the one exterior face that is unambiguously visible in the
 * default dollhouse camera. Candidates are derived from the facade face itself
 * (centre, outward normal, length); the documented viewport pixel of the bay at
 * 1280x800 is the last resort, scaled to the current viewport.
 */
export const PICK_FACADE = `(() => {${HELPERS}
  const bay = D.plan().facadeWalls.find((w) => w.wallId === ${JSON.stringify(DEMO.wall.bayLiving)});
  const candidates = [];
  if (bay) {
    const tangent = { x: -bay.outward.z, z: bay.outward.x };
    for (const s of [0.25, -0.25, 0.35, -0.35, 0]) {
      for (const y of [2.45, 2.6, 1.1]) {
        candidates.push(D.projectPoint(
          bay.centre.x + tangent.x * s * bay.length + bay.outward.x * 0.03,
          y,
          bay.centre.z + tangent.z * s * bay.length + bay.outward.z * 0.03,
        ));
      }
    }
  }
  for (let dx = -40; dx <= 40; dx += 20) {
    for (let dy = -20; dy <= 20; dy += 10) {
      candidates.push({ x: innerWidth * (830 + dx) / 1280, y: innerHeight * (190 + dy) / 800 });
    }
  }
  for (const p of candidates) {
    if (!ONSCREEN(p)) continue;
    CLOSED();
    CLICK(p.x, p.y);
    if (PANEL().surface === 'wall' && PANEL().owner === 'facade') return JSON.stringify({ hit: true, x: p.x, y: p.y });
  }
  return JSON.stringify({ hit: false, reason: 'no visible facade face' });
})()`;

/** Clicks the first variant swatch that is not the active one; returns its id. */
export const swapVariant = `(() => {
  const swatches = [...document.querySelectorAll('.finish-swatch')].filter((s) => s.dataset.variant);
  const next = swatches.find((s) => !s.classList.contains('is-active'));
  if (!next) return 'none';
  next.click();
  return next.dataset.variant;
})()`;

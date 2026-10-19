/**
 * `ViewerHandle.describeSelection`: the data a host needs to draw the same
 * selection card the viewer's own panel draws.
 *
 * Runs against `?select=1&edits=off` on purpose: `edits: 'off'` is what an
 * editor host mounts, no panel opens there at all, and the description has to be
 * exactly as complete as it is with the panel on. Every claim is made about the
 * DEMO FLAT through ids read at runtime (`exportScene`, `openings`, `plan`),
 * never hard-coded.
 *
 * Leaves the page on the plain URL for whatever runs next.
 */

import type { CheckContext } from './context.js';
import { HELPERS } from './page-code.js';

type Option = { id: string; label: string; preview: string; op: Record<string, unknown> };
type Description = {
  kind: string;
  title: string;
  subject: { id: string; label: string };
  current: string | null;
  options: Option[];
  scope?: { label: string; ops: { one: Record<string, unknown>; all: Record<string, unknown> } };
};

type Probe = {
  assetId: string;
  roomId: string;
  openingId: string;
  nodeId: string;
  furniture: Description | null;
  floor: Description | null;
  opening: Description | null;
  /** Two openings of different families, to prove the bank is looked up per family. */
  otherFamily: { id: string; ids: string[] } | null;
  node: Description | null;
  nodeAsFurniture: Description | null;
  none: Description | null;
  unknown: Description | null;
  /** Milliseconds the furniture description took, previews included. */
  furnitureMs: number;
  panelOpened: boolean;
};

/** Every description a host can be handed, read in one page round trip. */
export async function checkDescribeSelection(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, withQuery } = ctx;

  await run(['open', withQuery('?select=1&edits=off&tour=off')]);
  await run(['wait', '--fn', 'window.__appReady === true']);

  const probe = await evalValue<Probe>(`(() => {${HELPERS}
    const scene = D.exportScene();
    const assetId = D.assetModels()[0].id;
    const roomId = D.plan().rooms[0].id;
    const openings = D.openings();
    const first = openings[0];
    // By FAMILY, not by type: \`variantsForOpening\` banks windows apart and
    // gives doors AND passages the door sets, so \`type !== type\` would pair a
    // door with a passage the day the demo grows one — and the disjointness
    // assertion below would then fail against correct producer behaviour.
    const isWindow = (o) => o.type === 'window';
    const other = openings.find((o) => isWindow(o) !== isWindow(first)) ?? null;
    const nodeId = scene.nodes[0].id;
    const started = performance.now();
    const furniture = D.describeSelection({ kind: 'furniture', id: assetId, mode: 'orbit' });
    const furnitureMs = performance.now() - started;
    const opening = D.describeSelection({ kind: 'opening', id: first.id, mode: 'orbit' });
    const otherDescription = other ? D.describeSelection({ kind: 'opening', id: other.id, mode: 'orbit' }) : null;
    // A plan node is never selectable; an id that names one has to answer null
    // whichever kind it is claimed to be.
    return JSON.stringify({
      assetId,
      roomId,
      openingId: first.id,
      nodeId,
      furniture,
      furnitureMs,
      floor: D.describeSelection({ kind: 'room', id: roomId, roomId, mode: 'orbit' }),
      opening,
      otherFamily: otherDescription ? { id: other.id, ids: otherDescription.options.map((o) => o.id) } : null,
      node: D.describeSelection({ kind: 'room', id: nodeId, roomId: nodeId, mode: 'plan2d' }),
      nodeAsFurniture: D.describeSelection({ kind: 'furniture', id: nodeId, mode: 'plan2d' }),
      none: D.describeSelection({ kind: 'none', mode: 'orbit' }),
      unknown: D.describeSelection({ kind: 'furniture', id: 'no-such-placement', mode: 'orbit' }),
      panelOpened: !document.querySelector('[data-jeex="finish-panel"]').classList.contains('is-hidden'),
    });
  })()`);

  // ---- 1. Furniture: at least two options, each with a picture and its own op ----
  const furniture = probe.furniture;
  assert(furniture?.kind === 'furniture', `a furniture pick must describe a furniture selection | ${JSON.stringify(furniture)}`);
  assert(
    (furniture?.options.length ?? 0) >= 2,
    `a furniture pick must offer at least two variants | ${JSON.stringify(furniture?.options.map((option) => option.id))}`,
  );
  assert(
    furniture?.subject.id === probe.assetId,
    `the subject must be the placement that was picked | ${JSON.stringify(furniture?.subject)}`,
  );
  for (const option of furniture?.options ?? []) {
    assert(
      /^(data:|blob:)/.test(option.preview),
      `every furniture option needs a ready image URL | ${option.id} -> ${option.preview.slice(0, 32)}`,
    );
    assert(option.preview.length > 64, `a preview must be an actual picture, not a stub | ${option.id} -> ${option.preview.length} chars`);
    assert(option.label.length > 0, `every option needs a separate label | ${option.id}`);
    assert(
      option.op['op'] === 'replace_asset_variant' && option.op['assetId'] === probe.assetId && option.op['variant'] === option.id,
      `a furniture option's op must replace THAT asset's variant | ${JSON.stringify(option.op)}`,
    );
  }
  summary.push(
    `describeSelection furniture: ${probe.assetId} -> ${furniture?.options.length} options, previews ${furniture?.options[0]?.preview.slice(0, 11)}…, ${probe.furnitureMs.toFixed(0)} ms`,
  );

  // ---- 2. Floor: the finish bank with the one in force ----
  const floor = probe.floor;
  assert(floor?.kind === 'finish', `a floor pick must describe a finish selection | ${JSON.stringify(floor)}`);
  assert(typeof floor?.current === 'string' && floor.current.length > 0, `a floor pick must name the finish in force | ${floor?.current}`);
  assert(
    (floor?.options.length ?? 0) >= 4 && (floor?.options.some((option) => option.id === floor.current) ?? false),
    `the floor bank must contain the finish in force | ${JSON.stringify(floor?.options.map((option) => option.id))}`,
  );
  for (const option of floor?.options ?? []) {
    assert(/^(data:|blob:)/.test(option.preview), `every floor finish needs a ready image URL | ${option.id}`);
    assert(
      option.op['op'] === 'set_material' && option.op['target'] === probe.roomId && option.op['material'] === option.id,
      `a floor option's op must paint THAT room | ${JSON.stringify(option.op)}`,
    );
  }
  assert(
    floor?.scope?.ops.all['target'] === 'floors' && floor.scope.ops.one['target'] === probe.roomId,
    `the floor scope must pair this room against every floor | ${JSON.stringify(floor?.scope)}`,
  );
  summary.push(`describeSelection floor: ${probe.roomId} -> ${floor?.options.length} finishes, current ${floor?.current}`);

  // ---- 3. Opening: its own family, and a different family for a different type ----
  const opening = probe.opening;
  assert(opening?.kind === 'opening', `an opening pick must describe an opening selection | ${JSON.stringify(opening)}`);
  assert(
    (opening?.options.length ?? 0) >= 2,
    `an opening pick must offer its family | ${JSON.stringify(opening?.options.map((o) => o.id))}`,
  );
  assert(
    typeof opening?.current === 'string' && opening.options.some((option) => option.id === opening.current),
    `the opening family must contain the variant in force | ${opening?.current}`,
  );
  for (const option of opening?.options ?? []) {
    assert(/^(data:|blob:)/.test(option.preview), `every opening variant needs a ready image URL | ${option.id}`);
    assert(
      option.op['op'] === 'replace_opening_variant' && option.op['openingId'] === probe.openingId && option.op['variant'] === option.id,
      `an opening option's op must replace THAT opening's variant | ${JSON.stringify(option.op)}`,
    );
  }
  // `variantsForOpening` is looked up per family: a window and a door can never
  // be offered the same bank, which is what a single shared list would do.
  if (probe.otherFamily) {
    const shared = (opening?.options ?? []).filter((option) => probe.otherFamily?.ids.includes(option.id));
    assert(shared.length === 0, `two opening families must not share a variant | ${JSON.stringify(shared.map((o) => o.id))}`);
    summary.push(
      `describeSelection opening: ${probe.openingId} -> ${opening?.options.length}, ${probe.otherFamily.id} -> ${probe.otherFamily.ids.length}, disjoint`,
    );
  } else {
    summary.push(`describeSelection opening: ${probe.openingId} -> ${opening?.options.length} variants, current ${opening?.current}`);
  }

  // ---- 4. Nothing to offer answers null, and `edits=off` still opened nothing ----
  assert(probe.node === null, `a plan node has nothing to describe | ${JSON.stringify(probe.node)}`);
  assert(
    probe.nodeAsFurniture === null,
    `a plan node has nothing to describe whatever kind claims it | ${JSON.stringify(probe.nodeAsFurniture)}`,
  );
  assert(probe.none === null, `a click that landed on nothing has nothing to describe | ${JSON.stringify(probe.none)}`);
  assert(probe.unknown === null, `an id the document does not carry has nothing to describe | ${JSON.stringify(probe.unknown)}`);
  assert(!probe.panelOpened, 'describeSelection must open no panel, least of all with edits=off');
  summary.push(
    `describeSelection null: node ${probe.nodeId} as room and as furniture, kind none, unknown id — and no panel with edits=off`,
  );

  // Leaves the plain page for whatever runs next.
  await run(['open', ctx.url]);
  await run(['wait', '--fn', 'window.__appReady === true']);
}

/**
 * Interior presets: one click dresses the whole flat, and the selector is a
 * prop that can be taken away.
 */

import { DEMO } from '../../src/demo/demo-ids.js';
import type { CheckContext } from './context.js';
import { pressControl, settle } from './step.js';

/**
 * The variant ripple plus the texture swap a preset triggers, milliseconds.
 *
 * `furniture-animator.ts` re-seeds the group over 190 ms with a 450 ms stagger,
 * and the finish textures are generated on the next frames after that. There is
 * no flag for "the ripple has finished and every texture has landed", and the
 * only consumer here is a review SCREENSHOT — so this is a genuine residue: a
 * named duration covering a named physical effect.
 */
const PRESET_RIPPLE_MS = 900;

/** Readable names of the demo presets, by id: their keys in `DEMO.preset`, for screenshot file names. */
const PRESET_NAME = new Map<string, string>(Object.entries(DEMO.preset).map(([name, id]) => [id, name]));
const presetName = (id: string): string => PRESET_NAME.get(id) ?? id;

/** Interior presets and the `?presets=0` prop. */
export async function checkPresets(ctx: CheckContext): Promise<void> {
  const { run, evalValue, assert, summary, literal, withQuery, shotDir } = ctx;
  // ---- Interior presets: one click dresses the whole flat ----
  // `tour=off` parks the camera on the presentation view, so the screenshots
  // below are four comparable dollhouse shots of the same apartment.
  await run(['open', withQuery('tour=off')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const presetList = await evalValue<Array<{ id: string; name: string; active: boolean }>>(
    'JSON.stringify(window.__viewerDebug.presets())',
  );
  assert(presetList.length === 4, `the demo scene should offer four interiors, got ${presetList.length}`);
  assert(
    presetList.every((preset) => !preset.active),
    'no preset is applied before the first click',
  );
  const buttonShown = await evalValue<boolean>(
    "!document.querySelector('[data-jeex=\"interiors-button\"]').classList.contains('is-hidden')",
  );
  assert(buttonShown, 'the control bar should offer #interiors-button when the scene ships interiors');

  await run(['click', '[data-jeex="reveal-controls"]']);
  await pressControl(ctx, '[data-jeex="interiors-button"]');
  const interiorPanel = await evalValue<{
    kind?: string;
    presets?: string;
    hidden: boolean;
    items: number;
    ids: string[];
    previewTags: string[];
    previewText: string[];
    labels: string[];
  }>(`(() => {
    const panel = document.querySelector('[data-jeex="finish-panel"]');
    const swatches = [...panel.querySelectorAll('.finish-swatch')];
    return JSON.stringify({
      kind: panel.dataset.kind,
      presets: panel.dataset.presets,
      hidden: panel.classList.contains('is-hidden'),
      items: swatches.length,
      ids: swatches.map((s) => s.dataset.preset),
      previewTags: swatches.map((s) => s.firstElementChild.tagName),
      previewText: swatches.map((s) => (s.firstElementChild.textContent || '').trim()),
      labels: swatches.map((s) => (s.lastElementChild.textContent || '').trim()),
    });
  })()`);
  assert(
    interiorPanel.kind === 'interior' && !interiorPanel.hidden,
    `#interiors-button should open the interior panel, got ${JSON.stringify(interiorPanel)}`,
  );
  assert(
    interiorPanel.items === 4 && interiorPanel.presets === '4',
    `the interior panel should show four presets, got ${JSON.stringify(interiorPanel.ids)}`,
  );
  // Rule 14: the preview is an image and nothing else; the name is its own node.
  assert(
    interiorPanel.previewTags.every((tag) => tag === 'IMG'),
    `every preset preview must be an image, got ${JSON.stringify(interiorPanel.previewTags)}`,
  );
  assert(
    interiorPanel.previewText.every((text) => text === ''),
    `no preset preview may contain text, got ${JSON.stringify(interiorPanel.previewText)}`,
  );
  assert(
    interiorPanel.labels.every((label) => label.length > 0),
    `every preset needs a separate name label, got ${JSON.stringify(interiorPanel.labels)}`,
  );
  await run(['screenshot', `${shotDir}/interior-panel.png`]);

  // The third swatch, clicked exactly as a visitor would, and timed in the page
  // from the click to the revision it commits.
  const thirdId = interiorPanel.ids[2];
  const thirdSwatch = presetList[2];
  const preset3 = await evalValue<{
    ms: number;
    rev: number;
    revBefore: number;
    floor: string | null;
    walls: string | null;
    swatch: string[];
    changed: number;
    active: string[];
    pressed: string[];
    issues: number;
  }>(`(() => {
    const d = window.__viewerDebug;
    const before = d.exportScene();
    const revBefore = d.revision();
    const variantsBefore = Object.fromEntries(before.assets.map((a) => [a.id, a.variant ?? null]));
    const swatch = document.querySelector('.finish-swatch[data-preset=' + CSS.escape(${literal(thirdId)}) + ']');
    const t0 = performance.now();
    swatch.click();
    const ms = performance.now() - t0;
    const after = d.exportScene();
    const preset = after.interiors.find((p) => p.id === ${literal(thirdId)});
    return JSON.stringify({
      ms,
      rev: d.revision(),
      revBefore,
      floor: d.floorFinish(${literal(DEMO.room.living)}),
      walls: d.wallFinish(${literal(DEMO.room.living)}),
      swatch: preset.swatch,
      changed: after.assets.filter((a) => (a.variant ?? null) !== variantsBefore[a.id]).length,
      active: d.presets().filter((p) => p.active).map((p) => p.id),
      pressed: [...document.querySelectorAll('.finish-swatch')].map((s) => s.getAttribute('aria-pressed')),
      issues: d.layoutIssues().filter((issue) => issue.severity === 'error').length,
    });
  })()`);
  console.log(`  interior preset "${thirdSwatch!.name}" applied in ${preset3.ms.toFixed(0)} ms (click to committed revision)`);
  assert(preset3.rev === preset3.revBefore + 1, `a preset must commit exactly one revision, ${preset3.revBefore} -> ${preset3.rev}`);
  assert(preset3.ms <= 1500, `applying a preset should take at most 1500 ms, took ${preset3.ms.toFixed(0)} ms`);
  assert(
    preset3.floor === preset3.swatch[0] && preset3.walls === preset3.swatch[1],
    `the living room must land on the pair the swatch advertises | ${JSON.stringify(preset3)}`,
  );
  assert(preset3.changed > 0, 'applying a preset must swap at least one furniture variant');
  assert(
    preset3.active.length === 1 && preset3.active[0] === thirdId,
    `the applied preset must be the active one, got ${JSON.stringify(preset3.active)}`,
  );
  assert(
    preset3.pressed.filter((value) => value === 'true').length === 1,
    `exactly one swatch is aria-pressed, got ${JSON.stringify(preset3.pressed)}`,
  );
  assert(preset3.issues === 0, `a preset must not break the layout, got ${preset3.issues} error(s)`);
  summary.push(
    `interior preset ${thirdId}: living ${preset3.floor}/${preset3.walls}, ` +
      `${preset3.changed} variants swapped in ${preset3.ms.toFixed(0)} ms`,
  );

  // One dollhouse shot per preset, for the visual review.
  for (const preset of presetList) {
    const shot = await evalValue<{ error: string | null; floor: string | null; walls: string | null }>(
      '(() => { const d = window.__viewerDebug; const r = d.applyPreset(' +
        literal(preset.id) +
        ');' +
        ` return JSON.stringify({ error: r.error ?? null, floor: d.floorFinish(${literal(DEMO.room.living)}),` +
        ` walls: d.wallFinish(${literal(DEMO.room.living)}) }); })()`,
    );
    assert(shot.error === null, `__viewerDebug.applyPreset(${preset.id}) should commit, got ${shot.error}`);
    await settle(ctx, PRESET_RIPPLE_MS, 'the variant ripple and the texture swap, before the review screenshot');
    await run(['screenshot', `${shotDir}/interior-${presetName(preset.id)}.png`]);
  }
  // Back to the standard, so the last screenshot of the run is the usual flat.
  await evalValue<string>(`JSON.stringify(window.__viewerDebug.applyPreset(${literal(presetList[0]!.id)}).rev ?? null)`);
  summary.push(`interior screenshots: ${presetList.map((preset) => presetName(preset.id)).join(', ')} under ${shotDir}`);

  // ---- The selector is a prop: ?presets=0 removes it entirely ----
  await run(['open', withQuery('presets=0')]);
  await run(['wait', '--fn', 'window.__appReady === true']);
  const withoutSelector = await evalValue<{ hidden: boolean; presets: number }>(`(() => {
    const button = document.querySelector('[data-jeex="interiors-button"]');
    return JSON.stringify({
      hidden: button.classList.contains('is-hidden'),
      presets: window.__viewerDebug.presets().length,
    });
  })()`);
  assert(withoutSelector.hidden, '?presets=0 must hide the interior selector');
  assert(withoutSelector.presets === 4, `the scene still carries its interiors with the selector off, got ${withoutSelector.presets}`);
  summary.push('?presets=0: no interior button, the four presets still in the document');
}

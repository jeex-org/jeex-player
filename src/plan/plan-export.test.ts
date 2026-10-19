/**
 * `planToSvg` against the L-shape fixture and the demo apartment: a real
 * `bun:test` environment has no DOM, so the SVG is checked as a STRING — tag
 * balance, attribute presence and byte-for-byte determinism — rather than
 * parsed with a DOM API this layer must not depend on anyway (pure module).
 */

import { describe, expect, test } from 'bun:test';
import { planToSvg } from './plan-export.js';
import { buildPlanDrawing } from './plan-drawing.js';
import { solvePlan } from './plan-solver.js';
import { planDrawingInputs } from '../assets/plan-fixtures.js';
import { lShapePlan } from '../fixtures/plan-l-shape.js';
import { apartmentScene } from '../demo/scene-data.js';
import type { SceneData } from '../scene/types.js';

function svgOf(scene: SceneData, labels: boolean, dimensions: boolean): string {
  const plan = solvePlan(scene);
  const drawing = buildPlanDrawing(plan, scene, { ...planDrawingInputs(scene), labels, dimensions });
  return planToSvg(drawing, plan, { width: 800, height: 600, labels, dimensions, scaleBar: false });
}

/** Every opening `<tag ...>` has a matching `</tag>` or is self-closed (`.../>`); a crude but honest balance check for a hand-built string. */
function tagsBalance(svg: string): boolean {
  const stack: string[] = [];
  const tagPattern = /<\/?([a-zA-Z]+)[^>]*?(\/?)>/g;
  for (const match of svg.matchAll(tagPattern)) {
    const [whole, name, selfClose] = match;
    if (!name) return false;
    if (whole.startsWith('</')) {
      if (stack.pop() !== name) return false;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

describe('planToSvg', () => {
  test('is one well-formed SVG document with exactly one viewBox', () => {
    const svg = svgOf(lShapePlan, true, true);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect((svg.match(/<svg /g) ?? []).length).toBe(1);
    expect((svg.match(/viewBox="/g) ?? []).length).toBe(1);
    expect(tagsBalance(svg)).toBe(true);
  });

  test('carries no NaN, whatever the source plan', () => {
    for (const scene of [lShapePlan, apartmentScene]) {
      expect(svgOf(scene, true, true)).not.toContain('NaN');
    }
  });

  test('width and height are exactly as given', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, planDrawingInputs(lShapePlan));
    const svg = planToSvg(drawing, plan, { width: 973, height: 512 });
    expect(svg).toContain('width="973"');
    expect(svg).toContain('height="512"');
    expect(svg).toContain('viewBox="0 0 973 512"');
  });

  test('one <text> per room when labels is on and dimensions/scale bar are off', () => {
    const plan = solvePlan(apartmentScene);
    const drawing = buildPlanDrawing(plan, apartmentScene, { ...planDrawingInputs(apartmentScene), labels: true });
    const svg = planToSvg(drawing, plan, { width: 800, height: 600, labels: true, dimensions: false, scaleBar: false });
    expect((svg.match(/<text/g) ?? []).length).toBe(plan.rooms.length);
  });

  test('no <text> at all when labels, dimensions and the scale bar are all off', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, planDrawingInputs(lShapePlan));
    const svg = planToSvg(drawing, plan, { width: 800, height: 600, labels: false, dimensions: false, scaleBar: false });
    expect(svg.includes('<text')).toBe(false);
  });

  test('dimensions are recomputed from the plan even when the drawing was built without them', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, planDrawingInputs(lShapePlan));
    expect(drawing.primitives.some((p) => p.kind === 'dimension')).toBe(false);
    const svg = planToSvg(drawing, plan, { width: 800, height: 600, labels: false, dimensions: true, scaleBar: false });
    // Six facade chains (`plan-dimensions.test.ts`), each a value <text> plus three <line>s.
    expect((svg.match(/<text/g) ?? []).length).toBe(6);
  });

  test('is deterministic: two generations of the same input are byte for byte equal', () => {
    const plan = solvePlan(apartmentScene);
    const drawing = buildPlanDrawing(plan, apartmentScene, { ...planDrawingInputs(apartmentScene), labels: true, dimensions: true });
    const a = planToSvg(drawing, plan, { width: 1024, height: 768, title: 'Demo apartment' });
    const b = planToSvg(drawing, plan, { width: 1024, height: 768, title: 'Demo apartment' });
    expect(a).toBe(b);
  });

  test('an optional title becomes the first child; the area caveat is always present as <desc>', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, planDrawingInputs(lShapePlan));
    const svg = planToSvg(drawing, plan, { width: 400, height: 300, title: 'L-shape' });
    expect(svg).toContain('<title>L-shape</title>');
    expect(svg.indexOf('<title>')).toBeLessThan(svg.indexOf('<desc>'));
    expect(svg).toContain('<desc>');
  });

  test('a title with XML-special characters is escaped, not left to break the document', () => {
    const plan = solvePlan(lShapePlan);
    const drawing = buildPlanDrawing(plan, lShapePlan, planDrawingInputs(lShapePlan));
    const svg = planToSvg(drawing, plan, { width: 400, height: 300, title: 'A & B <plan>' });
    expect(svg).toContain('A &amp; B &lt;plan&gt;');
    expect(tagsBalance(svg)).toBe(true);
  });
});

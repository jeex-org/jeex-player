/**
 * The `assets` event: what a document's libraries delivered, once per
 * document, when its first model pass settles.
 */

import { describe, expect, test } from 'bun:test';
import { AssetsReport } from './assets-report.js';
import type { ViewerAssetsInfo } from './viewer-events.js';
import type { SceneModel } from '../scene/scene-model.js';

const first = {} as SceneModel;
const second = {} as SceneModel;
const warn = (code: string) => ({ level: 'warn' as const, code, message: code });

describe('AssetsReport', () => {
  test('carries the model pass and the texture warnings of this document', () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    report.observe(warn('texture-fetch'));
    report.observe(warn('texture-decode'));
    report.observe(warn('option-invalid'));
    report.document(first);
    report.settled({ upgraded: 3, failed: 1, budget: false, failures: [] });
    expect(reports).toEqual([{ models: { upgraded: 3, failed: 1, budget: false }, textures: { failed: 2 } }]);
  });

  test('a new document counts its own textures from zero', () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    report.observe(warn('texture-too-large'));
    report.document(second);
    report.observe(warn('texture-location'));
    report.settled({ upgraded: 0, failed: 0, budget: true, failures: [] });
    expect(reports).toEqual([{ models: { upgraded: 0, failed: 0, budget: true }, textures: { failed: 1 } }]);
  });
});

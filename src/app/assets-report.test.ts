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
  test('carries the model pass and the texture warnings of this document', async () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    report.observe(warn('texture-fetch'));
    report.observe(warn('texture-decode'));
    report.observe(warn('option-invalid'));
    report.document(first);
    await report.settled({ upgraded: 3, failed: 1, budget: false, failures: [] });
    expect(reports).toEqual([{ models: { upgraded: 3, failed: 1, budget: false }, textures: { failed: 2, budget: false } }]);
  });

  test('a new document counts its own textures from zero', async () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    report.observe(warn('texture-too-large'));
    report.document(second);
    report.observe(warn('texture-location'));
    await report.settled({ upgraded: 0, failed: 0, budget: true, failures: [] });
    expect(reports).toEqual([{ models: { upgraded: 0, failed: 0, budget: true }, textures: { failed: 1, budget: false } }]);
  });

  test('the texture byte budget says the remaining surfaces stayed flat', async () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    report.observe(warn('texture-budget'));
    await report.settled({ upgraded: 1, failed: 0, budget: false, failures: [] });
    expect(reports).toEqual([{ models: { upgraded: 1, failed: 0, budget: false }, textures: { failed: 0, budget: true } }]);
  });

  test('a texture that fails after the model pass, while the maps still load, is counted before the event goes', async () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    let mapsDone: () => void = () => undefined;
    const maps = new Promise<void>((resolve) => {
      mapsDone = resolve;
    });
    const sent = report.settled({ upgraded: 0, failed: 0, budget: false, failures: [] }, maps);
    report.observe(warn('texture-fetch'));
    expect(reports).toEqual([]);
    mapsDone();
    await sent;
    expect(reports).toEqual([{ models: { upgraded: 0, failed: 0, budget: false }, textures: { failed: 1, budget: false } }]);
  });

  test('a document replaced while its maps load raises no event for it', async () => {
    const reports: ViewerAssetsInfo[] = [];
    const report = new AssetsReport((info) => reports.push(info));
    report.document(first);
    let mapsDone: () => void = () => undefined;
    const maps = new Promise<void>((resolve) => {
      mapsDone = resolve;
    });
    const sent = report.settled({ upgraded: 0, failed: 0, budget: false, failures: [] }, maps);
    report.document(second);
    mapsDone();
    await sent;
    expect(reports).toEqual([]);
  });
});

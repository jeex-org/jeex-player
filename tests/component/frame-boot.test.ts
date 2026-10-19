/**
 * The frame page's boot (`src/embed/frame-boot.ts`) in a real
 * browser: the mount into `#app`, the read-only default, the `#jeex-size`
 * content box at `?ratio=`, `requestResize()` and the `size` event, and the
 * teardown. `win` is a stand-in with the page's query, so one document can
 * boot several frame pages with different URLs.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { InlineSceneRepository } from '../../src/app/viewer-api.js';
import { FRAME_APP_ID, FRAME_SIZE_ID, bootFramePage, type FramePage } from '../../src/embed/frame-boot.js';
import { delay, demoScene, until } from './support.js';

const pages: FramePage[] = [];
const nodes: HTMLElement[] = [];

/** `#app` and `#jeex-size` the way `embed.html` lays them out, inside an 640 px wide block. */
function framePage(): { app: HTMLElement; size: HTMLElement } {
  const block = document.createElement('div');
  block.style.cssText = 'position:relative;width:640px;height:300px';
  const app = document.createElement('div');
  app.id = FRAME_APP_ID;
  app.style.cssText = 'position:absolute;inset:0';
  const size = document.createElement('div');
  size.id = FRAME_SIZE_ID;
  size.style.cssText = 'display:block;inline-size:100%;visibility:hidden';
  block.append(app, size);
  document.body.append(block);
  nodes.push(block);
  return { app, size };
}

/** A window that has the frame's query and, optionally, responsive iframes. */
function frameWindow(search: string, requestResize?: () => void, parent?: Window): Window {
  return { location: { search }, requestResize, parent: parent ?? window } as unknown as Window;
}

/** How many console warnings were the frame's `resize-request-refused` entry. */
function refusals(warnings: { mock: { calls: unknown[][] } }): number {
  return warnings.mock.calls.filter((call) => String(call[0]).includes('[jeex-viewer] resize-request-refused:')).length;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const page of pages.splice(0)) page.dispose();
  for (const node of nodes.splice(0)) node.remove();
});

describe('bootFramePage', () => {
  test('mounts read-only into #app and sizes #jeex-size at ?ratio=, telling the browser', async () => {
    const { app, size } = framePage();
    const requestResize = vi.fn();
    const page = bootFramePage(document, frameWindow('?ratio=4:3&tour=off', requestResize), new InlineSceneRepository(demoScene()));
    pages.push(page);
    await page.handle.ready;
    expect(app.querySelector('[data-jeex="viewer"]')).not.toBeNull();
    expect(page.handle.options.readonly).toBe(true);
    expect(Math.round(size.getBoundingClientRect().height)).toBe(480);
    expect(requestResize).toHaveBeenCalled();
  });

  test('readonly=0 opts into editing, and a value that is no ratio keeps 16:9', async () => {
    const { size } = framePage();
    const page = bootFramePage(document, frameWindow('?readonly=0&ratio=wide&tour=off'), new InlineSceneRepository(demoScene()));
    pages.push(page);
    await page.handle.ready;
    expect(page.handle.options.readonly).toBe(false);
    expect(Math.round(size.getBoundingClientRect().height)).toBe(360);
  });

  test('with ?host= the bridge reports the content box as `size`, and stops on dispose', async () => {
    const { size } = framePage();
    const posted: unknown[] = [];
    const parent = { postMessage: (message: unknown) => posted.push(message) } as unknown as Window;
    const page = bootFramePage(
      document,
      frameWindow(`?host=${encodeURIComponent('https://host.example')}&tour=off`, undefined, parent),
      new InlineSceneRepository(demoScene()),
    );
    const sizes = (): unknown[] =>
      posted
        .filter((message) => (message as { event?: string }).event === 'size')
        .map((message) => (message as { payload: unknown }).payload);
    await until(() => sizes().length > 0, 'the first size report');
    expect(sizes()[0]).toEqual({ width: 640, height: 360 });
    size.parentElement!.style.width = '320px';
    await until(() => sizes().some((entry) => (entry as { width: number }).width === 320), 'the size after a width change');
    expect(sizes().at(-1)).toEqual({ width: 320, height: 180 });
    page.dispose();
    pages.splice(pages.indexOf(page), 1);
    const before = sizes().length;
    size.parentElement!.style.width = '500px';
    await delay(100);
    expect(sizes().length).toBe(before);
  });

  test('opened as a top-level page it boots without asking the browser to resize it', async () => {
    const { size } = framePage();
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Chrome 154+ has `requestResize` on every window and throws
    // `NotAllowedError` from a top-level document (MDN).
    const requestResize = vi.fn(() => {
      throw new DOMException("Failed to execute 'requestResize' on 'Window'", 'NotAllowedError');
    });
    const posted: unknown[] = [];
    const win = frameWindow(`?host=${encodeURIComponent('https://host.example')}&tour=off`, requestResize);
    // A top-level document is its own parent, so the bridge posts to itself.
    Object.assign(win, { parent: win, postMessage: (message: unknown) => posted.push(message) });
    const page = bootFramePage(document, win, new InlineSceneRepository(demoScene()));
    pages.push(page);
    const sizes = (): unknown[] => posted.filter((message) => (message as { event?: string }).event === 'size');
    await until(() => sizes().length > 0, 'the first size report');
    size.parentElement!.style.width = '320px';
    // The size event follows the resize request inside one measurement, so a
    // second size report means the watch has measured the change.
    await until(() => sizes().length > 1, 'the size after a width change');
    expect(requestResize).not.toHaveBeenCalled();
    expect(refusals(warnings)).toBe(0);
  });

  test('a framed page whose resize request is refused logs it once and still reports `size` to the host', async () => {
    const { size } = framePage();
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const posted: unknown[] = [];
    const parent = { postMessage: (message: unknown) => posted.push(message) } as unknown as Window;
    const requestResize = vi.fn(() => {
      throw new DOMException("Failed to execute 'requestResize' on 'Window'", 'NotAllowedError');
    });
    const page = bootFramePage(
      document,
      frameWindow(`?host=${encodeURIComponent('https://host.example')}&tour=off`, requestResize, parent),
      new InlineSceneRepository(demoScene()),
    );
    pages.push(page);
    const sizes = (): unknown[] => posted.filter((message) => (message as { event?: string }).event === 'size');
    await until(() => sizes().length > 0, 'the first size report');
    size.parentElement!.style.width = '320px';
    await until(() => sizes().length > 1, 'the size after a width change');
    expect(requestResize).toHaveBeenCalledTimes(1);
    expect(refusals(warnings)).toBe(1);
  });

  test('with no ?scene= and no fallback the frame shows no-scene-source instead of throwing', async () => {
    framePage();
    const page = bootFramePage(document, frameWindow('?tour=off'));
    pages.push(page);
    await expect(page.handle.ready).rejects.toMatchObject({ code: 'no-scene-source' });
  });
});

/**
 * The player's anonymous telemetry in a real browser: what reaches the
 * endpoint, and that nothing does when it is switched off, in every spelling
 * of "off" and every embed form.
 *
 * Every request to the telemetry host is intercepted before it leaves the
 * browser (the test browsers also resolve that host to nothing,
 * `tests/headless-webgl.ts`), recorded and answered locally.
 */

import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { waitForBoot } from './support.js';

const TELEMETRY = /^https:\/\/telemetry\.jeex\.org\//;
const CONTEXT_KEYS = ['embed', 'group', 'lang', 'page', 'player', 'schema', 'site', 'subject'];
/** How long a switched-off visit is watched for a stray request after it ends, ms. */
const QUIET_MS = 2500;

type Captured = { body: Record<string, unknown>; request: Request };

/** Records every telemetry request of the context, answered locally. */
async function capture(context: BrowserContext): Promise<Captured[]> {
  const seen: Captured[] = [];
  await context.route(TELEMETRY, async (route) => {
    seen.push({ body: JSON.parse(route.request().postData() ?? 'null') as Record<string, unknown>, request: route.request() });
    await route.fulfill({ status: 204 });
  });
  return seen;
}

/**
 * Navigates to the telemetry page without waiting for its `load` event.
 *
 * The page's own ready flag is the signal every test waits on; `load` is not.
 * It waits for every subresource, the iframe form's whole frame document
 * included, and the viewer is already drawing by then: on SwiftShader on a
 * loaded machine each of those steps queues behind a frame of several
 * seconds, and `page.goto` alone ran past the 60 s test budget.
 */
async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

/** Opens the telemetry page in one form and waits until its viewer is on screen. */
async function open(page: Page, form: 'element' | 'script' | 'iframe', analytics?: string): Promise<void> {
  const query = new URLSearchParams({ form });
  if (analytics !== undefined) query.set('analytics', analytics);
  await visit(page, `/dev/telemetry.html?${query.toString()}`);
  await waitForBoot(page, form === 'element' ? 'window.__appReady === true' : 'window.jeexTelemetryReady === true');
}

/**
 * Everything a visit can trigger after boot: a page leave, then the viewer
 * torn down the way each form's host does it — the element and the iframe by
 * removal, the script form by `dispose()` and then removal.
 *
 * The script form is disposed, not only removed: a `mountViewer` viewer whose
 * container is emptied without `dispose()` keeps its render loop and WebGL
 * context, and on SwiftShader the NEXT page in the same browser then waited
 * 69 s for DOMContentLoaded (0.3 s after a disposed one), which failed
 * whichever test the worker ran after a script-form one.
 */
async function finishVisit(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))).catch(() => undefined);
  }
  await page.evaluate(() => {
    window.jeexTelemetryHandle?.dispose();
    document.querySelector('#viewer')?.remove();
    document.querySelector('#stage')?.replaceChildren();
  });
  await page.waitForTimeout(QUIET_MS);
}

test('the element sends view and ready, with closed keys, no referrer and no cookie', async ({ page, context }) => {
  const seen = await capture(context);
  await visit(page, '/dev/telemetry.html?utm_source=mail#x');
  await waitForBoot(page, 'window.__appReady === true');
  await expect.poll(() => seen.map((entry) => entry.body['event'])).toEqual(['view', 'ready']);
  const [view, ready] = seen.map((entry) => entry.body);
  expect(Object.keys(view!).sort()).toEqual([...CONTEXT_KEYS, 'event'].sort());
  expect(Object.keys(ready!).sort()).toEqual([...CONTEXT_KEYS, 'event', 'load'].sort());
  expect(view).toMatchObject({ embed: 'element', page: '/dev/telemetry.html', group: 'lifecycle', lang: 'en' });
  expect(view!['site']).toBe(new URL(page.url()).origin);
  for (const { request } of seen) {
    expect(request.method()).toBe('POST');
    const headers = await request.allHeaders();
    expect(headers['referer']).toBeUndefined();
    expect(headers['cookie']).toBeUndefined();
  }
  // Leaving the page sends what was gathered, each group as its own request.
  // `device` carries frame times, and a frame interval over a second is a
  // pause, not a frame (`MAX_FRAME_INTERVAL_MS`): on SwiftShader on a loaded
  // machine every real interval is longer than that (1.6 to 2.7 s measured),
  // so nothing is gathered and nothing is sent, however long the test waits.
  // The page's clock is therefore paused and stepped over two frames, which
  // makes the measured intervals 16 ms whatever a frame costs to draw. It is
  // paused a minute ahead of the page's own time, because each protocol call
  // waits behind a frame and a nearer target was already in the past when
  // the call arrived; the jump fires a timer due in that minute at most once.
  await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 60_000);
  await page.clock.runFor(40);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect.poll(() => seen.some((entry) => entry.body['group'] === 'device')).toBe(true);
  expect(JSON.stringify(seen.map((entry) => entry.body))).not.toContain('utm_source');
});

/** Every spelling of off, per form: the attribute, the `mountViewer` option, the `embedViewer` option. */
const OFF: ReadonlyArray<{ form: 'element' | 'script' | 'iframe'; analytics: string }> = [
  ...['off', 'OFF', 'none', 'false', '', 'nonsense'].map((analytics) => ({ form: 'element' as const, analytics })),
  ...['off', 'OFF', 'none', 'false', 'null', 'object-off', 'nonsense'].map((analytics) => ({ form: 'script' as const, analytics })),
  ...['off', 'OFF', 'none', 'false', 'null', 'object-off', 'nonsense'].map((analytics) => ({ form: 'iframe' as const, analytics })),
];

for (const { form, analytics } of OFF) {
  test(`${form} with analytics=${JSON.stringify(analytics)} makes no telemetry request at all`, async ({ page, context }) => {
    const seen = await capture(context);
    await open(page, form, analytics);
    await finishVisit(page);
    expect(seen.map((entry) => entry.body)).toEqual([]);
  });
}

test('positive control: the same visit with nothing said does send, in all three forms', async ({ page, context }) => {
  const seen = await capture(context);
  for (const form of ['element', 'script', 'iframe'] as const) {
    await open(page, form);
    await expect.poll(() => seen.filter((entry) => entry.body['embed'] === form && entry.body['event'] === 'ready').length).toBe(1);
  }
});

test('Global Privacy Control sends nothing through a whole visit', async ({ page, context }) => {
  const seen = await capture(context);
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  await open(page, 'element');
  await finishVisit(page);
  expect(seen).toEqual([]);
});

test('the iframe page holds view and ready until the host context, then names the host page and site', async ({ page, context }) => {
  const seen = await capture(context);
  await open(page, 'iframe');
  await expect.poll(() => seen.map((entry) => entry.body['event'])).toEqual(['view', 'ready']);
  const origin = new URL(page.url()).origin;
  for (const { body } of seen) expect(body).toMatchObject({ embed: 'iframe', site: origin, page: '/dev/telemetry.html' });
  // The path travelled by postMessage only: the frame URL carries the bridge's parameters, no host path.
  const src = (await page.locator('#stage iframe').getAttribute('src')) ?? '';
  expect([...new URL(src, origin).searchParams.keys()].sort()).toEqual(['host', 'viewerId']);
});

test('without location.ancestorOrigins the iframe site is the verified host origin', async ({ page, context }) => {
  const seen = await capture(context);
  // Firefox has no `ancestorOrigins`; every frame of this context behaves the same.
  await context.addInitScript(() => Object.defineProperty(Location.prototype, 'ancestorOrigins', { get: () => undefined }));
  await open(page, 'iframe');
  await expect.poll(() => seen.map((entry) => entry.body['event'])).toEqual(['view', 'ready']);
  for (const { body } of seen) expect(body).toMatchObject({ site: new URL(page.url()).origin, page: '/dev/telemetry.html' });
});

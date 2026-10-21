import { describe, expect, test } from 'bun:test';
import { FrameSite } from './frame-site.js';

const win = (ancestorOrigins?: string[]) => ({ location: { ancestorOrigins } }) as unknown as Window;

describe('FrameSite', () => {
  test('the browser-reported embedding origin is the site; the page waits for the host', () => {
    const site = new FrameSite(win(['https://agency.example']));
    expect([site.site(), site.page()]).toEqual(['https://agency.example', null]);
    site.verified('https://other.example');
    expect(site.site()).toBe('https://agency.example');
  });

  test('without ancestor origins, the first verified host origin; before it, nothing', () => {
    const site = new FrameSite(win());
    expect(site.site()).toBeNull();
    site.verified('https://agency.example');
    site.verified('https://later.example');
    expect(site.site()).toBe('https://agency.example');
  });

  test('an opaque or malformed ancestor origin is not a site', () => {
    expect(new FrameSite(win(['null'])).site()).toBeNull();
  });

  test('only the first context counts', () => {
    const site = new FrameSite(win());
    site.context('/listing/1');
    site.context('/elsewhere');
    expect(site.page()).toBe('/listing/1');
  });
});

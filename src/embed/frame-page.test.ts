/**
 * The two trust decisions `embed.html` makes about its own query string.
 *
 * One refuses a broadcast or malformed `?host=`, the other takes `debug` away
 * from the frame page, and both are the kind of rule that only holds if the
 * rejected cases are written down: `*` and `null` are the ones an attacker
 * reaches for, and a trailing slash is the one an honest host gets wrong.
 */

import { describe, expect, test } from 'bun:test';
import { embedPageOptions, framePageRatio, hostOriginFrom } from './frame-page.js';
import { isExactOrigin } from './frame-page.schema.js';

describe('isExactOrigin', () => {
  test('accepts an exact http(s) origin, with and without a port', () => {
    expect(isExactOrigin('https://example.com')).toBe(true);
    expect(isExactOrigin('http://localhost:5190')).toBe(true);
    expect(isExactOrigin('https://sub.example.co.uk:8443')).toBe(true);
  });

  test('rejects the wildcard and the literal null', () => {
    expect(isExactOrigin('*')).toBe(false);
    expect(isExactOrigin('null')).toBe(false);
  });

  test('rejects anything that is more than an origin', () => {
    // A trailing slash is a URL, not an origin: `postMessage` compares the
    // exact serialisation and would never match.
    expect(isExactOrigin('https://example.com/')).toBe(false);
    expect(isExactOrigin('https://example.com/app')).toBe(false);
    expect(isExactOrigin('https://example.com?a=1')).toBe(false);
    expect(isExactOrigin('https://user:pw@example.com')).toBe(false);
  });

  test('rejects schemes that serialise their origin as "null"', () => {
    expect(isExactOrigin('file://')).toBe(false);
    expect(isExactOrigin('data:text/html,x')).toBe(false);
    expect(isExactOrigin('javascript:0')).toBe(false);
  });

  test('rejects rubbish and the empty string', () => {
    expect(isExactOrigin('notanorigin')).toBe(false);
    expect(isExactOrigin('')).toBe(false);
    expect(isExactOrigin('  https://example.com  ')).toBe(false);
  });
});

describe('hostOriginFrom', () => {
  test('answers the origin when the query names a valid one', () => {
    const refused: string[] = [];
    const origin = hostOriginFrom(new URLSearchParams('host=https://example.com'), 'host', (raw) => refused.push(raw));
    expect(origin).toBe('https://example.com');
    expect(refused).toEqual([]);
  });

  test('answers null and reports the value when the query names rubbish', () => {
    const refused: string[] = [];
    const origin = hostOriginFrom(new URLSearchParams('host=*'), 'host', (raw) => refused.push(raw));
    expect(origin).toBeNull();
    expect(refused).toEqual(['*']);
  });

  test('a missing or empty host is no bridge and no complaint', () => {
    const refused: string[] = [];
    expect(hostOriginFrom(new URLSearchParams(''), 'host', (raw) => refused.push(raw))).toBeNull();
    expect(hostOriginFrom(new URLSearchParams('host='), 'host', (raw) => refused.push(raw))).toBeNull();
    expect(refused).toEqual([]);
  });
});

describe('embedPageOptions', () => {
  test('never carries the authoring capability off a URL', () => {
    const options = embedPageOptions('?debug=1&view=walk');
    expect('debug' in options).toBe(false);
    expect(options.view?.mode).toBe('walk');
  });

  test('drops debug however the query spells it', () => {
    expect('debug' in embedPageOptions('?debug')).toBe(false);
    expect('debug' in embedPageOptions('?debug=true')).toBe(false);
    expect('debug' in embedPageOptions('?debug=0')).toBe(false);
  });

  test('leaves every other option exactly as the query named it', () => {
    const options = embedPageOptions('?view=tour&tour=play&minimap=0&lang=ru');
    expect(options.view?.mode).toBe('tour');
    expect(options.tour?.mode).toBe('play');
    expect(options.view?.minimap).toBe(false);
    expect(options.locale).toBe('ru');
  });

  test('is read-only unless the query opts into editing', () => {
    expect(embedPageOptions('?view=walk').readonly).toBe(true);
    expect(embedPageOptions('?readonly=0').readonly).toBe(false);
    expect(embedPageOptions('?readonly=false').readonly).toBe(false);
    expect(embedPageOptions('?readonly=1').readonly).toBe(true);
  });

  test('the embed page inherits every OPTION_SCHEMA row the query names, quality included', () => {
    // The iframe reads the whole query through the one adapter, so a new row
    // travels without the page learning about it; this pins the inheritance.
    expect(embedPageOptions('?quality=low').quality).toBe('low');
    expect(embedPageOptions('').quality).toBeUndefined();
  });
});

describe('framePageRatio', () => {
  test('reads ?ratio= and defaults to 16:9', () => {
    expect(framePageRatio(new URLSearchParams(''))).toEqual({ width: 16, height: 9 });
    expect(framePageRatio(new URLSearchParams('ratio=4:3'))).toEqual({ width: 4, height: 3 });
    expect(framePageRatio(new URLSearchParams('ratio=1'))).toEqual({ width: 1, height: 1 });
  });

  test('a value that is no ratio is reported and the default stands', () => {
    const refused: string[] = [];
    expect(framePageRatio(new URLSearchParams('ratio=wide'), (raw) => refused.push(raw))).toEqual({ width: 16, height: 9 });
    expect(refused).toEqual(['wide']);
  });
});

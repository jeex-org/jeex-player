/**
 * The wire contract: what counts as one of our messages, and what a message
 * looks like once built.
 *
 * `isJeexMessage` is the only thing standing between an arbitrary page's
 * postMessage traffic and the viewer's command dispatch, so most of this file
 * is the things it must REFUSE.
 */

import { describe, expect, test } from 'bun:test';
import {
  CHANNEL,
  DEFAULT_VIEWER_ID,
  METHOD_ALIASES,
  PROTOCOL_VERSION,
  commandMessage,
  commandReply,
  eventMessage,
  isJeexMessage,
  resolveMethod,
} from './protocol.js';

const command = { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1', kind: 'command', id: 'c1', method: 'play' };

describe('isJeexMessage', () => {
  test('accepts a command, a reply and an event', () => {
    expect(isJeexMessage(command)).toBe(true);
    expect(isJeexMessage({ ...command, kind: 'reply', ok: true })).toBe(true);
    expect(isJeexMessage({ channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1', kind: 'event', event: 'ready' })).toBe(true);
  });

  test('refuses anything that is not this channel at this version', () => {
    expect(isJeexMessage({ ...command, channel: 'other-widget' })).toBe(false);
    expect(isJeexMessage({ ...command, version: 2 })).toBe(false);
    expect(isJeexMessage({ ...command, version: '1' })).toBe(false);
  });

  test('refuses a message with no viewer, no kind or a kind it has no shape for', () => {
    expect(isJeexMessage({ ...command, viewerId: undefined })).toBe(false);
    expect(isJeexMessage({ ...command, kind: 'shout' })).toBe(false);
    expect(isJeexMessage({ channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1' })).toBe(false);
  });

  test('refuses a command or reply whose correlation id is not a string', () => {
    expect(isJeexMessage({ ...command, id: 7 })).toBe(false);
    expect(isJeexMessage({ ...command, method: 7 })).toBe(false);
    expect(isJeexMessage({ ...command, kind: 'reply', ok: 'yes' })).toBe(false);
  });

  test('refuses the values a hostile page would try first', () => {
    for (const value of [null, undefined, 'jeex-embed', 7, [], () => undefined]) {
      expect([String(value), isJeexMessage(value)]).toEqual([String(value), false]);
    }
  });
});

describe('resolveMethod', () => {
  test('every documented method is spelled exactly', () => {
    for (const method of [
      'play',
      'pause',
      'toggle',
      'stop',
      'seek',
      'seekDistance',
      'seekTime',
      'setTourSpeed',
      'progress',
      'loadScene',
      'setMode',
      'getMode',
      'focusRoom',
      'getState',
      'getScene',
      'setFurnitureVisible',
      'setLocale',
      'setLightTemperature',
      'resize',
      'exportGlb',
      'exportUsdz',
      'dispose',
    ]) {
      expect([method, resolveMethod(method)]).toEqual([method, method]);
    }
  });

  test('the alias spellings resolve to their canonical method names', () => {
    expect(resolveMethod('playTour')).toBe('play');
    expect(resolveMethod('pauseTour')).toBe('pause');
    expect(resolveMethod('destroy')).toBe('dispose');
    // Every alias resolves to a real method — an alias to nothing would answer
    // `unknown-method` from a name the table claims to accept.
    for (const [alias, method] of Object.entries(METHOD_ALIASES)) {
      expect([alias, resolveMethod(method)]).toEqual([alias, method]);
    }
  });

  test('a near miss is not guessed at', () => {
    expect(resolveMethod('Play')).toBeNull();
    expect(resolveMethod('seek ')).toBeNull();
    expect(resolveMethod('getSnapshot')).toBeNull();
    expect(resolveMethod('constructor')).toBeNull();
    expect(resolveMethod('__proto__')).toBeNull();
  });
});

describe('the message constructors', () => {
  test('a command carries the envelope, the id and the method', () => {
    expect(commandMessage('v1', 'c1', 'seek', { fraction: 0.5 })).toEqual({
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      viewerId: 'v1',
      kind: 'command',
      id: 'c1',
      method: 'seek',
      params: { fraction: 0.5 },
    });
  });

  test('a command with no parameters carries no `params` key at all', () => {
    expect(Object.hasOwn(commandMessage('v1', 'c1', 'play'), 'params')).toBe(false);
  });

  test('a reply echoes the id and says which way it went', () => {
    expect(commandReply('v1', 'c1', { ok: true, result: 42 })).toEqual({
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      viewerId: 'v1',
      kind: 'reply',
      id: 'c1',
      ok: true,
      result: 42,
    });
    expect(commandReply('v1', 'c1', { ok: false, error: { code: 'bad-params', message: 'no' } })).toEqual({
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      viewerId: 'v1',
      kind: 'reply',
      id: 'c1',
      ok: false,
      error: { code: 'bad-params', message: 'no' },
    });
  });

  test('an event carries its name and payload', () => {
    expect(eventMessage('v1', 'mode', 'walk')).toEqual({
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      viewerId: 'v1',
      kind: 'event',
      event: 'mode',
      payload: 'walk',
    });
  });

  test('everything they build is accepted by the guard on the other side', () => {
    expect(isJeexMessage(commandMessage('v1', 'c1', 'play'))).toBe(true);
    expect(isJeexMessage(commandReply('v1', 'c1', { ok: true }))).toBe(true);
    expect(isJeexMessage(eventMessage('v1', 'ready', {}))).toBe(true);
  });

  test('the default viewer id is what a single-frame host may leave unsaid', () => {
    expect(DEFAULT_VIEWER_ID).toBe('jeex');
  });
});

/**
 * The wire is the one place a hostile page's data becomes this program's
 * control flow, so the guards get the hostile cases as well as the honest ones.
 */
describe('negative paths', () => {
  test('a method named after something on Object.prototype resolves to nothing', () => {
    // `resolveMethod` reads the alias table with `Object.hasOwn` for exactly
    // this: a plain `METHOD_ALIASES[method]` would find `constructor`,
    // `toString` and `__proto__` on the prototype chain and hand back
    // something that is not a command name.
    for (const method of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(resolveMethod(method), method).toBeNull();
    }
  });

  test('a command carrying __proto__ in its params does not pollute Object.prototype', () => {
    // `JSON.parse` is how a payload really arrives, and it is the one way to
    // build an OWN `__proto__` property — an object literal would set the
    // prototype instead of a key.
    const params = JSON.parse('{"__proto__": {"polluted": true}, "fraction": 0.5}') as Record<string, unknown>;
    const seek = commandMessage('v1', 'c1', 'seek', params);
    expect(isJeexMessage(seek)).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // The honest field is still there and still reachable.
    expect(seek.params?.['fraction']).toBe(0.5);
  });

  test('a message whose prototype is null is still recognised by its own fields', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, {
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      viewerId: 'v1',
      kind: 'event',
      event: 'ready',
    });
    expect(isJeexMessage(bare)).toBe(true);
  });

  test('a version this build does not speak is dropped rather than interpreted', () => {
    for (const version of [0, 2, '1', null, undefined, Number.NaN]) {
      expect(isJeexMessage({ channel: CHANNEL, version, viewerId: 'v1', kind: 'event', event: 'ready' }), String(version)).toBe(false);
    }
  });

  test('a viewerId that is not a string is dropped, however truthy', () => {
    for (const viewerId of [1, true, {}, ['jeex'], null]) {
      expect(
        isJeexMessage({ channel: CHANNEL, version: PROTOCOL_VERSION, viewerId, kind: 'event', event: 'ready' }),
        JSON.stringify(viewerId),
      ).toBe(false);
    }
  });

  test('a command with no id, or an id that is not a string, is not a command', () => {
    const base = { channel: CHANNEL, version: PROTOCOL_VERSION, viewerId: 'v1', kind: 'command', method: 'play' };
    expect(isJeexMessage(base)).toBe(false);
    expect(isJeexMessage({ ...base, id: 7 })).toBe(false);
    expect(isJeexMessage({ ...base, id: 'c1' })).toBe(true);
  });
});

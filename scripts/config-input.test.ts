import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portEnv, positiveIntEnv, readPackageVersion } from './config-input.js';

describe('positiveIntEnv and portEnv', () => {
  test('an unset variable takes the fallback', () => {
    expect(positiveIntEnv('WORKERS', 2, {})).toBe(2);
    expect(portEnv('PORT', 3701, {})).toBe(3701);
  });

  test('a valid value is read as a number', () => {
    expect(positiveIntEnv('WORKERS', 2, { WORKERS: '4' })).toBe(4);
    expect(portEnv('PORT', 3701, { PORT: '3711' })).toBe(3711);
  });

  test.each(['abc', '', '0', '-1', '2.5', 'NaN'])('%j fails naming the variable', (raw) => {
    expect(() => positiveIntEnv('WORKERS', 2, { WORKERS: raw })).toThrow(`WORKERS must be a positive integer, got ${JSON.stringify(raw)}`);
  });

  test('a port above 65535 fails', () => {
    expect(() => portEnv('PORT', 3701, { PORT: '70000' })).toThrow('PORT must be a port number (1-65535), got "70000"');
  });
});

describe('readPackageVersion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'config-input-'));
  const file = (name: string, body: unknown): URL => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(body));
    return pathToFileURL(path);
  };

  test('reads the version of this repository', () => {
    expect(readPackageVersion(new URL('../package.json', import.meta.url))).toMatch(/^\d+\.\d+\.\d+/);
  });

  test.each([
    ['no version', {}],
    ['a numeric version', { version: 1 }],
    ['an empty version', { version: '' }],
  ])('%s fails naming the file', (_name, body) => {
    const url = file('package.json', body);
    expect(() => readPackageVersion(url)).toThrow(`${url.pathname}: "version"`);
  });
});

/**
 * The two pages that tell a reader what the player sends — `TELEMETRY.md` and
 * the player site's `site/telemetry.html` — agree with the send schema in both
 * directions: every field of the schema is a row of their field tables (the
 * first cell, the whole cell), every row names a field the schema has, and
 * every value of every closed set appears as a whole code token. A field added
 * to the schema without its documentation, or documented without existing,
 * fails here.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { generateTelemetrySchema } from './schema-gen.js';

type Node = { properties?: Record<string, Node>; enum?: unknown[]; const?: unknown; [key: string]: unknown };

/** Every property name, and every enum or const string, anywhere in the schema. */
function schemaVocabulary(
  node: unknown,
  fields = new Set<string>(),
  values = new Set<string>(),
): { fields: Set<string>; values: Set<string> } {
  if (Array.isArray(node)) for (const item of node) schemaVocabulary(item, fields, values);
  else if (node !== null && typeof node === 'object') {
    const schema = node as Node;
    for (const key of Object.keys(schema.properties ?? {})) fields.add(key);
    for (const value of [...(schema.enum ?? []), schema.const]) if (typeof value === 'string') values.add(value);
    for (const value of Object.values(schema)) schemaVocabulary(value, fields, values);
  }
  return { fields, values };
}

const SCHEMA = schemaVocabulary(generateTelemetrySchema());

/** The first cells of every table row in the Markdown, each a single code token. */
function markdownFields(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('|---') && !line.startsWith('| Field'))
    .map((line) => line.split('|')[1]!.trim())
    .map((cell) => /^`([^`]+)`$/.exec(cell)?.[1] ?? `NOT A FIELD: ${cell}`);
}

/** The first cells of every table body row in the HTML, each a single `<code>` token. */
function htmlFields(text: string): string[] {
  return [...text.matchAll(/<tr><td>(.*?)<\/td>/g)].map((match) => {
    const token = /^<code>([^<]+)<\/code>$/.exec(match[1]!)?.[1];
    return token === undefined ? `NOT A FIELD: ${match[1]}` : token.replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  });
}

/** Every whole code token in the document. */
function codeTokens(text: string, html: boolean): Set<string> {
  const pattern = html ? /<code>([^<]+)<\/code>/g : /`([^`]+)`/g;
  return new Set([...text.matchAll(pattern)].map((match) => match[1]!.replaceAll('&lt;', '<').replaceAll('&gt;', '>')));
}

const DOCUMENTS = [
  { name: 'TELEMETRY.md', text: readFileSync('TELEMETRY.md', 'utf8'), html: false },
  { name: 'site/telemetry.html', text: readFileSync('site/telemetry.html', 'utf8'), html: true },
] as const;

describe('the telemetry documentation', () => {
  test('the schema has a vocabulary to check', () => {
    expect(SCHEMA.fields.size).toBeGreaterThan(40);
    expect(SCHEMA.values.size).toBeGreaterThan(60);
  });

  for (const { name, text, html } of DOCUMENTS) {
    const documented = html ? htmlFields(text) : markdownFields(text);

    test(`${name}: every schema field is a row of a field table`, () => {
      expect([...SCHEMA.fields].filter((field) => !documented.includes(field)).sort()).toEqual([]);
    });

    test(`${name}: every row of a field table is a field the schema has`, () => {
      expect(documented.filter((field) => !SCHEMA.fields.has(field)).sort()).toEqual([]);
    });

    test(`${name}: every value of every closed set appears as a whole code token`, () => {
      const tokens = codeTokens(text, html);
      expect([...SCHEMA.values].filter((value) => !tokens.has(value)).sort()).toEqual([]);
    });
  }

  test('the site page links the schema where the site build publishes it', () => {
    expect(DOCUMENTS[1].text).toContain('href="schema/telemetry/1.0.0.json"');
    expect(DOCUMENTS[0].text).toContain('(telemetry.schema.json)');
  });
});

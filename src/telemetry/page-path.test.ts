import { describe, expect, test } from 'bun:test';
import { PAGE_PATH_LIMIT, sanitisePagePath } from './page-path.js';

describe('sanitisePagePath', () => {
  test('keeps an ordinary path as it is', () => {
    expect(sanitisePagePath('/listings/two-bedroom-flat')).toBe('/listings/two-bedroom-flat');
  });

  test('drops the query and the fragment, always', () => {
    expect(sanitisePagePath('/flat?email=a@b.example&utm_source=x#gallery')).toBe('/flat');
    expect(sanitisePagePath('/flat#token=abc')).toBe('/flat');
  });

  test('replaces an email segment, even percent-encoded', () => {
    expect(sanitisePagePath('/users/someone@example.org/tours')).toBe('/users/:id/tours');
    expect(sanitisePagePath('/users/someone%40example.org')).toBe('/users/:id');
  });

  test('a UUID inside a segment and a URL-safe token are replaced', () => {
    expect(sanitisePagePath('/flat-0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5f-sea-view')).toBe('/:id');
    expect(sanitisePagePath('/share/aB3_x-Qr9zK-2mN_pL8vT')).toBe('/share/:id');
    expect(sanitisePagePath('/share/ab-cd-ef_gh-ij-kl-mn-op')).toBe('/share/:id');
    // Long slugs of words have no digit and no underscore: page names, kept.
    expect(sanitisePagePath('/blog/how-to-choose-a-bright-family-flat')).toBe('/blog/how-to-choose-a-bright-family-flat');
  });

  test('replaces a handle segment', () => {
    expect(sanitisePagePath('/@someone/tours')).toBe('/:id/tours');
    expect(sanitisePagePath('/%40someone')).toBe('/:id');
  });

  test('replaces a UUID segment of any version and case', () => {
    expect(sanitisePagePath('/p/0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e5f/view')).toBe('/p/:id/view');
    expect(sanitisePagePath('/p/550E8400-E29B-41D4-A716-446655440000')).toBe('/p/:id');
  });

  test('replaces a long token of 20 or more letters and digits', () => {
    expect(sanitisePagePath('/reset/abcdefghij0123456789')).toBe('/reset/:id');
    expect(sanitisePagePath('/reset/x_abcDEFghi0123456789JKL')).toBe('/reset/:id');
    // A hyphenated slug is a page name, however long.
    expect(sanitisePagePath('/flats/two-bedroom-flat-with-a-garden-view')).toBe('/flats/two-bedroom-flat-with-a-garden-view');
    // 18 letters and digits are kept: it is a word, not a token.
    expect(sanitisePagePath('/a/abcdefghijklmn1234')).toBe('/a/abcdefghijklmn1234');
  });

  test('replaces a number of six or more digits, keeps a short one', () => {
    expect(sanitisePagePath('/listing/1234567')).toBe('/listing/:id');
    expect(sanitisePagePath('/listing/12345')).toBe('/listing/12345');
    expect(sanitisePagePath('/order-123456')).toBe('/:id');
  });

  test('a segment with a long number inside it is replaced as a whole', () => {
    expect(sanitisePagePath('/flat-9876543-sea-view')).toBe('/:id');
  });

  test('cuts the result to the limit', () => {
    const long = `/${'a'.repeat(300)}`;
    // A 300-letter segment is a long token, so it becomes :id.
    expect(sanitisePagePath(long)).toBe('/:id');
    const many = '/abc'.repeat(100);
    const result = sanitisePagePath(many);
    expect(result.length).toBe(PAGE_PATH_LIMIT);
    expect(many.startsWith(result)).toBe(true);
  });

  test('an empty or relative input becomes a rooted path', () => {
    expect(sanitisePagePath('')).toBe('/');
    expect(sanitisePagePath('?q=1')).toBe('/');
    expect(sanitisePagePath('flat')).toBe('/flat');
  });

  test('a full URL keeps only its path', () => {
    expect(sanitisePagePath('https://site.example/flat/1234567?x=1')).toBe('/flat/:id');
  });

  test('control characters and spaces never survive', () => {
    expect(sanitisePagePath('/a\nb c')).toBe('/a%0Ab%20c');
  });
});

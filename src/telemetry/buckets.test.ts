import { describe, expect, test } from 'bun:test';
import { COUNTER_CAP, cappedCount, dwellBucket, fpsBucket, loadBucket, shareBucket, widthBucket } from './buckets.js';

describe('buckets', () => {
  test('dwell time, edges belong to the bucket above', () => {
    expect([0, 4.999, 5, 29.9, 30, 119, 120, 599, 600, 99_999].map((value) => dwellBucket(value))).toEqual([
      '<5s',
      '<5s',
      '5-30s',
      '5-30s',
      '30s-2m',
      '30s-2m',
      '2-10m',
      '2-10m',
      '>10m',
      '>10m',
    ]);
  });

  test('load time', () => {
    expect([0.2, 1, 2.9, 3, 9.9, 10, 29, 30, 300].map((value) => loadBucket(value))).toEqual([
      '<1s',
      '1-3s',
      '1-3s',
      '3-10s',
      '3-10s',
      '10-30s',
      '10-30s',
      '>30s',
      '>30s',
    ]);
  });

  test('frame rate', () => {
    expect([5, 19.9, 20, 29.9, 30, 49.9, 50, 144].map((value) => fpsBucket(value))).toEqual([
      '<20',
      '<20',
      '20-30',
      '20-30',
      '30-50',
      '30-50',
      '>50',
      '>50',
    ]);
  });

  test('player width', () => {
    expect([320, 479, 480, 1023, 1024, 1599, 1600, 3840].map((value) => widthBucket(value))).toEqual([
      '<480',
      '<480',
      '480-1024',
      '480-1024',
      '1024-1600',
      '1024-1600',
      '>1600',
      '>1600',
    ]);
  });

  test('a share is a whole tenth, in percent', () => {
    expect([0, 0.04, 0.05, 0.349, 0.95, 1, 1.2, -1, Number.NaN].map((value) => shareBucket(value))).toEqual([
      0, 0, 10, 30, 100, 100, 100, 0, 0,
    ]);
  });

  test('a count is a whole number capped at the counter cap', () => {
    expect([0, 1, 49, COUNTER_CAP, 51, 10_000, -3, 2.7].map((value) => cappedCount(value))).toEqual([
      0,
      1,
      49,
      COUNTER_CAP,
      COUNTER_CAP,
      COUNTER_CAP,
      0,
      2,
    ]);
  });
});

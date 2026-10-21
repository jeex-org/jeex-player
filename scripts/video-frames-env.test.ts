import { describe, expect, test } from 'bun:test';
import { DEFAULT_FRAME_COUNT, readFramesEnv } from './video-frames-env.js';

describe('readFramesEnv', () => {
  test('an empty environment is the smoke check: 12 frames of 9:16 and 16:9 at 24 fps', () => {
    expect(readFramesEnv({})).toEqual({
      fps: 24,
      height: 320,
      from: 0,
      to: (DEFAULT_FRAME_COUNT - 1) / 24,
      aspects: ['9:16', '16:9'],
      out: '/tmp/jeex-video-frames',
    });
  });

  test('every variable is read, and FRAMES_TO defaults off FRAMES_FROM and FRAMES_FPS', () => {
    const env = { FRAMES_FPS: '30', FRAMES_HEIGHT: '720', FRAMES_FROM: '1.5', FRAMES_ASPECTS: ' 1:1 , 16:9', FRAMES_OUT: 'out' };
    expect(readFramesEnv(env)).toEqual({ fps: 30, height: 720, from: 1.5, to: 1.5 + 11 / 30, aspects: ['1:1', '16:9'], out: 'out' });
    expect(readFramesEnv({ FRAMES_TO: '2' }).to).toBe(2);
  });

  test.each([
    ['FRAMES_FPS', '60'],
    ['FRAMES_FPS', 'fast'],
    ['FRAMES_HEIGHT', '0'],
    ['FRAMES_HEIGHT', 'abc'],
    ['FRAMES_FROM', '-1'],
    ['FRAMES_TO', 'later'],
    ['FRAMES_ASPECTS', '4:3'],
    ['FRAMES_OUT', ''],
  ])('%s=%j fails naming the variable', (name, value) => {
    expect(() => readFramesEnv({ [name]: value })).toThrow(`video-frames: bad environment | ${name}`);
  });
});

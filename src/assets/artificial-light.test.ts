import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { ARTIFICIAL_LIGHT_KEY, artificialColour, tagArtificialLight } from './artificial-light.js';

function tagged(colour: unknown): THREE.Object3D {
  const object = new THREE.PointLight();
  object.userData[ARTIFICIAL_LIGHT_KEY] = { colour };
  return object;
}

describe('artificialColour', () => {
  test('answers the colour a tagged light was built with', () => {
    const light = tagArtificialLight(new THREE.PointLight(0xff8800));
    expect(artificialColour(light)).toEqual([light.color.r, light.color.g, light.color.b]);
  });

  test('refuses a colour whose elements are not three finite numbers', () => {
    for (const colour of [['1', 1, 1], [1, Number.NaN, 1], [1, 1, Number.POSITIVE_INFINITY], [1, null, 1], [1, 1], 'white']) {
      expect(artificialColour(tagged(colour))).toBeNull();
    }
  });
});

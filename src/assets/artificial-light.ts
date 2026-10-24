/**
 * The tag that marks a light as the interior's ARTIFICIAL light (a lamp,
 * a pendant, a ceiling light, the walk's ambient floor), as opposed to the
 * daylight of the lighting rig: `userData.artificialLight = { colour }`, the
 * light's colour as it was built, linear RGB in the working colour space.
 *
 * A colour temperature (`render/light-temperature.ts`) tints only tagged
 * lights, and «Original» puts this colour back exactly. It is part of the
 * asset contract: a builder that adds a light to its group tags it here.
 */

import type * as THREE from 'three';

/** The `userData` key of the tag. */
export const ARTIFICIAL_LIGHT_KEY = 'artificialLight';

/** What the tag holds: the light's own colour, linear RGB. */
export type ArtificialLightTag = { readonly colour: readonly [number, number, number] };

/** Tags `light` with its current colour; answers the light. */
export function tagArtificialLight<T extends THREE.Light>(light: T): T {
  const tag: ArtificialLightTag = { colour: [light.color.r, light.color.g, light.color.b] };
  light.userData[ARTIFICIAL_LIGHT_KEY] = tag;
  return light;
}

/** Whether `object` is a light carrying the tag. */
export function isArtificialLight(object: THREE.Object3D): object is THREE.Light {
  return Boolean((object as Partial<THREE.Light>).isLight) && artificialColour(object) !== null;
}

/** The original colour a tagged object carries, or `null`. */
export function artificialColour(object: THREE.Object3D): readonly [number, number, number] | null {
  const tag = object.userData[ARTIFICIAL_LIGHT_KEY] as Partial<ArtificialLightTag> | undefined;
  const colour = tag?.colour;
  return Array.isArray(colour) && colour.length === 3 ? (colour as readonly [number, number, number]) : null;
}

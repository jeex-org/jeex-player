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

/** The `userData` key of the tag a light built from a variant's `lights` fact carries. */
export const LAMP_LIGHT_KEY = 'lampLight';

/**
 * What a fact light carries beside the artificial tag: where it came from
 * (`source: 'fact'`, never on a bank builder's bulb), its placement, its index
 * in the variant's `lights`, and the authored `lumens`, `cutoff` and `shadow`
 * hint, so the bake reads the fact rather than the live, tinted light.
 */
export type LampLightTag = {
  readonly source: 'fact';
  readonly placementId: string;
  readonly index: number;
  readonly lumens: number;
  readonly cutoff: number;
  readonly shadow: boolean;
};

/** The fact tag `object` carries, or `null` for any other object (a bank bulb included). */
export function lampLightTag(object: THREE.Object3D): LampLightTag | null {
  const tag = object.userData[LAMP_LIGHT_KEY] as Partial<LampLightTag> | undefined;
  return tag?.source === 'fact' ? (tag as LampLightTag) : null;
}

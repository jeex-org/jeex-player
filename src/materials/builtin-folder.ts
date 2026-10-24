/**
 * Where the bundled finishes' maps are: the `finish-maps/` folder next to
 * the running player file, found the way the Basis transcoder is
 * (`ktx2.ts`, `shared/own-url.ts`). There is no option to name another one.
 */

import { transcoderFolder } from './ktx2.js';
import { OWN_FILE_URL } from '../shared/own-url.js';
import { BUILTIN_FINISHES, type BuiltinBinding } from './builtin-library.js';

/** The `finish-maps/` folder next to the player file at `ownUrl`. */
export function builtinFolder(ownUrl: string = OWN_FILE_URL): string {
  return new URL('finish-maps/', transcoderFolder(ownUrl)).href;
}

/**
 * The picture a bundled finish's swatch shows: the smallest shipped albedo of
 * a natural scan; `undefined` for a tintable or parameters material, whose
 * colour map alone is not its look (the swatch is flat in its colour).
 */
export function builtinSwatchUrl(binding: BuiltinBinding, folder: string = builtinFolder()): string | undefined {
  const { material } = binding;
  if (material.kind !== 'scan' || material.facts.colourMode !== 'natural') return undefined;
  const files = material.maps.albedo?.files;
  const path = files?.['256'] ?? files?.['128'] ?? files?.['384'] ?? files?.['512'] ?? files?.['768'];
  return path === undefined ? undefined : new URL(path, folder).href;
}

/**
 * The swatch of a bundled finish bound to a library material: its shipped
 * picture when it has one; `null` for a finish that keeps its generated look.
 */
export function builtinSwatchFor(id: string): { readonly image?: string } | null {
  const binding = BUILTIN_FINISHES.get(id);
  if (binding === undefined) return null;
  const image = builtinSwatchUrl(binding);
  return image === undefined ? {} : { image };
}

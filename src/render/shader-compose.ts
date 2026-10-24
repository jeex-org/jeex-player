/**
 * The one way the player rewrites a material's shader: every rewrite (the
 * walk lighting, the baked-surface policy, a lightmap decode) is a transform
 * registered with an id and a version, and the composer owns the material's
 * `onBeforeCompile` and `customProgramCacheKey`.
 *
 * On every compile the composer
 * 1. runs a hook the material had before the composer (a host's own), first;
 * 2. expands the lighting chunks it owns (`OWNED_CHUNKS`) in place, each
 *    between two marker comments (`chunkMarker`), so every transform anchors
 *    on expanded text and on chunk boundaries; `lightmap_pars_fragment` is
 *    not owned and stays an include;
 * 3. applies the transforms in a fixed order: the walk lighting, the baked
 *    surface, then every other id in registration order, whichever was
 *    added first.
 *
 * The program key is `jeex|<the previous hook's key>|<id@version>...` in the
 * order of application: transforms that change shader text change their
 * version, and no uniform, mask or mode value ever enters the key, so
 * switching those never recompiles.
 *
 * Copies: `Material.clone` copies neither hook. A maker that copies the two
 * hooks by assignment gets functions that resolve the material they run on
 * (`this`): a material with no list of its own adopts a copy of the list of
 * the material the hooks were installed for, on first use, and the two then
 * diverge. A copy of a baked surface must still be marked baked again
 * (`render/baked-surface.ts`), since its draw hook is not copied. A copy of
 * a copy adopts the list of the material the hooks were installed for, never
 * the intermediate copy's. A wrapped or bound copy of a composer hook is not
 * supported: the composer cannot recognise it and would call itself.
 *
 * A missing anchor throws at compile rather than drawing a half-patched
 * shader: the anchors are pinned to the installed three, so a throw means a
 * foreign hook removed an owned include, which must be seen, not hidden.
 */

import * as THREE from 'three';
import { ViewerLibError } from '../shared/errors.js';

/** A shader transform: rewrites the program parameters three hands to `onBeforeCompile`. */
export type ShaderTransform = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/** The walk lighting's transform id (`render/walk-lighting/box-probe-patch.ts`): applied first. */
export const WALK_TRANSFORM_ID = 'jeex-walk-lighting';
/** The baked-surface policy's transform id (`render/baked-surface.ts`): applied second. */
export const BAKED_TRANSFORM_ID = 'jeex-baked-surface';

/** The lighting chunks the composer expands before any transform runs, in the order they occur. */
export const OWNED_CHUNKS = ['lights_physical_pars_fragment', 'lights_fragment_begin', 'lights_fragment_maps'] as const;
export type OwnedChunk = (typeof OWNED_CHUNKS)[number];

/** The comment line that opens or closes an expanded owned chunk. */
export function chunkMarker(chunk: OwnedChunk, edge: 'begin' | 'end'): string {
  return `// jeex:${chunk} ${edge}`;
}

/** `source` with every owned chunk's include expanded between its markers; a missing include is left alone. */
export function expandOwnedChunks(source: string): string {
  let text = source;
  for (const chunk of OWNED_CHUNKS) {
    const include = `#include <${chunk}>`;
    if (!text.includes(include)) continue;
    const body = (THREE.ShaderChunk as unknown as Record<string, string>)[chunk]!;
    text = text.replace(include, () => `${chunkMarker(chunk, 'begin')}\n${body}\n${chunkMarker(chunk, 'end')}`);
  }
  return text;
}

/** `text` with the first `anchor` replaced; throws, naming the transform, when the anchor is missing. */
export function replaceAnchor(text: string, anchor: string, replacement: string, transformId: string): string {
  const at = text.indexOf(anchor);
  if (at < 0) throw new ViewerLibError('internal', `shader transform ${transformId}: anchor not found: ${anchor}`);
  return text.slice(0, at) + replacement + text.slice(at + anchor.length);
}

type CompileHook = (this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;
type KeyHook = (this: THREE.Material) => string;
/** The two hooks as the function-valued properties they are (three declares them as methods). */
type Hooks = { onBeforeCompile: CompileHook; customProgramCacheKey: KeyHook };
const hooksOf = (material: THREE.Material): Hooks => material;
const DEFAULT_HOOKS = hooksOf(THREE.Material.prototype);

type Entry = { id: string; version: number; transform: ShaderTransform };
type Compose = {
  entries: Entry[];
  /** The hook the material had before the composer, or null for three's default. */
  foreign: CompileHook | null;
  /** The key part that hook contributes. */
  foreignKey: (material: THREE.Material) => string;
};

const COMPOSE = new WeakMap<THREE.Material, Compose>();
/** Which material each installed hook was installed for, so a copied hook finds the list to adopt. */
const OWNER = new WeakMap<object, THREE.Material>();

const rank = (id: string): number => (id === WALK_TRANSFORM_ID ? 0 : id === BAKED_TRANSFORM_ID ? 1 : 2);

/** The entries in the order of application; the sort is stable, so the others keep their registration order. */
const ordered = (entries: readonly Entry[]): Entry[] => [...entries].sort((a, b) => rank(a.id) - rank(b.id));

/** The state `material` would use, without adopting anything: its own, or that of its copied hook's owner. */
function peekState(material: THREE.Material): Compose | undefined {
  const own = COMPOSE.get(material);
  if (own) return own;
  const owner = OWNER.get(hooksOf(material).onBeforeCompile);
  return owner ? COMPOSE.get(owner) : undefined;
}

/** The composer state of `material`, adopted from the hook's owner when it carries a copied hook. */
function stateOf(material: THREE.Material): Compose | undefined {
  const own = COMPOSE.get(material);
  if (own) return own;
  const source = peekState(material);
  if (!source) return undefined;
  const adopted: Compose = { entries: [...source.entries], foreign: source.foreign, foreignKey: source.foreignKey };
  COMPOSE.set(material, adopted);
  return adopted;
}

function install(material: THREE.Material): Compose {
  const hooks = hooksOf(material);
  const previousHook = hooks.onBeforeCompile;
  const previousKey = hooks.customProgramCacheKey;
  const foreign = previousHook === DEFAULT_HOOKS.onBeforeCompile ? null : previousHook;
  const defaultKey = previousKey === DEFAULT_HOOKS.customProgramCacheKey;
  // three's default key returns the CURRENT hook's source, so it is captured before the wrap.
  const foreignText = foreign && defaultKey ? foreign.toString() : '';
  const state: Compose = {
    entries: [],
    foreign,
    foreignKey: defaultKey ? () => foreignText : (target) => previousKey.call(target),
  };
  COMPOSE.set(material, state);
  hooks.onBeforeCompile = function composedCompile(this: THREE.Material, shader, renderer) {
    const current = stateOf(this) ?? state;
    current.foreign?.call(this, shader, renderer);
    shader.fragmentShader = expandOwnedChunks(shader.fragmentShader);
    for (const entry of ordered(current.entries)) entry.transform(shader);
  };
  hooks.customProgramCacheKey = function composedKey(this: THREE.Material) {
    const current = stateOf(this) ?? state;
    return ['jeex', current.foreignKey(this), ...ordered(current.entries).map((entry) => `${entry.id}@${String(entry.version)}`)].join('|');
  };
  OWNER.set(hooks.onBeforeCompile, material);
  return state;
}

/**
 * Adds `transform` to `material`'s shader under `id@version`. The same id
 * and version again is a no-op; another version replaces that id's entry in
 * place. Marks the material for recompiling when anything changed.
 */
export function addShaderTransform(material: THREE.Material, id: string, version: number, transform: ShaderTransform): void {
  const state = stateOf(material) ?? install(material);
  const at = state.entries.findIndex((entry) => entry.id === id);
  if (at >= 0 && state.entries[at]!.version === version) return;
  const entry = { id, version, transform };
  if (at >= 0) state.entries[at] = entry;
  else state.entries.push(entry);
  material.needsUpdate = true;
}

/** Whether `material` carries the transform `id` (at `version`, when given). A pure read: a copy adopts nothing here. */
export function hasShaderTransform(material: THREE.Material, id: string, version?: number): boolean {
  const entry = peekState(material)?.entries.find((candidate) => candidate.id === id);
  return entry !== undefined && (version === undefined || entry.version === version);
}

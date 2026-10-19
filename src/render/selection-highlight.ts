/**
 * The highlight of the selected object: an emissive tint with an exact
 * restore of the original materials.
 *
 * Invariant, and the reason this is not three lines of `material.emissive.set`:
 * materials in this scene are SHARED between meshes (geometries and materials
 * are reused), so writing into one would light up every
 * wall that happens to be painted the same. A highlighted mesh therefore gets
 * a CLONE of its material for the duration, and clearing puts the original
 * reference back and disposes the clone. `Material.clone()` copies texture
 * REFERENCES and `Material.dispose()` never disposes a texture, so nothing
 * shared is released with it.
 *
 * Second invariant: this module decides nothing about WHAT is selected. It is
 * handed a `{ kind, id }` and matches it against `userData` — the same keys
 * `geometry/picker.ts` reads — so the highlight and the pick can never
 * disagree about what a wall is.
 *
 * `plan2d` renders nothing at all (`ui/plan-modes.ts` switches the renderer
 * off behind an opaque 2D overlay), so a tint is invisible there. The state is
 * still kept — a host reads it back and the 3D modes show it — but the drawing
 * itself carries no ids to highlight (`plan/plan-drawing.ts`'s `PlanPrimitive`),
 * so painting it is a separate feature, not a line of this file.
 */

import * as THREE from 'three';
import { GLOW_GROUP_NAME } from '../geometry/selection-glow.js';

/** What can be highlighted; `app/selection.ts` adds `'none'` for the event. */
export type HighlightKind = 'wall' | 'opening' | 'room' | 'furniture';

export type HighlightTarget = { readonly kind: HighlightKind; readonly id: string };

/** The tint, as an emissive colour. Cool blue: it reads on oak, plaster and fabric alike. */
export const HIGHLIGHT_COLOR = 0x4da3ff;
/** Emissive intensity at full strength. */
export const HIGHLIGHT_INTENSITY = 0.55;
/** How long the tint takes to arrive and to leave, ms (no popping). */
export const HIGHLIGHT_FADE_MS = 350;

/** A material that can carry an emissive tint at all. */
type Emissive = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };

function isEmissive(material: THREE.Material): material is Emissive {
  return 'emissive' in material && (material as { emissive?: unknown }).emissive instanceof THREE.Color;
}

/** Whether one object is part of `target`, by the same `userData` the picker reads. */
export function highlightMatches(object: THREE.Object3D, target: HighlightTarget): boolean {
  const data = object.userData;
  if (data['surface'] === undefined) return false;
  if (target.kind === 'wall') return data['surface'] === 'wall' && data['wallId'] === target.id;
  if (target.kind === 'opening') return data['surface'] === 'opening' && data['openingId'] === target.id;
  if (target.kind === 'room') return data['surface'] === 'floor' && data['roomId'] === target.id;
  return data['surface'] === 'furniture' && data['assetId'] === target.id;
}

/** One mesh under highlight: what was swapped in, and what has to come back. */
type Tinted = { mesh: THREE.Mesh; original: THREE.Material; clone: Emissive };

export class SelectionHighlight {
  private readonly root: () => THREE.Object3D | undefined;
  private current: HighlightTarget | null = null;
  private tinted: Tinted[] = [];
  /** Frame clock at the first `update` after a `set`; `-1` until then. Drives the fade. */
  private startedAt = -1;
  /** `1` while fading IN, `-1` while fading out; the fade is the only animation here. */
  private direction: 1 | -1 = 1;
  /** The tint now: `HIGHLIGHT_COLOR` unless a tool recoloured it (`setColour`). */
  private colour = HIGHLIGHT_COLOR;

  constructor(root: () => THREE.Object3D | undefined) {
    this.root = root;
  }

  get target(): HighlightTarget | null {
    return this.current;
  }

  get count(): number {
    return this.tinted.length;
  }

  /** Highlights `target`, or clears the highlight when it is `null`. */
  set(target: HighlightTarget | null): void {
    this.restore();
    this.current = target;
    this.startedAt = -1;
    this.direction = 1;
    if (!target) return;
    const root = this.root();
    if (!root) return;
    collect(root, target).forEach((mesh) => this.tint(mesh));
    if (this.tinted.length === 0) this.current = null;
  }

  /**
   * The document was rebuilt: put the same highlight on the NEW meshes, or
   * drop it in silence when the target is not in the scene any more.
   */
  reapply(): void {
    const target = this.current;
    // The old meshes went with the old root; restoring their materials would
    // write into objects nothing is drawing.
    this.tinted = [];
    this.set(target);
  }

  /** Advances the fade. `now` is the frame clock (`render-runtime.ts`'s hook). */
  update(now: number): void {
    if (this.tinted.length === 0) return;
    if (this.startedAt < 0) this.startedAt = now;
    const t = Math.min(1, Math.max(0, (now - this.startedAt) / HIGHLIGHT_FADE_MS));
    const eased = this.direction === 1 ? t * t * (3 - 2 * t) : 1 - t * t * (3 - 2 * t);
    for (const entry of this.tinted) entry.clone.emissiveIntensity = HIGHLIGHT_INTENSITY * eased;
  }

  /**
   * Recolours the tint, `null` back to `HIGHLIGHT_COLOR`: the asset move tool
   * turns the selected object green or red while it is dragged, on the same
   * clones, so nothing is cloned twice.
   */
  setColour(colour: number | null): void {
    this.colour = colour ?? HIGHLIGHT_COLOR;
    for (const entry of this.tinted) entry.clone.emissive.setHex(this.colour);
  }

  dispose(): void {
    this.restore();
    this.current = null;
  }

  private tint(mesh: THREE.Mesh): void {
    const material = mesh.material;
    // An array material (a multi-face wall prism) would need one clone per
    // slot and a per-slot restore; no highlight target in this scene has one,
    // so it is left alone rather than half-handled.
    if (Array.isArray(material) || !isEmissive(material)) return;
    const clone = material.clone();
    clone.emissive = new THREE.Color(this.colour);
    clone.emissiveIntensity = 0;
    mesh.material = clone;
    this.tinted.push({ mesh, original: material, clone });
  }

  private restore(): void {
    for (const entry of this.tinted.splice(0)) {
      entry.mesh.material = entry.original;
      entry.clone.dispose();
    }
  }
}

/** Every mesh of `root` that belongs to `target`, auras excluded. */
function collect(root: THREE.Object3D, target: HighlightTarget): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  const walk = (object: THREE.Object3D): void => {
    // The aura meshes live under the object they highlight but are not part of
    // it; swapping their material would replace the glow shader
    // (`geometry/picker.ts` skips the same subtree for the same reason).
    if (object.name === GLOW_GROUP_NAME) return;
    if (object instanceof THREE.Mesh && highlightMatches(object, target)) found.push(object);
    for (const child of object.children) walk(child);
  };
  walk(root);
  return found;
}

/**
 * One room surface dressed with a library material: the material the meshes
 * wear from the first frame on, and the maps it asks the document's texture
 * source for afterwards.
 *
 * The surface is the OWNER its views are acquired under, so releasing it
 * gives back exactly what it took and never an image another surface still
 * draws. A completion that lands after the surface was released is not
 * attached (the source answers `null` for it).
 */

import type * as THREE from 'three';
import { attachLibraryMaps, createLibraryMaterial, libraryMapFormat, type LibraryThreeMaterial } from '../materials/library-material.js';
import { applyLibraryTransform, libraryAngle, libraryTextureMatrix } from '../materials/library-uv.js';
import type { LibraryDraw } from '../materials/room-finish.js';
import type { LibraryMapRole, LibraryMapSize } from '../materials/finish-types.js';
import type { TextureSource } from '../materials/texture-source.js';
import { textureSizeFor, type TextureDeviceClass } from '../materials/texture-size.js';
import type { FinishSurface, Vec2 } from '../scene/types.js';

/**
 * The document's texture source and the device class it draws sizes by;
 * `null` without a WebGL context. `attached` hears every surface whose maps
 * were just attached: the picture changed (walk and tour draw on demand).
 */
export type LibraryTextures = {
  readonly source: TextureSource;
  readonly device: TextureDeviceClass;
  readonly attached?: (() => void) | undefined;
};

/** The listed sizes of a material's maps (every map lists the same set). */
function listedSizes(draw: LibraryDraw): LibraryMapSize[] {
  const first = Object.values(draw.material.maps)[0];
  return first === undefined ? [] : (Object.keys(first.files) as LibraryMapSize[]);
}

export class LibrarySurface {
  readonly material: LibraryThreeMaterial;
  private readonly draw: LibraryDraw;
  private readonly surface: FinishSurface;
  private readonly outline: readonly Vec2[];
  private released = false;

  constructor(draw: LibraryDraw, surface: FinishSurface, outline: readonly Vec2[] = []) {
    this.draw = draw;
    this.surface = surface;
    this.outline = outline;
    this.material = createLibraryMaterial(draw);
  }

  /**
   * Asks `textures` for every map at the device's size and attaches what
   * arrives, all with one texture transform. A map that cannot be had leaves
   * the surface flat; nothing here throws.
   */
  async load(textures: LibraryTextures): Promise<void> {
    const { material: library } = this.draw;
    const size = textureSizeFor(textures.device, listedSizes(this.draw));
    if (size === null || library.facts.tileM === null) return;
    const roles = Object.keys(library.maps) as LibraryMapRole[];
    const views: { [role in LibraryMapRole]?: THREE.Texture } = {};
    await Promise.all(
      roles.map(async (role) => {
        const path = library.maps[role]?.files[size];
        if (path === undefined) return;
        const view = await textures.source.acquire({ versionId: library.versionId, role, size, path }, this);
        if (view !== null) views[role] = view;
      }),
    );
    if (this.released) return;
    attachLibraryMaps(this.material, this.draw, views);
    const angle = libraryAngle(library.facts, this.surface, this.outline, this.draw.rotation);
    applyLibraryTransform(this.material, libraryTextureMatrix(library.facts.tileM, angle, libraryMapFormat(library) === 'ktx2'));
    textures.attached?.();
  }

  /** Gives back every view this surface holds and frees its material; its maps are the source's, not freed here. */
  release(textures: LibraryTextures | null): void {
    this.released = true;
    textures?.source.release(this);
    this.material.dispose();
  }
}

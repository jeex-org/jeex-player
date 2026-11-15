/**
 * The light-probe grids of walk and tour: one per room box, baked by three's
 * `LightProbeGridWebGL`, and one fixed exterior block for everything outside
 * the rooms, all copied into one packed 3D atlas the walk patch samples
 * (`box-probe-patch.ts`, layout in `probe-layout.ts`).
 *
 * No grid is ever in the scene: three r187 lights every lit program with
 * every grid it finds there (one 3D sampler each), so a grid here is only a
 * baker. The patch picks the grid per fragment from the room box its lookup
 * point lies in, and the exterior block where it lies in none; whether the
 * grids light anything at all is one uniform (`jeexGridOn`), so showing them
 * never recompiles a program.
 *
 * The exterior block is never baked: it holds the apartment rig's hemisphere
 * and fill as spherical harmonics (`exterior-sh.ts`), written from the CPU.
 */

import * as THREE from 'three';
import { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';
import type { Box, RoomBox } from './room-volumes.js';
import { exteriorSH, packBlock, type ExteriorLights } from './exterior-sh.js';
import { gridAtlasLayout, type GridAtlasLayout } from './probe-layout.js';
import type { WalkUniforms } from './box-probe-patch.js';

/** Probes per side of the exterior block. */
export const EXTERIOR_SIZE = 2;

/** The grid of one room box, its cells over the box's grid volume (`room-volumes.ts`). */
export class RoomGrid extends LightProbeGridWebGL {
  readonly roomId: string;

  constructor(room: RoomBox) {
    const { grid, resolution } = room;
    super(grid.max.x - grid.min.x, grid.max.y - grid.min.y, grid.max.z - grid.min.z, resolution.x, resolution.y, resolution.z);
    this.roomId = room.roomId;
    this.name = `walk-grid-${room.roomId}`;
    this.position.set((grid.min.x + grid.max.x) / 2, (grid.min.y + grid.max.y) / 2, (grid.min.z + grid.max.z) / 2);
    this.updateBoundingBox();
    this.updateMatrixWorld(true);
  }

  /**
   * Bakes as three does, always as three's pass 0: the bounce comes from the
   * packed atlas the patch samples while the grids are on (`grid-bake.ts`),
   * never from three's own snapshot, which would cost a second atlas a grid.
   */
  override bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, options: Parameters<LightProbeGridWebGL['bake']>[2] = {}): void {
    super.bake(renderer, scene, { ...options, pass: 0 });
  }
}

/** The exterior block's data: what `HdriSky` swaps for a silent one while an HDRI lights the scene. */
export type ExteriorSlot = { texture: THREE.Data3DTexture | null };

/** The exterior block as a texture the atlas copies from the CPU. */
export function exteriorBlock(lights: ExteriorLights): THREE.Data3DTexture {
  const block = packBlock(exteriorSH(lights), EXTERIOR_SIZE);
  const texture = new THREE.Data3DTexture(block.data, block.width, block.height, block.depth);
  texture.type = THREE.FloatType;
  texture.format = THREE.RGBAFormat;
  texture.unpackAlignment = 1;
  return texture;
}

/**
 * The uniforms the patch locates each grid's block of `layout` by: one entry
 * per room box in `boxes`' order, the exterior block (the layout's last slot)
 * in the arrays' last entry.
 */
export function writeGridUniforms(
  uniforms: WalkUniforms,
  layout: GridAtlasLayout,
  boxes: readonly Pick<RoomBox, 'grid' | 'resolution'>[],
): void {
  const put = (i: number, box: Box, slot: { x: number; y: number }, resolution: { x: number; y: number; z: number }): void => {
    uniforms.jeexGridMin.value[i]!.set(box.min.x, box.min.y, box.min.z, slot.x);
    uniforms.jeexGridMax.value[i]!.set(box.max.x, box.max.y, box.max.z, slot.y);
    uniforms.jeexGridRes.value[i]!.set(resolution.x, resolution.y, resolution.z);
  };
  boxes.forEach((box, i) => put(i, box.grid, layout.slots[i]!, box.resolution));
  // The exterior's values are the same everywhere: any volume will do.
  const everywhere = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  const exterior = { x: EXTERIOR_SIZE, y: EXTERIOR_SIZE, z: EXTERIOR_SIZE };
  put(uniforms.jeexGridMin.value.length - 1, everywhere, layout.slots[boxes.length]!, exterior);
  uniforms.jeexGridSize.value.set(layout.width, layout.height, layout.depth);
}

const region = new THREE.Box3();
const at = new THREE.Vector3();

/** The packed atlas: every room grid's block and the exterior block, on the GPU. */
export class GridAtlas {
  readonly target: THREE.WebGL3DRenderTarget;
  readonly layout: GridAtlasLayout;
  /** The exterior block, behind a setter that writes it into the atlas. */
  readonly exterior: ExteriorSlot;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly grids: readonly RoomGrid[];
  /** The exterior block this atlas made (a silent one `HdriSky` swaps in is its own). */
  private readonly block: THREE.Data3DTexture;

  constructor(renderer: THREE.WebGLRenderer, grids: readonly RoomGrid[], lights: ExteriorLights) {
    this.renderer = renderer;
    this.grids = grids;
    const exterior = { x: EXTERIOR_SIZE, y: EXTERIOR_SIZE, z: EXTERIOR_SIZE };
    this.layout = gridAtlasLayout([...grids.map((grid) => grid.resolution), exterior]);
    const { width, height, depth } = this.layout;
    this.target = new THREE.WebGL3DRenderTarget(width, height, depth, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    this.target.texture.name = 'WalkLighting.gridAtlas';
    renderer.initRenderTarget(this.target);
    const write = (texture: THREE.Data3DTexture): void => this.writeExterior(texture);
    let current: THREE.Data3DTexture | null = null;
    this.exterior = {
      get texture() {
        return current;
      },
      set texture(texture) {
        current = texture;
        if (texture) write(texture);
      },
    };
    this.block = exteriorBlock(lights);
    this.exterior.texture = this.block;
  }

  /** Copies room grid `index`'s baked atlas into its block: each SH sub-volume, then its x and y borders. */
  copyGrid(index: number): void {
    const grid = this.grids[index]!;
    const source = grid.texture;
    if (!source) return;
    const { x: nx, y: ny, z: nz } = grid.resolution;
    const slot = this.layout.slots[index]!;
    const copy = (x0: number, x1: number, y0: number, y1: number, z0: number, dx: number, dy: number): void => {
      region.min.set(x0, y0, z0);
      region.max.set(x1, y1, z0 + nz + 2);
      this.renderer.copyTextureToTexture(source, this.target.texture, region, at.set(dx, dy, 0));
    };
    for (let t = 0; t < 7; t += 1) {
      const z0 = t * (nz + 2);
      const row = slot.y + t * (ny + 2);
      copy(0, nx, 0, ny, z0, slot.x + 1, row + 1);
      copy(0, 1, 0, ny, z0, slot.x, row + 1);
      copy(nx - 1, nx, 0, ny, z0, slot.x + nx + 1, row + 1);
      copy(0, nx, 0, 1, z0, slot.x + 1, row);
      copy(0, nx, ny - 1, ny, z0, slot.x + 1, row + ny + 1);
    }
  }

  /** Writes the uniforms the patch locates each grid's block by: one entry per room box, the exterior last. */
  setUniforms(uniforms: WalkUniforms, boxes: readonly RoomBox[]): void {
    writeGridUniforms(uniforms, this.layout, boxes);
    uniforms.jeexGrids.value = this.target.texture;
  }

  dispose(): void {
    this.target.dispose();
    this.block.dispose();
  }

  private writeExterior(texture: THREE.Data3DTexture): void {
    const slot = this.layout.slots[this.grids.length]!;
    this.renderer.copyTextureToTexture(texture, this.target.texture, null, at.set(slot.x, slot.y, 0));
  }
}

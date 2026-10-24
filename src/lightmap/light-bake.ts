/**
 * The light-bake sidecar (format 1) as types, and the live-lighting policy
 * the player implements for a baked surface. `light-bake.schema.ts` judges a
 * document against these shapes; a compile-time check in its test keeps the
 * two the same.
 *
 * Pure module: no `three`, no DOM.
 */

type Vec3 = readonly [number, number, number];

/**
 * The contributions a baked surface keeps live: the direct sun (the bake's
 * direct term leaves it out), specular reflections (the bake is diffuse
 * only), and the whole light of a live lamp (a lamp not listed in `lamps`,
 * which is in neither bake term).
 */
export const LIVE_KEPT = Object.freeze(['direct sun', 'specular', 'live-lamp light'] as const);
/**
 * The contributions the bake already carries, which a baked surface must not
 * add again: the diffuse of every baked lamp (listed in `lamps`; its
 * specular stays), the rig's fill light, the hemisphere, the ambient floor,
 * the probe grid's diffuse and the environment's diffuse.
 */
export const LIVE_DISABLED = Object.freeze([
  'baked-lamp diffuse',
  'fill',
  'hemisphere',
  'ambient',
  'probe-grid diffuse',
  'environment diffuse',
] as const);

/** What the player must do for the baked light to be right. */
export type LightBakeContract = {
  readonly uv: { readonly channel: 1; readonly mode: 'atlas' };
  readonly rows: 'top-down';
  readonly encoding: {
    readonly kind: 'rgbm';
    readonly range: number;
    readonly alpha: 'straight-m';
    readonly colour: 'linear-non-colour';
    readonly decode: 'rgb * m * range, before intensity';
  };
  readonly intensity: number;
  readonly mips: { readonly lodLimit: number; readonly webp: 'per-level files' };
  readonly upload: { readonly flipY: false; readonly premultiplyAlpha: false; readonly colorSpace: 'none' };
  readonly live: { readonly keep: readonly string[]; readonly disable: readonly string[] };
};

/** One atlas page and its level files, level 0 first. */
export type LightBakePage = {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  readonly ktx2?: string | undefined;
  readonly webp: readonly string[];
};

/** One lightmapped mesh, by entity id: its page and its chart rect in texels, top-down. */
export type LightBakeBinding = {
  readonly node: string;
  readonly page: number;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/** A judged sidecar. `baker`, `sky` and `calibration` are the bake's own record. */
export type LightBake = {
  readonly format: 1;
  readonly bakeId: string;
  readonly sceneId: string;
  readonly contentHash: string;
  readonly shellHash: string;
  /** The digest of the scene inputs the shell was built from (`shell-inputs.ts`); absent for a calibration room. */
  readonly shellInputsHash?: string | undefined;
  readonly baker?: Readonly<Record<string, unknown>> | undefined;
  /**
   * The sun the bake's direct term left out: the unit direction the light
   * travels (glTF frame, +Y up), its linear Rec.709 colour and its irradiance
   * in W/m² on a surface facing it.
   */
  readonly sun: { readonly direction: Vec3; readonly color: Vec3; readonly strength: number };
  readonly sky?: Readonly<Record<string, unknown>> | undefined;
  readonly calibration?: Readonly<Record<string, unknown>> | undefined;
  readonly pages: readonly LightBakePage[];
  readonly bindings: readonly LightBakeBinding[];
  /** The placement ids of the lamps whose light is in the bake. */
  readonly lamps: readonly { readonly id: string }[];
  readonly contract: LightBakeContract;
};

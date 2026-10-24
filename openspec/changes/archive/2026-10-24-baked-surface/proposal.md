# Proposal

## Why

A shell surface carrying a light bake is lit twice today: its lightmap holds the diffuse indirect light and the baked lamps, and the player's live lighting adds the same light again. The lightmap binding is landing in parallel and needs the lighting side of the seam so a baked apartment reads as baked, in every mode.

## What Changes

- A baked surface (a material marked by the lightmap binding) takes its diffuse indirect light only from its lightmap: the ambient light (the walk's ambient floor included), the hemisphere, light probes, the room grid, the environment's diffuse share and the fill light add nothing to it.
- A lamp marked baked adds no diffuse light to a baked surface; its specular highlight stays. Live and unmarked lamps light a baked surface as before. Every surface that is not baked is lit exactly as before.
- The direct sun, its shadows and every specular reflection (environment, room probes, clearcoat) stay on a baked surface.
- In walk and tour the lightmap's contribution inside rooms is scaled by the walk sun factor, so a baked room keeps its balance against the sun under the walk exposure; captures for grids and probes use the unscaled lightmap.
- Switching a lamp between baked and live, entering or leaving walk, and captures change no shader program.
- One shader composer: every rewrite of a material's shader (the walk lighting, the baked policy, the lightmap decode) is registered with an id and a version and applied in a fixed order over chunks expanded once; the walk lighting no longer owns the material's compile hook.

## Capabilities

### New Capabilities

- `baked-surface`: how a surface marked as baked and a lamp marked as baked are lit, how shader rewrites compose, and what stays constant across modes and toggles.

### Modified Capabilities

- `walk-room-lighting`: room grids no longer light baked surfaces, and baked surfaces follow the walk sun factor inside rooms.

## Impact

New modules in `src/render/` (the composer, the baked policy's shader rewrite, the light-order adapter pinned to three r186.1); `src/render/baked-surface.ts` gets real bodies behind the signatures the lightmap binding already calls; the walk patch (`src/render/walk-lighting/box-probe-patch.ts`) registers through the composer and becomes aware of baked surfaces. New component tests in a real WebGL context. The composer and the baked policy are in the boot bundle (they apply in the editing modes); the lazy walk chunk changes slightly. No new dependency, no public API change.

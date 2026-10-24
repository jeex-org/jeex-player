# Brainstorm

## Problem

A room whose shell carries an offline light bake reads far darker than the same room lit live, in the editing modes and in walk. Measured on the demo flat with its first full bake, at one living-room pose: the baked walls read about a fifth of the live walls in orbit, and the baked floor loses the warm cast it has live. The bake itself is correct (linear irradiance over π, warm floor, daylight factor of a few percent); the live look lights every face as if the room stood in the open (hemisphere, environment diffuse at 1.8 and the fill). Baked shells must read within 20 % of the live look of the same mode, by physical means only: a gain on the baked light, no fill terms on baked shells.

## Related work

- The baked-surface policy (lightmap as the only diffuse indirect light of a baked shell) and the debug light-bake hook, which loads a real bake onto the demo flat at a fixed camera pose; the metering here runs on that hook.
- Lamp lights in baked projects: lamps are live unless the bake names them, so a live lamp keeps lighting a baked wall.

## Doubts

- The lightmap on a baked surface is scaled in walk by the interior sun factor (1/3.5). Is that right for indirect light? It is not: the room grid, the indirect light of every surface that is not baked, is never scaled by it; only direct sun is. The factor exists because a sunlit floor clipped under the walk exposure, which concerns the direct sun alone.
- Is π applied once on the decode? The bake stores irradiance / π and names an intensity of π; three adds `lightMapTexel × lightMapIntensity` to the irradiance and the Lambert term divides by π once. One π, once.
- Is the floor's cold cast a colour error? On the baked floor in orbit the environment specular (the studio environment at 1.8) outweighs the lightmap's diffuse term several times, so the floor shows the neutral environment instead of its own warm colour; with the gain the diffuse term grows back over it. Measured, not assumed (design, «Evidence»).
- Does a gain clip window-near walls? Checked by metering clipped pixels on the pose.

## Approaches considered

1. (author) A per-mode gain on the lightmap only, as data in the lighting standard, applied by the baked policy: the editing gain matches the studio-lit look, the walk gain sits on top of the walk exposure. Live furniture is not brightened. Cost: two constants, one uniform.
2. (author) Bring back part of the environment diffuse on baked shells. Rejected: a fill term the bake already accounts for, light counted twice.
3. (author) Raise the renderer exposure in baked rooms. Rejected: it brightens live furniture and the sky with the shell.
4. (author) Change the bake's units (a larger range or intensity). Rejected: the units were checked and are honest; the gap is a look choice of the viewer, not an error in the data.

## Decision

Approach 1. The walk scale of the lightmap is removed (factor 1 in every mode: it is indirect light, like the grid); `LIGHTING_STANDARD.baked.exposure.editing` and `.walk` are gains on the lightmap of a baked surface, chosen by the mode: the editing gain in the editing modes, the walk gain in walk and tour and in the grid and probe captures of walk (a capture records what walk shows). Both values are set by metering the pose against the live look; they shrink once furniture takes baked light from per-room probes.

## Rejected

- A fill or hemisphere share on baked shells: light the bake already holds, counted twice.
- A higher renderer exposure in baked rooms: brightens live objects and the sky.
- A unit change in the bake: the units are consistent; the brightness gap is a look choice.
- Keeping the walk scale and raising the walk gain by 3.5 instead: the same numbers, but a gain that hides a wrong factor.

## Process

The decisions were set before this change (option «per-mode gain», the walk factor as a defect); this artifact records them in the repository's words. No partner round: the approach was fixed by measurement.

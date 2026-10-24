# Independent review

## Reviewer

Sol round: an independent agent that did not write the artifacts, reading them and the installed three r186.1 read-only; one round. Verdict of the round: go with changes. It confirmed the traversal and stable sort against `WebGLLights`, the indirect changes (irradiance cleared after the begin chunk, grid sample and hand-over off, `jeexDiffuseScale` bypassed, only the physical environment diffuse line guarded), the scale after the maps chunk, and that nested renders reset three's material and camera upload state so shared uniforms upload on return.

## Findings

1. design.md, spec «Shader rewrites compose»: `Material.clone()` copies `userData` but neither hook, and the copy protocol assigns only the two compile hooks, so a clone inherits the baked transform without the per-draw mask hook. Fixed: the copy protocol requires `markBakedSurface(clone)`; its idempotence checks the installed runtime state (mask hook, transform), not the copied flag; new requirement «Copies of a baked material» with a render test where the clone is the only baked material drawn (task 3.3).
2. spec «Context restore»: an immediate equality contradicts the restore lifecycle (PMREM and probe targets lose their contents; the environment is regenerated and walk re-bakes while showing the direct look). Fixed: immediate survival tested with a CPU-backed lightmap and direct lights only; walk equality required after the environment is regenerated and the walk bake has completed (tasks 3.3 and 4.2).
3. spec «No recompile on toggles», design Risk 3: the first walk installation and the grid bake legitimately compile. Fixed: requirement renamed «No recompile once warmed up»; warm-up allowed; after it the swap frame, mode switches and lamp classification and intensity toggles with unchanged light counts compile nothing; the program-count test is scoped to that state (task 4.2).
4. walk-room-lighting spec «Baked surfaces in walk and tour»: «treated as any surface outside the rooms» would bring back exterior-grid, environment and baked-lamp diffuse. Fixed: outside every room box the lightmap factor is 1, reflections come from the studio environment, the existing outside exposure compensation applies and the excluded diffuse sources stay excluded; new scenario.
5. tasks: no test independently protected environment and probe specular. Fixed: new requirement «Reflections on a baked surface» and float-readback tests for environment specular on a rough metal, room-probe specular and clearcoat, and the unscaled lightmap during a real grid capture (tasks 3.3 and 4.1).

Also folded in after the round: the lightmap binding's exact RGBM decode is the literal stand-in of the seam test (task 5.2), and its three constraints on our transforms are written into design Decision 2.4.

## Verdict

Ready for implementation: yes

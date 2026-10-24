# Design

## Context

Bank builders draw procedural bodies from `dims`; for the shipped bank the dims are the carcass, while an exporter that bakes a bank body into a GLB writes the overall bounding box as the project's dims and carries the `layout` facts over unchanged (floor-footprints). Any fact a bank object declares must therefore hold for its built body in both frames.

## Goals / Non-Goals

**Goals:** each defect proved by a test on the built body that fails before the fix; facts that are true in both frames; no change to the walk and lint rules.

**Non-Goals:** the exporter and the project render path (the glassless mirror and mustard screen seen in an exported project); per-variant layout facts; cutting the island's worktop for its sink; the cooker's shared screen finish.

## Decisions

- **Chair.** The rear post lathe has its origin at its foot; it is placed at `y = 0` and scaled to the declared height, so the post is also the back leg. The back slat and rail are placed on the post's lean at their own height (`z = footZ - sin(lean) * y`), so they stay on the posts. Alternative (shorter post profile starting at the seat) rejected: the profile already models the seat joint at 0.42 of its height, i.e. it was drawn as a full rear leg.
- **Blocking heights by carcass.** Island 0.94, vanity 0.88, bath 0.58, one value per archetype as the facts format allows; the compact bath's 0.56 m rim is within 2 cm of it. The mixer tap's meshes are named `tap` and the carcass parts are named (`island-worktop`, `vanity-top`, `bath-shell`) so a test reads the values off the geometry. No footprint fraction: the walk rule multiplies the dims by it, which would shrink the bank's own carcass-sized obstacles, and a single scalar cannot describe an off-centre carcass inside an exported box.
- **Exact crown fit.** `fitCrown` measures the crown with vertex-exact bounds. The default `Box3` takes each blade's local bounding box through its lean and scale and overstated the crown's top by up to 9 cm, so crowns were scaled short. The plant test's box check uses exact bounds too.
- **TV.** The dims follow the built height; the `screen` option stays the panel size. A new finish `screen_tv` (near-black, roughness 0.05, clear coat, no emission) is added with a fresh UUID v7 written once into the finish id table; the shared `screen_dark` stays as it is because the cooker wears it on caps and grates. The bezel uses the screen slot, the stand the `leg` slot.
- **Vessel basin.** The builder's comment and its double-sided finish describe an open vessel; the capped cylinder is replaced by the open one, the stone top being its floor.

## Risks / Trade-offs

- [Canvas baselines move where chairs, the TV, plants or the vanity are visible] → re-shot in the gate environment, each one inspected; chrome baselines must not move.
- [The island's blocking height rises from 0.92 to 0.94] → no rule threshold lies between them (walk 0.15 m, window 1.2 m); the pinned value is updated with the reason.
- [Plants grow by up to 9 cm, crowns a little wider] → the existing box, slim and pot tests still hold on every variant.

## Open Questions

None.

# Design

## Context

1. `src/assets/project-manifest.schema.ts` (`zod/mini`, judges and never transforms): `variantSchema`, `objectSchema`, `hexSchema` (declared after the variant schema today, so it moves up), `projectManifestSchema` with `formatVersion: z.literal(2)`. `ProjectVariant` (`project-manifest.ts`) is derived from `CatalogueVariant` (`asset-types.ts`).
2. `resolveAsset` (`asset-resolver.ts`) builds `ResolvedAsset`; for a ceiling anchor `dims[1]` is the hanging drop, clamped to the room.
3. `AssetLoader.load` (`src/geometry/asset-loader.ts`): a builder body, or for a project object the `dims` stand-in (`pendingBody`, a box from y = 0 up, centred in x/z); `upgrade` fetches and dresses the GLB (`gltf-body.ts`, pivot at the floor-footprint centre, `min.y = 0`). The group sits at `mountY`, the ceiling plane for a ceiling anchor.
4. `SceneBuilder.upgradeOne` detaches every child but the selection aura, mirrors the GLB body and adds it.
5. `tagArtificialLight` / `artificialColour` (`src/assets/artificial-light.ts`): the light temperature tints tagged lights and «Original» restores the tagged colour.
6. The lighting entry `src/lighting/index.ts` (no three at runtime, export list pinned by its test), the standard `lighting-standard.ts`.

## Decisions

### 1. Schema

`lampLightSchema`: a `z.discriminatedUnion('kind', [...])` with one strict member `{ kind: 'point', position: [n, n, n], colour: hexSchema, lumens: (0, LAMP_MAX_LUMENS], cutoff: (0, LAMP_MAX_CUTOFF], shadow?: boolean }`; `variantSchema.lights: z.optional(z.array(lampLightSchema).check(z.minLength(1), z.maxLength(LAMP_MAX_LIGHTS)))`. `LAMP_MAX_LUMENS = 10_000`, `LAMP_MAX_CUTOFF = 15`, `LAMP_MAX_LIGHTS = 4`, and the light schema are exported for consumers that mirror the format. `z.number()` already refuses NaN and ±Infinity. Types `LampLight` / `PointLampLight` in `asset-types.ts`; `CatalogueVariant` gains `readonly lights?: readonly LampLight[]` (the bank never sets it).

### 2. Units

`lampCandela(lumens) = lumens / (4π) × LIGHTING_STANDARD.lamp.exposure`; `blenderPower(candela) = 4π × candela`. `LIGHTING_STANDARD.lamp = { exposure: (1.2 × 4π) / 400 }` (about 0.0377): 400 lm = 1.2 cd, the bank table lamp. It moves with any exposure or tone-mapping change. `blenderPower` is unconfirmed until the calibration room's lamp landmark and unused by this change; it lives here so the bake and the player share one conversion. Bank values in lumens: table lamp 400, pendant 600, ceiling light about 867, floor lamp about 1133.

### 3. Resolver and loader

1. `resolveAsset` copies `variant.lights` into `ResolvedAsset.lights` (absent without).
2. `AssetLoader.load`, stand-in branch only: one `tagArtificialLight(new THREE.PointLight(colour, lampCandela(lumens), cutoff, 2))` per entry, `castShadow = false`, at the authored position, named `${placementId}-light` / `-light-<n>`, `userData.lampLight = { source: 'fact', placementId, index, lumens, cutoff, shadow }`. They are children of the stand-in body, never of the placement group (`upgradeOne` removes group children, and the mirror reflects them as bodies).
3. The position is in the model frame shared by the stand-in and the GLB; placement scale and mirror come from the body and group matrices, so the position scales and the distance and intensity do not.

### 4. Ceiling hanging, upgrade and swap

1. A non-builder body on a ceiling anchor gets `body.position.y = -top`: `top` = `dims[1]` for the stand-in, the GLB's measured bounding-box `max.y` in `upgrade`. Builder bodies are untouched. Lights, children of the body, follow. Walk obstacles, plan facts and the layout lint read the catalogue facts and `mount`, never the drawn origin; a test pins that the drawn box now matches the lint's `y - height .. y`.
2. `upgradeOne` collects the fact lights under the bodies about to be replaced and adds them to the GLB body with `add` (not `attach`), so each keeps its local position and sits at the GLB's bulb; `replaced` stays the list of bodies.
3. A variant swap rebuilds through `load`, so it builds the new variant's lights; the mount applies the current temperature to the swapped group. A moved light keeps its tint and its bake mark.

### 5. Collect

`collectLampLights(root)` updates world matrices, traverses, keeps lights with `userData.lampLight.source === 'fact'`, and returns `CollectedLampLight { placementId, index, position (world), colour (the tag's linear colour), lumens, intensity: lampCandela(lumens), decay: 2, cutoff, shadow }`, in traversal order then `index`. No DOM, no renderer.

## Risks / Trade-offs

1. A light-count change recompiles materials once: one hitch on placing or swapping a lamp.
2. Lamp light reaches through walls up to its cutoff, as the bank lamps do; «lamp scope» follows.
3. Lumens are nominal: they mean something only against `lamp.exposure`.
4. Under a ceiling lower than 2.73 m the ceiling stand-in is shortened to the clamped drop and the GLB is not; the light follows the GLB.

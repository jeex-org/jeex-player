# Design

## Context

See `proposal.md` for the motivation; the specs carry the requirements. The state of the code this design starts from:

- The manifest schema (`assets/project-manifest.schema.ts`) is a `zod/mini` judge that never transforms; a project material is `pbr` or `generator`, and `pbr` is drawn flat (`materials/finish-generators.ts`). The public material types live in `materials/finish-types.ts` because `materials` sits below `assets` in the layer order.
- Scene finishes are strings everywhere (`scene/types.ts` `SceneFinishes`, `RoomFinishes`, `FaceFinish`); `SCHEMA_VERSIONS` is `['2.2']`. `set_material` infers floor or wall from the finish (`scene/scene-ops.ts` `applySetMaterial`), and registries reduce a project material to one family, floor winning (`scene/registries.ts` `finishFamilyOf`).
- The shell has one shared ceiling material (bundled white plaster) and one shared trim material with a fixed colour (`geometry/shell-builder.ts`); baseboards are merged `BoxGeometry` with normalised box UVs, and wall reveals reuse the front-plane UV (`geometry/builder-uv.ts`). Walls, floors and ceilings already carry metre UVs.
- Shell repaint disposes `material.map` unconditionally (`geometry/shell-paint.ts` `paintWall`).
- Context restore calls `mount(model)` without the document's options, variants or source key (`app/context-recovery.ts`), so a restored project loses its model resolver, materials and catalogue (`app/scene-mount.ts` defaults `options` to `{}`).
- The capped streaming read that refuses oversized GLBs is private to `geometry/model-source.ts`. The GPU class is computed in `telemetry/device.ts`, a layer above `materials` and `geometry`.
- The ops bundle budget is tight (`scripts/budget-check.ts`), and both scene operations and the scene schema ship in it.

## Goals / Non-Goals

**Goals:** a library-material path beside the legacy renderer that serves every room surface; explicit surface routing for paints; flat-first, bounded, cached texture loading that survives repaint, document change, disposal and context loss.

**Non-Goals (design level):** no change to how GLB furniture materials load; no texture streaming of higher sizes after a lower one (one size per device class per document); no worker decode; no change to the legacy `Finish` conversion; no per-colour swatch rows for tintable materials.

## Decisions

### 1. Manifest: one more union member, cross-field rules as checks

`library` becomes a third strict member of the material union, with its own strict sub-objects and enums. Cross-field rules (colour map by colour mode, `arm` versus `roughness`/`ao`, colour space by role, `convention` only on `normal`, same size set per material, `tileM` null exactly for parameters, `averageColour` equal to `baseColour`, path shape `tex/<versionId>/<role>.<px>.webp` with the material's own version, role and size) are `z.refine` checks on the member, each with its own issue path and message. Manifest-wide rules (no duplicate texture path, at most `MAX_PROJECT_TEXTURE_FILES` listed files) are checks on the root schema next to the existing `library.id === projectId` check. Nothing transforms, so `parseProjectManifest(value) === value` still holds. The public types (`LibraryMaterial`, `LibraryFacts`, map roles) are declared in `materials/finish-types.ts` and re-exported from `assets/project-manifest.ts`; the compile-time agreement test between type and schema covers the new member. The hex test is one shared `#rrggbb` refinement used by the manifest and the scene schema.

Alternative: a separate validation pass after the shape parse. Rejected: two places to read for one rule, and the existing refusal shape (`project-invalid` with paths) comes free from the schema.

### 2. Scene: `FinishRef` and surface support

`FinishRef = string | { material, colour?, rotation? }` is declared in `scene/types.ts` and used by `RoomFinishes.floor/walls/ceiling/trim`, `SceneFinishes.facade` and `FaceFinish.finish`. `SCHEMA_VERSIONS` becomes `['2.2', '2.3']`; the writer version is the last. The Zod schema accepts the union in every place. Because the runtime `validateScene` does not run the Zod schema, the finish shape check (strict keys, `#rrggbb`, finite rotation, at least one modifier) is one pure function called by the runtime validator at every finish location and by the explicit `set_material` applier. The validator also adds a version gate (a `2.2` document using an object, `ceiling` or `trim` is refused, naming `2.3`).

Registries replace the single family with surface support: `finishSurfaces(id): ReadonlySet<Surface>` where `Surface = 'floor' | 'wall' | 'ceiling' | 'trim' | 'facade'`. A project material's set is the surface words in its `apply`; bundled floor finishes give `{floor}`, bundled wall finishes `{wall, facade, ceiling, trim}`. `isLibraryMaterial(id)` answers whether an id is a project material of the `library` member: only those may take the object form and modifiers, while `pbr`, `generator` and bundled finishes stay bare UUIDs drawn by the legacy path, which has no per-finish colour or rotation. A modifier-free object is refused, so each finish has one spelling and capture and replay are exact. The legacy compatibility (a project `wall` material also dresses the facade) is applied only where a bare UUID is judged, so the explicit operation checks `apply` strictly as decided. `finishKind` stays for the legacy operation branch only, derived from the same table (floor first, as today). Interior presets branch by operation form: coverage and the appended reset read `surface` (and `room`/`face`) from an explicit operation and infer through `finishKind` only for a legacy one; captured object finishes are replayed through the explicit form, which writes exactly the bare-or-object spelling captured.

One helper `finishMaterialOf(ref)` returns the material UUID of either form; validation, registries lookups, selection and resolution go through it. `finish-remap.ts` and the preset capture move from `string` to `FinishRef`, carried by reference (the value is immutable data), so equality is deep and nothing is rebuilt.

Alternative: normalise bare UUIDs to objects on load. Rejected: the viewer never rewrites documents.

### 3. `set_material`: two branches by key

The applier branches on the presence of `surface` (explicit) or `target` (legacy); both present is an error. The explicit branch validates addressing (the table in the `scene-finishes` spec), checks `finishSurfaces(material).has(surface)` with the strict `apply` rule, refuses `colour`/`rotation` unless the material is of the `library` member, runs the shared finish shape check, refuses writing an object, `ceiling` or `trim` into a `2.2` document, writes the bare UUID when there is no `colour` and no `rotation`, and reuses the existing face-override clearing. New touched kinds `ceiling` and `trim` (per room) join the touched vocabulary so repaint dispatch can address them. The legacy branch is today's code with `finishKind` from the new table.

### 4. Resolver: legacy `Finish` or library material

A renderer-side resolver takes a `FinishRef` and a surface and returns either the legacy `Finish` (bundled, generator, flat `pbr`) through today's path, or a `LibraryDraw` = `{ material: LibraryMaterial, colour?, rotation }`. Shell building and shell paint ask the resolver for every surface; only `LibraryDraw` results go to the new factory. Per-room ceiling and trim materials are created lazily: a room without a ceiling or trim finish keeps sharing the default material, so a legacy scene creates no extra materials.

### 5. Material factory: flat first

`createLibraryMaterial(draw, surface, textures)` builds a `MeshStandardMaterial`, or `MeshPhysicalMaterial` when any of `sheen`, `sheenColour`, `clearcoat`, `clearcoatRoughness`, `transmission`, `ior`, `thicknessM`, `attenuationDistanceM` or `attenuationColour` is present (three.js honours a configurable IOR only on the physical material). Colour is parsed through three's sRGB-aware `Color` and multiplied in linear space. The first colour is `averageColour` (natural, parameters natural) or `linear(averageColour) × linear(tint)` (tintable scan), or the tint itself (tintable parameters). When the colour map is attached the colour becomes the tint factor or white, times `pbr.baseColour` for a scan that has it, and `needsUpdate` is set whenever map presence changes. Defaults (metalness 0, roughness 1, opaque, `alphaTest` 0.5 for mask, normal scale `normalStrength` or 1) are applied here, never in the manifest.

### 6. Texture source: document-owned, cached, reference counted

A `TextureSource` lives in `materials/` and is created per mounted document by the app layer, which injects: the URL resolver (manifest folder, or the host's `resolveTexture`), the size choice (from the GPU class computed in `telemetry/device.ts`, passed in as a value so `materials` does not import upward), the renderer's maximum anisotropy, and the logger.

- **Fetch** goes through a capped streaming reader moved from `geometry/model-source.ts` to `shared/` so both models and textures use it; it counts bytes without trusting `Content-Length` and aborts above `MAX_TEXTURE_FILE_BYTES`. A document counter adds every byte read; when it reaches `MAX_PROJECT_TEXTURE_BYTES` the source aborts active fetches through one `AbortController`, empties its queue and refuses new work. Concurrency is bounded (a small constant in `shared/limits.ts`), queued after the first frame as model upgrades are. Each job has one deadline, `TEXTURE_FETCH_DEADLINE_MS` (30 000 ms, `shared/limits.ts`), started before the resolver is called and covering resolution and the whole response read; a resolver promise cannot be cancelled, so on expiry the job stops awaiting it, aborts its fetch through its own signal, frees its slot, leaves the surface flat and logs a warning. A late resolver result is ignored.
- **Decode** is `createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`; the bitmap's width and height must equal the named size.
- **Cache** keys are `versionId|role|size`; an entry is pending (a shared promise) or decoded (one three `Source` plus the kept encoded bytes). Material views are `Texture` objects over the shared `Source`, each with its own repeat/rotation-free sampler state (UV transforms live in the geometry-independent texture matrix, see 7), so many surfaces share one upload.
- **Ownership**: `acquire(key, owner)` and `release(owner)`. A material's textures are released when the material is disposed or repainted; the bitmap is closed and the GPU texture disposed after the last owner. The encoded bytes stay for the document's lifetime so a context restore rebuilds without fetching; they count once against the budget already paid.
- **Guards**: every async continuation checks that its owner still holds the key it was started for; a stale result is released, never applied.
- **Sampling**: `RepeatWrapping`, `generateMipmaps`, `LinearMipmapLinearFilter`, `LinearFilter`, `anisotropy = min(8, max)`; colour maps `SRGBColorSpace`, the others `NoColorSpace`; one ARM view assigned to `aoMap`, `roughnessMap` and `metalnessMap`; AO on channel 0.

Alternative: reuse `materials/texture-cache.ts`. Rejected as the owner of these textures (it caches generated canvases by key without byte accounting or bytes kept), but its capability pattern (anisotropy from the renderer) is reused.

### 7. UVs: metres in geometry, tile and rotation in the texture transform

Geometry carries metre UVs on every room surface. Two gaps are filled in the builders: baseboards build metre UVs (along the face `t`, height `y`, and depth on the top and ends) instead of `BoxGeometry`'s normalised ones, and reveal strips get their own vertices with metre UVs along their depth, instead of sharing the front-plane corners. The per-material transform is one `Matrix3` on each texture view: rotate by `grainAngle + rotation` (degrees to radians, counter-clockwise), then scale by `1 / tileM[u]`, `1 / tileM[v]`; the same matrix is set on every map of the material (`matrixAutoUpdate = false`). The floor grain angle is the direction of the room outline's longest edge (ties broken by the lower edge index), applied for `along_u` and `along_v` (the latter adding 90°); walls, ceilings, facades and trim use 0. Because tint and rotation live on the material and its texture views, two surfaces with different rotations share one image.

### 8. Live texture resolver option

`ViewerOptions.resolveTexture?: (path: string) => string | Promise<string>`, a host object like `onLog` and `scene.repository`: not in `OPTION_SCHEMA`, no attribute or query spelling, copied verbatim, excluded from the published viewer options JSON schema. It is called with the logical relative path at fetch time for each size actually loaded, so signed URLs stay fresh; its result must be an absolute `http(s)` URL or a `blob:` URL (a host previewing local or unsaved maps), otherwise the surface stays flat with a warning. The name is final.

### 9. Context restore remounts the document

`SceneMount` keeps the last mount's `options`, `variants` and `sourceKey` with the model, and `contextRecovery` calls a new `remount()` that replays them. The texture source survives the remount for the same document key and re-uploads from kept bytes; GPU objects of the lost context are discarded, not disposed twice.

### 10. Selection options from the registry view

`finishCore` takes the project library's materials (through the same registries view the validator uses) and lists those whose `apply` has the picked surface word before the bundled list. Options for library materials use the explicit operation, and each narrow or broad action is offered only when the material's `apply` holds the surface that action paints (a facade-only material gets no every-room walls footer); `finishCurrentOf` returns the material UUID through `finishMaterialOf`. Chips for library materials are flat colours or the manifest `preview`; no canvas generator runs for them.

## Risks / Trade-offs

- [Ops bundle over budget: the explicit branch, the version gate and the finish union all ship in the ops entry] → keep them in pure modules without three, measure with `check:budget:lib` per file in the manifest-and-schema group, and raise the ops budget only with the measured figure and the reason recorded beside it.
- [Another change adds schema `2.3` first] → tasks start by rebasing; if `2.3` exists, the fields join it and the version gate lists both changes' fields.
- [The device class is a capability class, not memory] → three 768² RGBA maps with mipmaps are about 9 MiB of GPU memory per material; the document byte budget bounds the count of distinct images.
- [Subtle material errors pass the existing canvas baselines (35 % tolerance, skipped in CI)] → dedicated deterministic browser fixtures read pixel values for tint, tile scale, grain, normal direction and ARM; legacy baselines stay untouched.
- [Kept encoded bytes cost memory] → bounded by the 48 MiB document budget and released with the document.
- [A host resolver that is slow or hangs] → the per-job deadline covers resolution and reading, frees the concurrency slot and leaves the surface flat (model fetches have no such timeout; this one is new).
- [Bare UUID compatibility rule differs from the explicit form's strict rule] → both live in one registries table with one test matrix, and only the bare form carries the `wall → facade` allowance.

## Migration Plan

No data migration: `2.2` documents and manifests without `library` members read and draw as before. Producers write `2.3` when they use the new fields. Rollback is reverting the delivery; documents written as `2.3` would then be refused by the older viewer, which is the designed outcome of a version gate.

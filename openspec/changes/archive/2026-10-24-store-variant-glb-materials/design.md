# Design

## Context

A placed object is drawn in one of two ways. A shipped archetype has a procedural builder, which dresses its parts with the finishes the resolver merged (`asset-resolver.ts` `mergeFinishes`). A project object has no builder by format (`ProjectObject` requires `model` and refuses `builder`): it shows a `dims` stand-in on the first frame and its GLB replaces it (`asset-loader.ts` `upgrade`). Before this change `upgrade` passed `asset.baked` to `prepareGltfBody` (`gltf-body.ts`), which swaps every slot-named glTF material for the merged finish unless `baked` is set, and `isBakedVariant` set it only when no finish was declared anywhere. Library exports declare `defaultFinishes` and variant `finishes` on every object, so every project GLB lost its own materials to the project's `library.materials` (generated surfaces: roughness 0.8, metalness 0, no clearcoat).

Library variants are finished, baked products and offer no finish choice. Their GLB materials are the product.

## Goals / Non-Goals

Goals: a project object's GLB renders with exactly the materials it ships; nothing else changes meaning.

Non-goals: a recolouring or tint path for library variants; merging finish fields (colour only, maps only) into GLB materials; changes to the manifest or scene schema; changes to what exporters write.

## Decisions

1. **"Ships its own GLB materials" means: the variant has a GLB and its archetype has no builder.** `isBakedVariant(object, variant)` answers `true` when `variant.model ?? object.model` is set and `object.builder` is absent, and keeps today's answer (`true` only when no finish is declared) for an archetype with a builder. The builder is the discriminator because it is what makes the declared finishes load-bearing: a procedural body has no materials of its own and wears the finishes; a builder-less GLB is the whole product. Every project object falls on the first side by format; every shipped archetype falls on the second, where nothing changes.
   - Rejected: "has a GLB" alone. The shipped bank names a `model` for every archetype beside its builder, and a host that injects a `modelUrl` for those GLBs relies on the documented slot dressing (`gltf-body.ts` header, `materialSlots`).
   - Rejected: deciding by origin (project library or shipped bank). The resolver is deliberately blind to where a bank came from (an injected `CatalogueLookup`); the builder field already carries the distinction in the record itself, with no new plumbing.
   - Rejected: dropping slot dressing from `gltf-body.ts` altogether. It removes a documented convention and its tests for a case this change does not need to touch.
2. **Declared finishes stay data.** `mergeFinishes` is unchanged, so `ResolvedAsset.finishes` still lists them, and `asset-variants.ts` still builds the picker's `finishes` from the record. `prepareGltfBody` with `baked: true` neither reads them nor reports unbound materials. A placement `finishes` override or `material` shortcut (`set_object`, `set_material` on a placement) on such a placement is accepted and kept in the document as before, and has no visible effect; a scene diff still rebuilds the placement alone, which redraws the same GLB.
3. **No new field.** The existing `ResolvedAsset.baked` and `GltfBodyOptions.baked` already mean "keep every shipped material"; only the rule that computes it widens. Its doc comment and the README's project format note are updated to the new rule.
4. **Consumers checked.** `asset.baked` is read only by `asset-loader.ts` `upgrade`. The checks are for `builder === undefined`; an unknown builder id does not make a variant baked. The GLB/USDZ exports build a fresh scene from procedural bodies without the project bank or model upgrades, so what they write is unchanged; the metadata table carries identity and variant references, no finish values; the light bake excludes furniture. The stand-in body (`pendingBody`) and the placeholder use their own materials. There is no per-object finish picker; room-surface finish selection reads `scene.finishes` only. The Replace picker's swatch knows only bundled finish ids, a limitation that predates this change and is not touched here. The offscreen `state: 'default'` capture strips placement finishes; for these variants its picture is now the same as `current`, which is the product rule.

## Test approach

A red test over a project scene: the loader is wired exactly as a project mounts it (`projectBank` catalogue, finish resolver, `library.materials` as project materials, project `modelUrl`) and served a GLB through the real model source and `GLTFLoader` with a faked `fetch`. The GLB is the committed box-sofa fixture repacked inside the test with its two materials rewritten into a `metal` material (metalness 0.9, roughness 0.3) and a `top` material behind `KHR_materials_clearcoat` (roughness 0.28, clearcoat 0.35 / 0.22), so no new binary and no fixture writer change is needed. The object declares `defaultFinishes` and variant `finishes` naming generator materials, as a real export does. The test asserts metalness, roughness, clearcoat and clearcoat roughness of the drawn meshes after `upgrade`, that a placement `finishes` override and a `material` shortcut change none of them, that no `unbound-material` warning is reported, and that the Replace picker still describes the variant with its declared finishes. The resolver tests that pinned the old rule flip in the same red commit, and a builder archetype case and an archetype-model fallback case pin the rest. Slot dressing of a builder archetype's GLB is pinned by two tests together: the resolver test "a builder archetype with a GLB that declares finishes is not baked" and the existing GLB body test "a body that is not baked still swaps by slot".

## Risks / Trade-offs

- An editor host that issues finish operations on furniture (`set_object` finishes, `set_material` on a placement, including ones an assistant proposes) sees them accepted with no visible change on a project object. A host that relied on painting a project object's slots that way loses that effect. That is the intended product rule (no finish choice on library variants); the override stays valid data.
- A project GLB with poorly authored materials now shows them as authored. This is the content's responsibility, reported as before through `asset-defect` for convention breaks.

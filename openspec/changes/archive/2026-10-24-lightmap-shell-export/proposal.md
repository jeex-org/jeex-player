# Proposal

## Why

A light bake is baked offline into the second UV channel of the apartment shell. The bake can only be right if it is made for exactly the shell the player draws, and the player can only use it if every baked mesh keeps its run-time behaviour. Two gaps stand in the way: the shell exists only as live objects whose behaviour lives in `userData` callbacks (which a file cannot carry), and every wall mesh is named `wall-face`, so a bake cannot address one. This change gives the bake a shell file with an explicit contract and teaches the player to put a shipped shell file in place of its live shell, only for the revision it was made for.

## What Changes

- An internal export module, `exportShellForBake(scene, { mintId })`, that builds the shell with the player's own builders and writes a GLB: one root node per shell mesh with an identity transform and world-space vertices, `TEXCOORD_0` only, each node and mesh named by a UUID v7 the caller mints (the scene has no id per wall side, nor one for a floor apart from its ceiling; the player mints none), the mesh's structured identity, origin and render flags in `extras`, materials as the finish value plus a flat linear albedo, and the digest of the scene inputs in `asset.extras`.
- The shell file contract as one Zod schema (`src/lightmap/shell-extras.schema.ts`), shared with the bake tool.
- `shellInputsHash`: SHA-256 over a canonical JSON of exactly the scene inputs the shell is built from; never over a mesh or a minted name.
- The sidecar gains an optional `shellInputsHash` (required by the apartment loader; a calibration room has no scene).
- An internal loader, `applyBakedShell`, that checks the shell file's SHA-256 against `shellHash`, the three input digests (sidecar, file, live scene) and the scene id before any page is fetched, judges the file against the contract, adopts the file's geometry into the live shell when the file describes it mesh for mesh, and binds the lightmap by the file's names; on any refusal the live shell is left exactly as built and nothing of the bake applies.
- The binding accepts a name map for an adopted shell; the site and glazing carry no UV1 and stay live.
- A development page comparing the live shell, the adopted shell and the adopted shell with a lightmap.
- No public API, no viewer option, no scene schema change. Unbaked projects are unchanged.

## Capabilities

### New Capabilities

- `light-bake-shell`: the shell file a bake is made for (export, contract, input digest) and how the player puts a shipped shell file in place of its live shell.

### Modified Capabilities

- `light-bake`: the sidecar names the scene inputs of its shell; a binding can resolve meshes through an adopted shell's names.

## Impact

- New: `src/lightmap/shell-export.ts`, `shell-contract.ts`, `shell-extras.schema.ts`, `shell-inputs.ts`, `shell-adopt.ts`, `baked-shell.ts`, `glb-write.ts`; `src/fixtures/shell-unwrap.ts` (a deterministic stand-in for the bake tool's UV1 step, tests only); `dev/lightmap-shell.*`.
- Changed: `light-bake.schema.ts` and `light-bake.ts` (optional `shellInputsHash`), `light-bake-load.ts` (a shell check before pages), `lightmap-binding.ts` (optional name map), `geometry/opening-kinds.ts` (window glazing and frame materials record what they are), `scene/types.schema.ts` (two sub-schemas exported).
- Out of scope: discovering a project's bake (a manifest field), wiring the loader into the viewer, scene edits after a bake is applied, library maps that arrive after binding. Each needs the viewer wiring step.

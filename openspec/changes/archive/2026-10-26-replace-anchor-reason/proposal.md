# Proposal

## Why

A host editor cannot explain why `replace_asset` refused a target with another mounting (a floor armchair replaced by a wall sconce): the refusal has no machine-readable reason, while the mirror refusal of the same op has one. The message also swaps the two mountings it names.

## What Changes

- The anchor refusal of `replace_asset` carries `detail: { op: 'replace_asset', reason: 'anchor_mismatch', assetId, mount, currentMount }`, where `mount` is the target's and `currentMount` the current asset's mounting, each one of `floor`, `wall`, `ceiling`, `surface`.
- The refusal message names the placement with its current mounting and the target with its own.
- README's op table and the CHANGELOG say so.

## Capabilities

### New Capabilities

### Modified Capabilities
- `asset-replace-op`: the incompatible-target requirement names the anchor refusal's reason and fields.

## Impact

`src/scene/ops/assets.ts` (`applyReplaceAsset`), its test, README, CHANGELOG. No schema, wire format or behaviour change: the same edits are refused.

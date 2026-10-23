# Proposal

## Why

Editors cannot set a scene's orientation or sun preset without replacing the whole document. One edit operation lets them change it in place, with undo, and see the sun move.

## What Changes

- New scene operation `set_site` (schema 2.3 documents): sets or clears `northDeg` and `sun`; `northDeg` is normalised to [0, 360); clearing both removes `site`.
- Refused on 2.2 documents; does not change the schema version.
- Available where operations are: the scene model and pure `applyOp`, `jeex-viewer/ops` (named type export), and the authoring `applyOps` of the debug surface. Not allowed inside interior presets (orientation is not decoration).
- Reports a new touched kind `site`, also from document diffs, so host journals see the change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scene-site-orientation`: adds the `set_site` operation.

## Impact

Scene operation types, schema and dispatcher; the touched-kind tables (editor, scene builder, text, equality, scene diff); the preset validator; `jeex-viewer/ops` type exports; the published JSON Schema of operations (with a post-generation rule for «at least one key»); README and CHANGELOG.

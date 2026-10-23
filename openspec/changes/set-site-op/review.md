# Independent review

## Reviewer

Sol unavailable until 14:39, Opus round: an independent agent that did not write the artifacts, read-only, one round (8 findings: 5 should-fix, 3 nit; no blocker).

## Findings

1. proposal / tasks 1.3: the embed protocol carries no operations; the real surfaces are `jeex-viewer/ops` and the debug `applyOps`: fixed.
2. spec «Live viewer»: the player has no undo; restore is a second `set_site` by the host: fixed.
3. spec: touched kind unspecified: fixed (new kind `site`, also from document diffs; task 1.2a).
4. spec: interior presets share the operation schema: fixed (refused in presets; task 1.2b).
5. tasks 1.3: the generated JSON Schema cannot express «at least one key» from types: fixed (post-generation rule, agreement test).
6. spec: pure `applyOp` must refuse 2.2 and bad values itself: fixed.
7. tasks 1.2: normalisation edge cases (-0, tiny negatives): fixed.
8. tasks 2.2: README scene-format text: fixed.

## Verdict

Ready for implementation: yes

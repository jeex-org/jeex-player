# Design

## Context

`applyReplaceAsset` compares `anchorPair(current)` with `anchorPair(target)` and throws an `OpError` with a message only. The mirror refusal below it already passes `'replace_asset'` and a detail object, which `OpError` spreads into `detail` with `op`.

## Goals / Non-Goals

**Goals:**
- One reason and two mounting words a host can turn into a sentence.
- The message names each side with its own mounting.

**Non-Goals:**
- Changing which targets are accepted, or the Replace panel's offer list.

## Decisions

- A `mountOf(archetype)` helper next to `anchorPair`: `surface` when `onSurface` is true, else the anchor, `floor` when absent. The comparison stays on `anchorPair`, so acceptance is unchanged.
- `detail` stays `ErrorDetail`, like the mirror refusal; the mounting type is local to the op module.

## Risks / Trade-offs

- Two pairs can map to one word (a wall-anchored on-surface item against a floor one): then `mount` equals `currentMount`. No catalogue entry is like that today; accepted.

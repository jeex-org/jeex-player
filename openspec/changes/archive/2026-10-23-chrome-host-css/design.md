# Design

## Context

See proposal.md for the motivation. The sheet (`src/ui/styles/viewer.css`) is adopted once per document or shadow root (`ensureViewerStyles`) and is entirely inside `@layer reset, component`. In the cascade an unlayered declaration beats every layered one, so only an unlayered declaration (decided by specificity, then order) or `!important` can outrank a host's unlayered `button {}`. Adopted sheets are ordered after the document's own sheets.

## Goals / Non-Goals

**Goals:** the chrome computes on a hostile page what it computes on a clean one; no value is written twice; the shadow path and every documented hook are untouched.

**Non-Goals:** isolation from host rules of two or more classes, an ID or `!important`; isolation of the root element; scrollbar, selection and placeholder pseudo-elements.

## Decisions

1. **An unlayered guard that decides nothing.** `:where(:root) .jeex-viewer :not(html):where(:not([data-jeex-slot], [data-jeex-slot] *))`, plus `::before` and `::after`, with the single declaration `all: revert-layer`. When it wins, each property rolls back to the player's own layers and, beneath them, to the UA and inheritance: the clean-page result by construction, with no second copy of any value. `all` excludes custom properties, so theming variables and the inline `--jeex-*` the chrome writes pass through. Alternatives: duplicating declarations unlayered (drifts), layered `!important` (kills `::part()` and every host hook), `@scope` (does not outrank layers).
2. **Specificity (0,1,1).** `.jeex-viewer` gives one class, `:not(html)` the weight of one element name while matching every element, `:where()` adds nothing. It beats element chains and the universal selector, ties a `.kit button` rule and wins the tie by sheet order, and loses to `.jeex-viewer .mode-button` (0,2,0), which stays the way to override deliberately.
3. **Slot boxes and their content are excluded**, so host rules on the boxes and the inheritance into host content are unchanged.
4. **`:where(:root)` gates both rules to the document.** It adds no specificity, and inside a shadow root's sheet it can never match, so the custom element's chrome is untouched, including weak rules a host adds to the open shadow root.
5. **A typography boundary in `@layer reset`** on `:where(:root) .jeex-viewer > :not([data-jeex-slot])`: `font: 400 medium/normal var(--jeex-font)`, the root's `font-synthesis` and `text-rendering`, `color: var(--jeex-surface-text)`, and normal letter and word spacing, no transform, indent or shadow, start alignment, normal white space. Reverting a descendant cannot clean a value inherited from the root, which inherits from the host's `body`; the boundary sits below the root so the root and the slot boxes keep inheriting from the host as before. The values equal what a clean page inherits today, so existing baselines do not move.

## Risks / Trade-offs

- [Weak host overrides of chrome classes stop working on the light-DOM path] → README states the named form `.jeex-viewer .x`; theming properties and `::part()` are the documented hooks and are unaffected.
- [A host sheet adopted after the player's wins a (0,1,1) tie] → listed as a limit; no host is known to do it.
- [Host rules in its own cascade layers survive a revert-layer, and a host layer named `reset` or `component` would merge with the player's] → listed as a limit.
- [`all` adds cascade work per chrome element] → a few hundred elements; no measurable cost expected, not engineered for.
- [Inherited direction, writing mode or exotic text properties set on the host body are not pinned] → listed; no current embed sets them.

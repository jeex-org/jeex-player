# Tasks

## 1. Red tests

- [x] 1.1 Op: keep and drop fields; verbatim position for an on-surface vase; refusals (unknown asset, foreign variant, different anchor pair, disallowed mirror); presets forgotten; one revision
- [x] 1.2 Scene diff: a `library` change is a new body
- [x] 1.3 Offers (awaited before validation; a bare scene; an id equal to the project's is refused): URL and inline forms parse; relative paths resolve against the offers folder; an invalid file warns and yields the bundled fallback
- [x] 1.4 Library stack: project, then offers, then bundled; the resolver accepts an offers placement and loads its model from the offers folder; an offers asset with its own material renders it; the validator accepts it; `parseProjectLibrary` + `libraryOf` validate a document naming offers; the light bake takes an offers lamp
- [x] 1.5 `replaceOffers`: same anchor pair, mirror allowed, own archetype excluded, grouped by category, readable labels, empty on-surface fallback, explicit default variant on a pick, rendered previews for bundled archetypes
- [x] 1.6 Panel: second footer button present; existing controls keep their positions; the swatch region scrolls
- [x] 1.7 Popup (component): title, focus trap, Escape, focus return, pick dispatches `replace_asset` (local and emit)
- [x] 1.8 E2E (phone size, shadow root, an offers fixture with 20 variants and a second on-surface object): reach the last variant; open the popup by keyboard; replace; the new body appears under the same id

## 2. Implementation

- [x] 2.1 Op, type, schema, dispatcher, scene diff
- [x] 2.2 Offers option, attribute, loader
- [x] 2.3 Library stack in the resolver, validator, wiring and light bake
- [x] 2.4 Panel CSS and anchoring; second footer action
- [x] 2.5 Popup module, `replaceOffers`, messages in every locale (button, title, close, empty state); `offers` in `schema/viewer-options.json`
- [x] 2.6 Public exports and README for `offers` and `replace_asset`

## 3. Checks

- [ ] 3.1 Fast tier green; one full gate

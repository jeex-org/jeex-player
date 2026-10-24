## ADDED Requirements

### Requirement: Lights record

A sidecar MAY carry `lights`: the recipe of the lights the bake took (`jeex-bake-lights@1`), the lighting standard's appearance version they were read from (an integer of at least 1) and the sky recipe (`jeex-sky-hemisphere@1`), and nothing else. Another recipe SHALL be refused, naming the field. The sidecar's `sky` stays the bake's own record, not judged by the player (under this recipe it holds `upper` and `lower`).

#### Scenario: Lights recorded
- **WHEN** a sidecar carries `lights` with the known recipes and a `sky` of `upper` and `lower`
- **THEN** it passes unchanged

#### Scenario: Unknown recipe
- **WHEN** `lights.recipe` or `lights.skyRecipe` is another value, or `lights` has another key
- **THEN** the sidecar is refused, naming the field

### Requirement: Apartment bakes record their lights

A sidecar for an apartment SHALL carry `lights`, checked with the shell's inputs before the shell file is used; a calibration room's sidecar MAY omit it.

#### Scenario: Apartment bake without lights
- **WHEN** an apartment bake's sidecar has no `lights`
- **THEN** the bake is refused before its shell file is used, saying it does not say which lights it took

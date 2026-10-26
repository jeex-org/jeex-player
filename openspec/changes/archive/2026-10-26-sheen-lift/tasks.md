# Tasks

## 1. Red tests

- [x] 1.1 The manifest schema accepts `sheenLift` at 0, 0.5 and 1 and refuses -0.1, 1.1 and NaN.
- [x] 1.2 A tinted sheen without a colour and with `sheenLift: 0.5` draws its tint lerped toward white by 0.5; without the field, by 0.2.
- [x] 1.3 `sheenLift` beside `sheenColour` leaves the stated colour; `sheenLift` alone keeps the standard material model.

## 2. Implementation

- [x] 2.1 `sheenLift` in `libraryPbrSchema` and `LibraryPbr`.
- [x] 2.2 `applyPhysical` lifts by `pbr.sheenLift ?? SHEEN_LIFT`.
- [x] 2.3 README material facts and CHANGELOG.

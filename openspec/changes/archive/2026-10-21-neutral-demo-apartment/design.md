# Design

## Context

The demo scene is the player's showcase and the reference document for scene authors, and many tests use it as a large, realistic scene. Replacing it touches the data in `src/demo/`, every test that reads it, the e2e screenshot baselines and the site images.

## Decisions

- **A new plan, not a transformed one.** The apartment is drawn from scratch: a 13.20 × 9.20 m envelope with a 0.24 m bearing spine running east–west, a corridor hall entered from the east facade, the kitchen, bathroom, WC and guest bedroom north of the spine, and the living and dining room, bedroom and study south of it. A mirrored, rotated or stretched copy of the previous plan was rejected: it would still be the previous plan.
- **Showcase features kept.** A curved facade wall with a window along the arc (a shallow arc, chord 3.40 m on a 2.20 m radius, bulging 0.80 m), facade / bearing / partition thicknesses, an entrance door flagged in the data, ten doors with authored hinge and swing, a loggia reached from two rooms, a kitchen island, two double beds, four interior presets, room cameras, navigation points, a walk spawn and an autotour.
- **Separate rooms, no open plan.** The plan solver needs one anchor per bounded room face, so an open kitchen-living space would merge two rooms' identities, cameras and finishes for no showcase gain.
- **Fresh ids.** Every demo entity gets a new UUID v7 literal, held as a named constant in `demo-ids.ts`; keys name nodes and walls by where they stand and rooms and placements by what they are. No tracked file outside the id table held a demo entity id, so nothing else depends on the values. Catalogue, variant and finish ids are unchanged, and no remapping of old demo ids is added.
- **Ceiling and wall scheme.** The 2.65 m ceiling stays; changing it adds nothing to the showcase and touches the height rules.
- **The loggia is also a passage.** Its two doors (x 6.30 and 8.40) stand 2.10 m apart so a walk across it is two easy turns, and its seat stands east of both doors so the strip between them stays clear.
- **Presets dress, never re-lay.** No preset column takes a size variant (no wide basin, no 2.8 m island, no tall shelf, lamp or side table); a test holds every placement's pose, footprint and height under every preset.
- **Default view from the north.** The presentation camera looks from the north, steep enough that the corridor wall does not hide the rooms south of it, so the curved bay window and the loggia stand on the far side of the dollhouse where their glass is seen.

## Testing

- Tests that are about the demo assert the new programme with values derived from the authored dimensions.
- Tests that only use the demo as a large scene keep their invariants; where a test needed one exact arrangement (a turn that cannot fit, a crowded room, a split position), it is re-authored against the new arrangement with the precondition stated in the test.
- Measured, not derived: the layout mask's accuracy floor for the sofa (89.7 % of a 0.05 m reference lattice on this plan, floor 0.88) and the browser check's turn-rate bound for the mini-map walk (27.4° per 100 ms measured, bound 32°).
- Screenshot comparisons are ignored on CI, so every re-captured baseline was opened and checked against the new plan; canvas baselines are re-captured in full, since the comparison tolerance would keep an image of a different plan.

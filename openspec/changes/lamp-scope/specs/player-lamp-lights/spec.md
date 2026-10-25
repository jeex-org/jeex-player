# Spec Delta

## MODIFIED Requirements

### Requirement: Known costs and limits stated

The player's README SHALL state that adding or removing a lamp light recompiles materials once (a visible hitch on placing or swapping a lamp), that in walk and tour lamp lights feed the room grids and stop at their room's boundary while the editing modes still let them reach through walls up to their cutoff, that a lamp edit in walk re-bakes the walk lighting, the concave-room limit of `walk-room-lighting` where it stands, that the lumens are nominal (see `lamp-light-fact`), and the low-ceiling stand-in.

#### Scenario: README
- **WHEN** a reader looks up lamp lights in the player README
- **THEN** it names the recompile hitch, the room grids, the room boundary in walk and tour, the walls in the editing modes, the re-bake on a lamp edit, the concave-room limit where it stands, the nominal lumens and the low-ceiling stand-in

#### Scenario: Low-ceiling stand-in described
- **WHEN** a reader looks up ceiling lamps in the player README
- **THEN** it says that under a ceiling lower than 2.73 m the ceiling stand-in is shortened to the clamped drop while the GLB is not, and that the light follows the GLB

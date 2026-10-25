## ADDED Requirements

### Requirement: HDRI sky through the chain

While an HDRI sky is shown in walk or tour it SHALL reach the chain's output pass at the lighting standard's `skyBrightness` divided by the renderer exposure in force, so it reads the same with and without the walk exposure. That background intensity SHALL be owned by the HDRI alone: the walk rig SHALL NOT save, divide or restore it while the HDRI sky is shown, and SHALL treat the gradient sky as before. The walk white balance SHALL apply to the HDRI sky exactly as to the gradient sky: in the output pass, after the scene's background intensity and before the exposure and tone mapping, on display frames only and never in grid or probe captures.

#### Scenario: Brightness survives a re-bake
- **WHEN** the HDRI sky is live in walk, the room lighting re-bakes (capture states) and returns to walk
- **THEN** the background intensity is `skyBrightness` over the walk exposure again

#### Scenario: Empty plan reads the same
- **WHEN** the same HDRI sky is shown in walk in a scene with closed rooms (walk exposure) and in one without (editing exposure)
- **THEN** a window-free view of the sky has the same mean display value within 2 %

#### Scenario: Gradient after the HDRI
- **WHEN** the HDRI fails or is released while in walk
- **THEN** the gradient sky's background intensity is the editing value divided by the walk exposure, as before this change

### Requirement: HDRI changes redraw walk and tour

In walk and tour a display draw SHALL follow an HDRI going live, being released or falling back to the recipe look.

#### Scenario: Pair arrives while resting
- **WHEN** the HDRI goes live while the camera rests in walk
- **THEN** the next tick draws the HDRI sky

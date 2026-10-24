# Spec Delta

## MODIFIED Requirements

### Requirement: Chain contents

The chain SHALL apply, in order, ground-truth ambient occlusion (world-space radius 0.3 m, at the drawing-buffer resolution, denoised without crossing depth breaks), SMAA and the lighting standard's display transform preceded by the walk white balance (capability `walk-white-balance`) in the same pass, rendering the scene in linear half-float colour without multisampling and tone mapping it exactly once.

#### Scenario: Corner darkening
- **WHEN** a walk view shows a floor-to-wall corner and an open patch of the same floor
- **THEN** with the chain the corner reads darker relative to the open patch than without it

#### Scenario: Smoother edges
- **WHEN** a walk view shows a high-contrast diagonal edge
- **THEN** with the chain the edge's error against a supersampled reference is lower than without it

#### Scenario: Open floor unchanged in tone
- **WHEN** an open floor patch away from geometry is compared with and without the chain, with the white balance at identity
- **THEN** its displayed colour differs by no more than 2 % per channel

#### Scenario: White balance in the output pass
- **WHEN** the chain is built
- **THEN** its last pass applies the white balance and the display transform, and the chain has no other pass

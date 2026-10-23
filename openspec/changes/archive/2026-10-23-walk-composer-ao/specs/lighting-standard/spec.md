## MODIFIED Requirements

### Requirement: Display transform of the player's images

Every lit surface the player draws (live view, still, panorama, swatch) SHALL be tone mapped with PBR Neutral and encoded to sRGB exactly once. Offscreen images, and the live view in the walk and tour post-processing chain, apply that transform to the whole frame, so a background, fog or content marked as not tone mapped differs between them and the direct live view of the editing modes.

#### Scenario: Swatch through the display transform
- **WHEN** the player renders a material swatch
- **THEN** it renders into a high-dynamic-range target and one display pass applies PBR Neutral, the renderer's exposure and the sRGB encoding

#### Scenario: Still of a lit surface
- **WHEN** a still is captured of a lit surface that the live view also shows
- **THEN** the surface's pixel values in the still and in the live view agree within 2 %

#### Scenario: Walk view through the chain
- **WHEN** the live view renders through the walk and tour chain
- **THEN** the scene is rendered in linear high dynamic range and the chain's last pass applies PBR Neutral, the renderer's exposure and the sRGB encoding once

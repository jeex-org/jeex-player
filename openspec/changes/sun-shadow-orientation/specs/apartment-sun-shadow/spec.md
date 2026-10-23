## ADDED Requirements

### Requirement: Sun from the scene's orientation

On every scene load, rebuild and GPU context restore, the player SHALL aim the apartment rig's sun by the scene's orientation (capability `scene-site-orientation`) through the standard's direction function, and SHALL reset it to the legacy direction when the orientation is absent. Captures of the default state SHALL use the same orientation, the same ceiling and cut-away casters and the same fitting policy over their own scene's geometry.

#### Scenario: Scene with a site
- **WHEN** a scene with `site: { northDeg: 0, sun: "evening" }` is shown
- **THEN** the sun shines from world azimuth 270° at 20° elevation

#### Scenario: Site removed
- **WHEN** a scene with a site is replaced by one without
- **THEN** the sun returns to the legacy direction

#### Scenario: Capture agrees
- **WHEN** a still of the default state is captured from an overview
- **THEN** its sun direction equals the live view's, its ceilings block the sun as in the live view, and its frustum contains its own scene's casters

### Requirement: Fitted shadow

The sun's shadow SHALL cover exactly the apartment: walls with their thickness, ceiling casters, furniture, floors and the swept space of doors, padded by the standard; the site ground, sky and helpers SHALL NOT widen it. The fit SHALL be recomputed after a structural change; while an object is dragged or animated the frustum SHALL only grow to contain it, and SHALL be refitted when the move is committed, cancelled or reverted. The map size SHALL stay 2048² unless the rig options say otherwise.

#### Scenario: Large plan not clipped
- **WHEN** a plan 30 m across is shown
- **THEN** every wall and floor lies inside the shadow frustum and casts or receives

#### Scenario: Drag beyond the fit
- **WHEN** an object is dragged outside the current frustum and the move is then cancelled
- **THEN** its shadow is drawn during the drag and the frustum returns to the apartment's fit after the cancel

#### Scenario: Ground does not widen the fit
- **WHEN** the same plan is fitted with and without the site ground present
- **THEN** the two frustums are equal

### Requirement: Shadow cache

The sun's shadow map SHALL be redrawn only when it is dirty: after any change of the geometry, pose or visibility of something that casts or receives (scene load, rebuild or edit operation, interior preset swap, model upgrade, door or furniture animation frame with its final frame, a move with its cancel or revert), a sun change, a refit or a context restore. A change of paint alone or of the dollhouse shell state SHALL NOT redraw it.

#### Scenario: Static view
- **WHEN** the camera orbits a static apartment for 60 frames
- **THEN** the sun's shadow map is drawn at most once

#### Scenario: Door motion
- **WHEN** a door opens
- **THEN** the shadow map is redrawn on every frame of the motion and once at its final pose, then stops

#### Scenario: Cutaway
- **WHEN** the shell state changes between full and cutaway
- **THEN** the shadow map is not redrawn and the shadows on the floor do not change

### Requirement: Casters that are not seen

Ceilings SHALL block the sun in every shell state through closed casters of the room outlines, and walls cut away by the dollhouse SHALL keep casting. These casters SHALL NOT appear in any image the player draws (live view, still, panorama, mirror), SHALL NOT be exported (GLB, USDZ) and SHALL NOT be picked. Loggias keep no ceiling, as today. Window glass and glass door inserts SHALL NOT cast.

#### Scenario: Overview from above
- **WHEN** the apartment is seen from above in a cutaway shell state with a high sun
- **THEN** sunlit patches on the floors appear only under openings, never as the room's whole outline

#### Scenario: Caster invisible
- **WHEN** a still, a panorama or the live view is drawn in any shell state
- **THEN** no shadow-only caster appears in the image and a click where a hidden ceiling or cut-away wall would be selects what is behind it

#### Scenario: Mirror and export
- **WHEN** a mirror shows the room or the scene is exported
- **THEN** no shadow-only caster appears in the reflection or in the exported file

#### Scenario: Glass passes light
- **WHEN** the sun shines through a window
- **THEN** the floor patch has no shadow of the pane, only of the frame and mullions

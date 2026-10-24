## MODIFIED Requirements

### Requirement: Sun from the scene's orientation

On every scene load, rebuild and GPU context restore, the player SHALL aim the apartment rig's sun by the scene's orientation (capability `scene-site-orientation`) through the standard's direction function, and SHALL reset it to the legacy direction when the orientation is absent. Captures of the default state SHALL use the same orientation, the same ceiling and cut-away casters and the same fitting policy over their own scene's geometry. While an HDRI is installed in walk and tour (capability `hdri-sky`) the sun SHALL keep the preset's world azimuth but take the HDRI's elevation, colour and intensity, with a refitted frustum, and SHALL return to the preset's sun on leaving.

#### Scenario: Scene with a site
- **WHEN** a scene with `site: { northDeg: 0, sun: "evening" }` is shown
- **THEN** the sun shines from world azimuth 270° at 20° elevation

#### Scenario: Site removed
- **WHEN** a scene with a site is replaced by one without
- **THEN** the sun returns to the legacy direction

#### Scenario: Capture agrees
- **WHEN** a still of the default state is captured from an overview
- **THEN** its sun direction equals the live view's, its ceilings block the sun as in the live view, and its frustum contains its own scene's casters

#### Scenario: HDRI sun in walk
- **WHEN** a scene with `site: { northDeg: 0, sun: "evening" }` and an evening entry with elevation 10.5 is walked with the HDRI live
- **THEN** the sun shines from world azimuth 270° at 10.5°, and its shadow frustum contains the apartment's casters

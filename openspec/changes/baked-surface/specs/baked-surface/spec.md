# Spec Delta

## Purpose

How the player lights a surface whose diffuse light comes from a light bake, and a lamp whose light is in that bake, so baked light is never counted twice while the live sun, live lamps and reflections stay.

## ADDED Requirements

### Requirement: Indirect diffuse of a baked surface comes only from its lightmap

A material marked as a baked surface SHALL receive no diffuse light from the ambient lights (the walk's ambient floor included), the hemisphere, light probes, a light-probe grid or the environment; its lightmap SHALL be its only diffuse indirect light. This SHALL hold in every interaction mode and in captures.

#### Scenario: Zero lightmap under the full rig
- **WHEN** a grey, zero-specular baked surface with an all-zero lightmap is drawn with a nonzero hemisphere, ambient light, light-probe grid, environment and fill light, and the sun
- **THEN** both a sunlit and a shadowed pixel equal an independent sun-only reference within a small linear tolerance

#### Scenario: Lightmap adds its light
- **WHEN** the same surface carries a uniform nonzero lightmap in an editing mode
- **THEN** each pixel equals the sun-only reference plus the lightmap's diffuse contribution within the tolerance

#### Scenario: Surfaces that are not baked are unchanged
- **WHEN** a scene without any baked surface is drawn before and after this change in each mode
- **THEN** the frames are identical within the tolerance

### Requirement: Direct light on a baked surface

On a baked surface the sun's direct light and its shadows SHALL stay as on any other surface, and the fill light SHALL contribute nothing. The sun SHALL be recognised by its identity in the lighting rig, never by whether it casts shadows.

#### Scenario: Sun and shadow kept
- **WHEN** a baked surface is half in the sun's shadow
- **THEN** the lit and shadowed halves match the sun-only reference

#### Scenario: Fill dropped
- **WHEN** the fill light's intensity is doubled in an editing mode
- **THEN** a baked surface's pixels do not change, and an unbaked surface's do

### Requirement: Baked and live lamps

A point or spot light marked baked SHALL add no diffuse light to a baked surface, and SHALL keep adding its specular highlight there. A light marked live, or never marked, SHALL light a baked surface exactly as any surface. Every lamp SHALL light surfaces that are not baked exactly as before.

#### Scenario: Baked lamp on a baked surface
- **WHEN** a baked point light and, separately, a baked spot light shine on a grey zero-specular baked surface
- **THEN** the surface equals its reading with that light at zero intensity

#### Scenario: Live and unmarked lamps
- **WHEN** a point or spot light marked live, or not marked, shines on a baked surface
- **THEN** its contribution equals the one it adds to the same surface unbaked

#### Scenario: Highlight kept
- **WHEN** a baked lamp shines on a glossy baked surface
- **THEN** its specular highlight is present and equals the highlight on the same surface unbaked

#### Scenario: Unbaked surface lit by a baked lamp
- **WHEN** a baked lamp shines on a surface that is not baked
- **THEN** the surface is lit as if the lamp were live

### Requirement: Lamp classification follows three's light order

Which lamp is baked SHALL be resolved per drawn light for every render, including captures and renders nested inside another render, whatever the mix of shadow-casting lights, lights with a projected texture, hidden ancestors and camera layers.

#### Scenario: Mixed ordering
- **WHEN** baked and live spot lights are mixed with and without shadows and projected textures
- **THEN** each light's diffuse on a baked surface is dropped exactly when it is marked baked

#### Scenario: Hidden ancestor and camera layer
- **WHEN** a live lamp's parent is hidden, or a lamp is on a layer the camera does not see, beside a baked lamp
- **THEN** the remaining lamps keep their own classification

#### Scenario: Nested render
- **WHEN** a render draws another scene or camera in the middle of its own draw and then continues
- **THEN** both renders apply the classification of their own lights

### Requirement: Mode parity of baked light

The lightmap's contribution on a baked surface SHALL be scaled by the same interior factor as the direct sun: 1 in the editing modes and in grid and probe captures, the walk sun factor inside room boxes in walk and tour. Specular reflections on a baked surface SHALL follow the mode as on any surface.

#### Scenario: Walk scales like the sun
- **WHEN** a baked floor inside a room is read in walk and in an editing mode with the same camera, before the post chain
- **THEN** its lightmap contribution in walk is the editing contribution times the walk sun factor, within the tolerance

#### Scenario: Capture sees the unscaled lightmap
- **WHEN** a room probe is captured in walk
- **THEN** the baked surface in the capture carries its unscaled lightmap

### Requirement: No recompile on toggles

Marking a lamp baked or live, changing a lamp's intensity, switching between modes and capturing SHALL change no compiled program of a baked surface. Marking a material baked SHALL compile it once.

#### Scenario: Toggle a lamp
- **WHEN** a lamp is switched between baked and live over several frames
- **THEN** the number of compiled programs stays constant

### Requirement: Shader rewrites compose

Every rewrite of a material's shader (the walk lighting, the baked policy, a lightmap decode, a host's own compile hook) SHALL apply together on one material in a fixed order, whichever was added first; adding the same rewrite again SHALL change nothing; a material copied with its compile hook SHALL keep the rewrites it had and take further ones on its own.

#### Scenario: Order of registration does not matter
- **WHEN** the lightmap decode is added before, and on another material after, the walk lighting and the baked mark
- **THEN** both materials render the same pixels and share one program

#### Scenario: Copy keeps the rewrites
- **WHEN** a marked material's clone copies its compile hook and gets a lightmap decode of its own
- **THEN** the clone renders with the walk lighting, the baked policy and its decode, and the source without that decode

### Requirement: Context restore

After a lost and restored WebGL context, baked surfaces SHALL keep their policy and lamps their classification without any call from the host.

#### Scenario: Restore
- **WHEN** the context is lost and restored with a baked surface and a baked lamp in view
- **THEN** the frame after the restore matches the frame before it within the tolerance

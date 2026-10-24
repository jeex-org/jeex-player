## MODIFIED Requirements

### Requirement: Shell identity

The player SHALL apply a light bake only to the shell it was made for: the fetched shell GLB's SHA-256 SHALL equal the sidecar's `shellHash`, and every binding SHALL resolve to exactly one mesh, by its name in the shell file, whose UV1 is finite, two-component and lies inside the binding's rect. A sidecar for an apartment SHALL also carry `shellInputsHash` (requirement «Revision check before pages» of the light-bake shell). Any failure SHALL discard the whole bake, never apply part of it.

#### Scenario: Wrong shell
- **WHEN** the shell bytes do not hash to `shellHash`
- **THEN** the bake is refused before any texture is uploaded

#### Scenario: Missing or ambiguous mesh
- **WHEN** a binding names no mesh, or more than one object carries that name
- **THEN** the bake is refused, naming the node, and no material is changed

#### Scenario: Binding a mesh the bake gave no UV1
- **WHEN** a binding names an adopted mesh that has no UV1 (the site slab)
- **THEN** the bake is refused and no material is changed

#### Scenario: Digest grammar
- **WHEN** a sidecar's `shellInputsHash` is not `sha256:` followed by 64 lowercase hex digits
- **THEN** the sidecar is refused, naming the field

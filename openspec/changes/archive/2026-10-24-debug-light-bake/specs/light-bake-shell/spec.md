## ADDED Requirements

### Requirement: The apartment loader honours its caller's abort

`applyBakedShell` SHALL accept an optional `AbortSignal` and, when it is aborted by the time the files have loaded, SHALL refuse the bake before the live shell changes and release every loaded page.

#### Scenario: Aborted

- **WHEN** the signal is aborted while a level file is loading
- **THEN** the outcome is a refusal and every shell mesh keeps its live geometry and material

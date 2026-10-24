## ADDED Requirements

### Requirement: Finishes named by the caller

The shell export SHALL take the finishes the live view paints the scene with as a required option: `SHIPPED_FINISHES` for a scene drawn without a project, or `projectFinishes(materials)` for a project, the same composition the live project view uses (the project's surface materials first, the bundled catalogue behind them). A call without finishes SHALL be a type error and SHALL be refused at run time; the export SHALL NOT fall back to the bundled finishes when a project's materials are given.

#### Scenario: No finishes
- **WHEN** the shell is exported without finishes
- **THEN** the export is refused, naming the finishes

#### Scenario: A project answers a bundled finish id
- **WHEN** a project's own surface material carries a bundled finish id with another colour and the shell is exported with that project's finishes
- **THEN** the exported albedo is the project's colour, as the live project view paints it, and an export with the shipped finishes does not carry it

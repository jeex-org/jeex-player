## 1. Contract

- [x] 1.1 Shell file contract schema (`shell-extras.schema.ts`) and its tests: the export passes unchanged; each rule refuses naming its field
- [x] 1.2 Sidecar `shellInputsHash` (optional, digest grammar) and its test

## 2. Export

- [x] 2.1 `shellEntries`: build-order walk of the live shell with each mesh's contract and finish value; leaves, proxies and shadow-only casters left out
- [x] 2.2 Opening materials record their finish id and glazing
- [x] 2.3 Deterministic GLB writer
- [x] 2.4 `exportShellForBake` with caller-minted ids; tests: world-space vertices, identity nodes, unique minted names, refused bad ids, kinds, marks, visible ceilings
- [x] 2.5 `shellInputsHash`; tests: one shell field changes it, a project material replacing a default finish changes it, furniture and names do not, two minters give one digest

## 3. Load

- [x] 3.1 Stand-in UV1 step for tests (splits vertices, keeps names, order, materials, extras; no UV1 on the site and glazing)
- [x] 3.2 `adoptShippedShell`; tests: behaviour, world triangles, origins and ray picks unchanged; dollhouse on opening parts unchanged; another revision refused with nothing changed; undo
- [x] 3.3 Shell check before pages in `loadLightBake`; `verifiedShellFile`; tests: another revision, missing digest, another scene, disagreeing file, a lit mesh left unbound
- [x] 3.4 Binding by adopted names; tests: lit meshes marked, site and glazing live; a binding naming a mesh without UV1 refused
- [x] 3.5 `applyBakedShell` transaction; bun tests for refusals (requests stop before pages); browser tests for the applied path, the adopted render equal to the live one, dispose after and without unbinding, and a binding refused after the pages loaded

## 4. Look and gates

- [x] 4.1 Development page comparing live, adopted and baked shells; screenshots looked at
- [x] 4.2 Fast tier green; one standard tier run through the heavy-work queue at the end (integration = one run, failed files only on red)

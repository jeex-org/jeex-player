/**
 * The ids of the committed fixture bakes, as named constants.
 *
 * `tests/fixtures/project/` (the one valid bake) and
 * `tests/fixtures/project-invalid/` (the same bake with a scene path that
 * leaves its folder) carry fixed UUID v7 literals, written once offline: the
 * viewer never mints an id, so neither do its fixtures. Every test that reads
 * either bake names its ids through these constants rather than repeating the
 * literals, and `src/assets/project-fixture.test.ts` proves the JSON files
 * agree with them.
 */

/** `tests/fixtures/project/`: one archetype with one variant, two materials, two rooms. */
export const PROJECT_FIXTURE = {
  projectId: '01a12fec-9d28-71d3-9f13-24f36f8cb88c',
  bakeId: '01a12fec-9d29-73ce-8bb1-c59b52b14c54',
  workspaceId: '01a12fec-9d2a-7190-95af-61ba91a556ed',
  /** The one archetype, the box sofa whose GLB the folder ships. */
  asset: { boxSofa: '01a12fec-9d2b-7b29-a1f8-52f300eb0d8b' },
  variant: { boxSofa: '01a12fec-9d2c-7a6d-8966-e2c9fce179df' },
  material: { oak: '01a12fec-9d2d-7a44-8991-7dada752fe18', white: '01a12fec-9d2e-79bd-a184-d53d62036c87' },
  scene: '01a12fec-9d2f-7954-b38b-84e17fceebc7',
  node: {
    nw: '01a12fec-9d30-7a6a-a4d0-2fbafdac7f03',
    nm: '01a12fec-9d31-7663-b822-d518a25e8453',
    ne: '01a12fec-9d32-7196-9884-83bb8f3e8fdf',
    se: '01a12fec-9d33-7364-9333-b1df92a13118',
    sm: '01a12fec-9d34-758a-acfa-d0f66594ca54',
    sw: '01a12fec-9d35-76aa-b291-0094d081428f',
  },
  wall: {
    northWest: '01a12fec-9d36-748e-aa0d-a631b3e6e145',
    northEast: '01a12fec-9d37-7a6c-97e1-5b8e298a7acb',
    east: '01a12fec-9d38-7e15-b79b-11b19ef19139',
    southEast: '01a12fec-9d39-7f57-85de-524e75edac98',
    southWest: '01a12fec-9d3a-7677-b6d1-79764d2bb268',
    west: '01a12fec-9d3b-7671-88a7-ece42bed2c54',
    middle: '01a12fec-9d3c-7fc8-8e73-a5aa3f2c6c06',
  },
  opening: { middle: '01a12fec-9d3d-706a-8371-da5610d96c72' },
  room: { living: '01a12fec-9d3e-7347-8cc4-be2db319e364', bedroom: '01a12fec-9d3f-77fe-9782-eaaca12a4518' },
  placement: { sofa: '01a12fec-9d40-78fa-a0bc-26c346f637ed' },
} as const;

/** `tests/fixtures/project-invalid/`: the same library under a project of its own. */
export const INVALID_PROJECT_FIXTURE = {
  projectId: '01a12fec-9d41-7c54-a85d-0467f53e8f9b',
  bakeId: '01a12fec-9d42-7ccc-8a3d-71dcc4d09896',
} as const;

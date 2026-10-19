/**
 * Ids of the two test plans of `plan-l-shape.ts`: `lShapePlan` (`L_SHAPE`), `bayPlan`
 * (`BAY`) and the scene-local materials both declare (`PLAN_MATERIAL`).
 *
 * Every id in a scene is a UUID v7 and the viewer never mints one, so a
 * fixture's ids are fixed literals generated once, offline. Each key is the
 * camel-cased readable name of the entity, so a test reads
 * `L_SHAPE.room.a` for the room called `a`.
 */

export const L_SHAPE = {
  scene: '01a12fe6-aeaf-75cc-bfd9-1e375823a0e8',
  /** Wall-graph nodes, numbered as in the drawing. */
  node: {
    n1: '01a12fe6-aeb0-7ffb-81e3-ae91219b9b4b',
    n2: '01a12fe6-aeb1-706e-b951-c5e67d868717',
    n3: '01a12fe6-aeb2-7bc3-a3f7-963bd26ebc54',
    n4: '01a12fe6-aeb3-736f-ad5a-fa7c74fef50f',
    n5: '01a12fe6-aeb4-7fc4-b7c4-7dd013c75848',
    n6: '01a12fe6-aeb5-7c46-a70f-b6ad1cce3f79',
    n7: '01a12fe6-aeb6-7deb-968f-3b1a60b9c817',
  },
  /** Walls: the south, east and north facade runs, the step and the partition. */
  wall: {
    wSA: '01a12fe6-aeb7-7785-80e1-b477b657f55d',
    wSB: '01a12fe6-aeb8-7ae9-9456-155c9039cd95',
    wE: '01a12fe6-aeb9-7f83-b1ed-5a460f0be208',
    wNB: '01a12fe6-aeba-76ba-b040-eb4bf2abaf31',
    wStep: '01a12fe6-aebb-700b-b8ad-5202ebf713df',
    wNA: '01a12fe6-aebc-75e2-993d-b8adf26e3610',
    wW: '01a12fe6-aebd-7fca-a98d-0fbd9963cd6a',
    wPart: '01a12fe6-aebe-78b3-8554-a8c1fed044b8',
  },
  /** Doors and windows. */
  opening: {
    doorEntry: '01a12fe6-aebf-7606-9c9d-3135ba3254fc',
    windowASouth: '01a12fe6-aec0-7007-881f-2a18a04c89a4',
    windowBEast: '01a12fe6-aec1-78d1-9820-9e519eb9afef',
    doorAb: '01a12fe6-aec2-73c9-8e44-82e9390b275e',
  },
  /** Rooms A and B. */
  room: {
    a: '01a12fe6-aec3-734d-bf23-be82cedaff5e',
    b: '01a12fe6-aec4-7ba4-b1e8-ea477580cc86',
  },
  /** Furniture placements. */
  asset: {
    sofa: '01a12fe6-aec5-785e-9dd3-b8917eaaab48',
    table: '01a12fe6-aec6-74f4-985e-06ecc423035d',
  },
} as const;

export const BAY = {
  scene: '01a12fe6-aec7-7d00-8f8d-736a127ed8c3',
  /** Wall-graph nodes, corner to corner. */
  node: {
    b1: '01a12fe6-aec8-764f-855b-72390ec2e33e',
    b2: '01a12fe6-aec9-718f-805b-5225870a0f26',
    b3: '01a12fe6-aeca-78ac-9733-f1c283c8bd44',
    b4: '01a12fe6-aecb-7452-84b2-4eec08c8db43',
  },
  /** Walls: the arc and the three straight sides. */
  wall: {
    bay: '01a12fe6-aecc-7533-9aab-14fca1cfd0a5',
    bayE: '01a12fe6-aecd-71f8-bc0c-c781c97a2ff6',
    bayS: '01a12fe6-aece-7f02-8da6-d79039292476',
    bayW: '01a12fe6-aecf-7899-9cec-d0d8b4bac73c',
  },
  /** The bay window and the door. */
  opening: {
    windowBay: '01a12fe6-aed0-793d-9ab6-152d00a0654c',
    doorBay: '01a12fe6-aed1-7f14-806f-e0ad20781188',
  },
  /** The one room. */
  room: {
    bayRoom: '01a12fe6-aed2-7600-b99c-333082eeff33',
  },
  /** Furniture placements. */
  asset: {
    armchair: '01a12fe6-aed3-7838-ae3f-77f4bb5c35f8',
  },
} as const;

/** Scene-local materials both plans declare in `materials[]`. */
export const PLAN_MATERIAL = {
  oak: '01a12fe6-aed4-76fe-b7ed-affaa8342b8a',
  stone: '01a12fe6-aed5-70d3-ad2d-f0d65ecef315',
  white: '01a12fe6-aed6-728d-b847-4d1a0e223032',
} as const;

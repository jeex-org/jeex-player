/**
 * Ids of the angled-openings test plan of `plan-angled-openings.ts`.
 *
 * Every id in a scene is a UUID v7 and the viewer never mints one, so a
 * fixture's ids are fixed literals generated once, offline. Each key is the
 * camel-cased readable name of the entity, so a test reads
 * `ANGLED.opening.doorDiagonal` for the door in the 30° wall.
 */

export const ANGLED = {
  scene: '01a1cf95-54c6-7383-88f1-cd18537ac851',
  /** Wall-graph nodes, named by where they sit on the drawing. */
  node: {
    southWest: '01a1cf95-54c9-712a-bc97-88ebf940e352',
    southMid: '01a1cf95-54cc-7011-84e4-174c4506df12',
    southEast: '01a1cf95-54cf-772e-9789-645669fd9dd1',
    northEast: '01a1cf95-54d2-752c-8423-a4f9b8132d38',
    northMid: '01a1cf95-54d5-7314-9d6f-a81c7a7f9efa',
    diagonalNorth: '01a1cf95-54d9-7210-866b-1b28f62c69f9',
    diagonalWest: '01a1cf95-54dc-7678-aef5-738b817bcc8c',
  },
  /** Walls: the facade ring, the 30° diagonal, the arc and the partition. */
  wall: {
    southLiving: '01a1cf95-54df-7285-9ee5-2ea1b777dcf8',
    southStudy: '01a1cf95-54e2-7561-8c03-8fac85a4722a',
    eastArc: '01a1cf95-54e5-737f-8ad8-fd08d5ed39d0',
    northStudy: '01a1cf95-54e8-729b-8776-f9e7d759069e',
    northLiving: '01a1cf95-54eb-75f2-8306-63e1a6d7287e',
    diagonal: '01a1cf95-54ee-7486-a38e-653c997cb136',
    west: '01a1cf95-54f1-76e2-a508-d1a65534f28f',
    partition: '01a1cf95-54f3-77f3-ab77-6b3eafa67730',
  },
  /** Doors and the window. */
  opening: {
    doorDiagonal: '01a1cf95-54f6-777a-b6cf-a769cb288116',
    windowDiagonal: '01a1cf95-54f9-76c5-b198-5f84b83b82da',
    doorArc: '01a1cf95-54fc-7711-ab14-a58f56974107',
    doorControl: '01a1cf95-54ff-71b5-baa2-71dca4085de2',
  },
  /** The two rooms either side of the partition. */
  room: {
    living: '01a1cf96-ecec-70fc-a131-d3b37f30a839',
    study: '01a1cf96-ecef-706b-b144-f270ae10c711',
  },
} as const;

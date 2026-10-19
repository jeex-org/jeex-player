/**
 * Ids of the three-camera flat of `tour-three-cameras.ts`.
 *
 * Every id in a scene is a UUID v7 and the viewer never mints one, so a
 * fixture's ids are fixed literals generated once, offline. Each key is the
 * camel-cased readable name of the entity, so a test reads
 * `THREE_CAMERAS.wall.wPartition` for the wall called `w-partition`.
 */

export const THREE_CAMERAS = {
  scene: '01a12fe6-aed7-76ed-91d3-86729cdac4fd',
  /** Wall-graph nodes. */
  node: {
    nSw: '01a12fe6-aed8-7640-aefc-7bae5ac61475',
    nSplit: '01a12fe6-aed9-7a76-a23b-b344f0f478ac',
    nSe: '01a12fe6-aeda-7cdf-b11a-52e29d984e7f',
    nNe: '01a12fe6-aedb-7a23-8c84-9cdf86eccc86',
    nNsplit: '01a12fe6-aedc-78a6-8009-997ee2e1c96a',
    nNw: '01a12fe6-aedd-7808-a091-93452fc79268',
  },
  /** Walls. */
  wall: {
    wLivingSouth: '01a12fe6-aede-7f56-8cf3-bd61df924dd9',
    wBedroomSouth: '01a12fe6-aedf-7a06-b9ef-3e38cf1fb30b',
    wEast: '01a12fe6-aee0-7f40-bb91-a56641fe08ac',
    wBedroomNorth: '01a12fe6-aee1-7fe7-b548-9eed3bba3f7d',
    wLivingNorth: '01a12fe6-aee2-7fa4-9ea1-7972cb22a833',
    wWest: '01a12fe6-aee3-757e-9c1f-ec3c564a90ac',
    wPartition: '01a12fe6-aee4-718b-8e14-f3042fd60f83',
  },
  /** Doors and windows. */
  opening: {
    oEntrance: '01a12fe6-aee5-7287-a51b-4f33ae609e24',
    oWindowSouth: '01a12fe6-aee6-7140-af61-d0763562c183',
    oWindowEast: '01a12fe6-aee7-7fce-9902-57ee1fe228a4',
    oDoorInner: '01a12fe6-aee8-7960-af19-e62365f6347f',
  },
  /** Rooms. */
  room: {
    living: '01a12fe6-aee9-730f-89d8-21f0fbfefd5d',
    bedroom: '01a12fe6-aeea-780c-95bf-488c472bdff9',
  },
  /** Furniture placements. */
  asset: {
    armchair1: '01a12fe6-aeeb-781c-84f8-561e76294a0b',
    bedDouble1: '01a12fe6-aeec-7550-8d44-629238da2f8a',
  },
  /** Tour cameras, in tour order. */
  checkpoint: {
    cam1: '01a12fe6-aeed-7cec-8154-81c11b844cf5',
    cam3: '01a12fe6-aeee-7d4e-a9b0-97d399c44d7e',
    cam2: '01a12fe6-aeef-70c9-b0ca-2d2f0536ecba',
  },
} as const;

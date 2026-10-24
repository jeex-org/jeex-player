/**
 * The fixed ids of the finishes this build bundles: one UUID v7 literal per
 * row of `finish-catalogue.ts` (room floors and walls) and of
 * `asset-finish-catalogue.ts` (the object bank).
 *
 * Literals, written once offline and never computed: the viewer validates ids
 * and never mints one.
 * The key is the row's display-only `slug` with `-` spelled `_`, so a
 * reference in the source reads as the finish it names (`FINISH.oak_natural`)
 * while the document carries the UUID. Nothing resolves a slug through this
 * table at runtime; a host translating a 1.x document reads
 * `CATALOGUE_ID_BY_SLUG` (`assets/catalogue-slugs.ts`), which is derived from
 * the rows themselves.
 *
 * Pure data: no imports, no `three`, no DOM.
 */
export const FINISH = {
  // Room floors (`FLOOR_FINISHES`).
  oak: '01a12fdf-158e-7748-adfe-d397dde469ba',
  walnut: '01a12fdf-158f-702d-8070-693ed21d3b05',
  ash: '01a12fdf-1590-7754-92f4-5912a4ff24a2',
  teak: '01a12fdf-1591-7e42-b45b-22367fa2faec',
  chevron: '01a12fdf-1592-7088-8910-32f02da0d875',
  terrazzo: '01a12fdf-1593-72d2-a5f9-a56d9c522980',
  stone: '01a12fdf-1594-715c-a2ec-7257f0ac0434',
  ceramic_light: '01a12fdf-1595-71e8-be84-9227216ac42d',
  ceramic_graphite: '01a12fdf-1596-7992-9061-a9a730fd7840',
  // Room walls (`WALL_FINISHES`).
  sand: '01a12fdf-1597-7e0c-8b3e-f091fb6af634',
  white: '01a12fdf-1598-7b82-807b-83d8a5effde3',
  sage: '01a12fdf-1599-7b1d-99dd-48f13cb98f0a',
  terra: '01a12fdf-159a-7c53-a64b-b1a9506f20b7',
  graphite: '01a12fdf-159b-71b5-8b10-01d372c4c14b',
  wallpaper_cream: '01a12fdf-159c-78e6-97c2-8b635635ce85',
  wallpaper_sage: '01a12fdf-159d-770d-b5ab-64b41de36f30',
  tiles_white: '01a12fdf-159e-7413-8248-0060d7df7693',
  // Object-bank finishes (`asset-finish-catalogue.ts`).
  oak_natural: '01a12fdf-159f-719f-87ad-8a1ab59bb73b',
  walnut_dark: '01a12fdf-15a0-7bba-ab44-242ca5f929f4',
  ash_black: '01a12fdf-15a1-7b5c-b00f-fce6e2c0bdfa',
  teak_honey: '01a12fdf-15a2-769c-b675-682a6e58918f',
  linen_sand: '01a12fdf-15a3-754d-84de-9b7d9ba71dec',
  wool_charcoal: '01a12fdf-15a4-7844-a812-199b92eabeb9',
  boucle_ivory: '01a12fdf-15a5-7a14-a461-cb53f215c9fc',
  velvet_terracotta: '01a12fdf-15a6-7a82-8165-bc5d039f985b',
  wool_sage: '01a12fdf-15a7-79e4-adea-3436d6a6d0a7',
  wool_navy: '01a12fdf-15a8-7c2a-8a6e-7222605384bf',
  leather_tan: '01a12fdf-15a9-70ca-9f26-2a1243068029',
  plaster_white: '01a12fdf-15aa-7d0e-97e3-bb2102d2e0bb',
  lacquer_sage: '01a12fdf-15ab-79df-a670-e7689fccd216',
  lacquer_clay: '01a12fdf-15ac-76d7-ab6a-c1c61a95c0f2',
  lacquer_ink: '01a12fdf-15ad-77ec-a300-bea9c3162e26',
  lacquer_navy: '01a12fdf-15ae-7dd0-b73d-08201d40d174',
  lacquer_cream: '01a12fdf-15af-7a72-8388-d525ab932a99',
  stone_carrara: '01a12fdf-15b0-7eaa-b46d-2bb736b63780',
  stone_basalt: '01a12fdf-15b1-7e39-a96b-10ae77aa44e7',
  ceramic_white: '01a12fdf-15b2-7759-b83c-1ce513021bd1',
  tile_sage: '01a12fdf-15b3-72a0-ab00-60f425680595',
  tile_white: '01a12fdf-15b4-73e7-b4b3-cec26ff06bde',
  steel_brushed: '01a12fdf-15b5-7377-8f9e-98e0d5b4f528',
  brass_soft: '01a12fdf-15b6-76c5-af5e-c1c12b365e9d',
  chrome_polished: '01a12fdf-15b7-7ccf-a970-f83d3981e188',
  metal_ink: '01a12fdf-15b8-74f8-89da-935f45491220',
  glass_clear: '01a12fdf-15b9-7cdd-919f-5458f20d9db1',
  glass_smoke: '01a12fdf-15ba-7087-824d-158afde43901',
  mirror_silver: '01a12fdf-15bb-7f56-b4a5-fd4225fc161d',
  screen_dark: '01a12fdf-15bc-76cf-8150-ada92a4e1414',
  screen_tv: '01a16b46-d610-712b-ae1f-43b17c76871f',
  shade_ivory: '01a12fdf-15bd-7baf-87cd-2d38bb111d05',
  shade_ink: '01a12fdf-15be-77dd-9224-13798dca3241',
  shade_opal: '01a12fdf-15bf-70ca-af78-799920d12687',
  lamp_warm: '01a12fdf-15c0-7b25-94b6-bd6fbe4dc9c9',
  terracotta_pot: '01a12fdf-15c1-7c5b-958d-9867a8e2ce90',
  soil_dark: '01a12fdf-15c2-7aeb-971f-5a3e96b7a141',
  foliage_green: '01a12fdf-15c3-7398-bd05-d589f0468ad6',
  foliage_deep: '01a12fdf-15c4-7117-aca7-46a2625e08e6',
  foliage_palm: '01a12fdf-15c5-78b8-84b8-e13a4919d192',
  foliage_palm_deep: '01a12fdf-15c6-7187-b4ed-3b46b91bbb84',
  bark_grey: '01a12fdf-15c7-7bd0-a25c-58c4996798ce',
  rattan_natural: '01a12fdf-15c8-77c3-9251-3b2a6ce04dbd',
  ceramic_cream_gloss: '01a12fdf-15c9-7fa9-b374-453ea5720f60',
  clay_taupe: '01a12fdf-15ca-71ee-8ed8-0ecdb6ff72e9',
  pebble_light: '01a12fdf-15cb-797d-97d5-eeb79626d766',
  rug_wool_sand: '01a12fdf-15cc-784a-a6f2-dc391fbed88f',
  rug_wool_ink: '01a12fdf-15cd-7904-baec-cfb752cf5ae6',
  rug_wool_clay: '01a12fdf-15ce-70a7-8d19-ff2f44eee04f',
  paper_cream: '01a12fdf-15cf-7196-980c-93f2245210a5',
  pigment_clay: '01a12fdf-15d0-70c2-a067-cd557597f995',
  pigment_sage: '01a12fdf-15d1-72ad-b36f-a6c843f7e49a',
  pigment_ochre: '01a12fdf-15d2-7171-95fd-052be28332de',
  pigment_indigo: '01a12fdf-15d3-7d4e-9078-e581aba5e6ae',
} as const;

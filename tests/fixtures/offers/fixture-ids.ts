/**
 * The ids of the committed offers fixture (`tests/fixtures/offers/`), as named
 * constants: an extra library in the project-library format (`library.json`)
 * and a bare scene that places two of its objects (`scene.json`). Fixed UUID v7
 * literals, written once offline.
 */

export const OFFERS_FIXTURE = {
  library: '01a1f5aa-1000-7308-9743-2d1026706d7e',
  material: { walnut: '01a1f5aa-1002-7c29-a621-79273c8eb5bb' },
  asset: {
    longSofa: '01a1f5aa-1003-7682-975e-c87a171ac826',
    hallBench: '01a1f5aa-1004-7a6f-be48-478dcb74f213',
    budVase: '01a1f5aa-1005-745d-8cce-8038a39d5e08',
    tableLamp: '01a1f5aa-1007-7f24-9f58-d669cbee3772',
  },
  variant: {
    longSofa: [
      '01a1f5aa-1010-74d4-89b1-b673bd4755d0',
      '01a1f5aa-1011-75ad-9853-c1f76eb97706',
      '01a1f5aa-1012-7ca8-88bc-a0385813dbad',
      '01a1f5aa-1013-73c6-a1d0-6bd2aa399dac',
      '01a1f5aa-1014-7946-bc59-c0996daeee6f',
      '01a1f5aa-1015-7529-a279-764017f2ed6c',
      '01a1f5aa-1016-7fc7-903d-75e173e4eaed',
      '01a1f5aa-1017-7e5f-b878-f78e2978aa24',
      '01a1f5aa-1018-747c-962d-daed16dc0cf0',
      '01a1f5aa-1019-7b9c-b7f7-8df0cac5e40c',
      '01a1f5aa-101a-702d-9e51-8ca6eaac8d82',
      '01a1f5aa-101b-7f01-a721-0760474f36e8',
      '01a1f5aa-101c-7b53-9930-9cc6273931bd',
      '01a1f5aa-101d-7b2a-8df3-dbe4d58fed8a',
      '01a1f5aa-101e-7728-b7ec-a0fa5f6b8a88',
      '01a1f5aa-101f-7062-9df7-ffe0297c79bf',
      '01a1f5aa-1020-7bda-ae89-8736a3566f89',
      '01a1f5aa-1021-7369-9b59-0481194f309f',
      '01a1f5aa-1022-7fea-918f-32cf21449273',
      '01a1f5aa-1023-7d7c-be9d-913668257525',
    ],
    hallBench: '01a1f5aa-1009-7fd6-83db-dde131ca3766',
    budVase: '01a1f5aa-1006-7539-94b5-0af03b971722',
    tableLamp: '01a1f5aa-1008-7a07-9021-721a278f64f7',
  },
  scene: '01a1f5aa-100b-7c15-b0c8-e9df469611a1',
  placement: { sofa: '01a1f5aa-100c-71f5-8252-27c3712da86a', vase: '01a1f5aa-100d-778c-99ea-20e32684b27b' },
} as const;

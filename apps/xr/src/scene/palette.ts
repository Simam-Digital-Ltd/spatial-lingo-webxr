/**
 * One place for every colour in the simulated scene.
 *
 * The Unity original got its look from authored materials in the project's
 * art directory. Nothing in that pipeline survives the port — WebXR has no
 * equivalent of a `.mat` asset — so the WebXR build rebuilds the palette in
 * code. Keeping it in a single module means the whole room can be re-themed
 * without touching geometry, which is what the migration guide recommends in
 * place of Unity's material assignment workflow.
 */
export const PALETTE = {
  floor: 0xb98a5e,
  floorTrim: 0x8a6340,
  wall: 0xe6dac6,
  wallShadowed: 0xd8cab3,
  ceiling: 0xf3ede2,
  rug: 0xc9705c,

  wood: 0x9c6b45,
  woodDark: 0x6f4a2f,
  brass: 0xd6b06a,

  couch: 0x4e7d78,
  couchCushion: 0x5f918b,
  cushionAccent: 0xe0a458,

  fabricLight: 0xf1ece2,
  fabricCool: 0xdbe4ec,

  screenBody: 0x23262e,
  screenGlow: 0x3f8fd2,

  lampShade: 0xf2d68b,
  bulb: 0xfff3cf,

  pot: 0xb5603f,
  foliage: 0x4f7f3d,
  foliageLight: 0x6a9c4f,

  glass: 0xbfe3ff,
  canvasArt: 0x6b8fb5,

  bark: 0x8a5a3b,
  leafYoung: 0x7fbf5a,
  leafMature: 0x3f8f3a,
  berry: 0xe4574f,
} as const;

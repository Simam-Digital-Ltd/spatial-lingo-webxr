import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';

import { PALETTE } from './palette.js';

/**
 * The desktop showroom: a dollhouse-style apartment corner with an open front
 * wall, so the whole space is visible from an orbiting camera.
 *
 * This exists only for Tier 4 (a browser with no WebXR at all). On a headset
 * the learner's own room *is* the scene, and drawing an opaque shell would
 * black out the passthrough view they are supposed to be learning from. That
 * is why the room shell and the prop layout are separate modules: Tier 3 uses
 * the props on a floating arc with no shell, Tier 4 uses both.
 */

export const ROOM_WIDTH = 8;
export const ROOM_DEPTH = 8;
export const ROOM_HEIGHT = 2.8;

/**
 * The floor and ceiling are built larger than the room and pushed forward
 * through the open wall, because the camera orbits from outside that opening.
 *
 * Sized to the room exactly, the floor's front edge lands mid-frame with empty
 * background below it, and on a tall portrait phone the camera sees straight
 * over the ceiling's front edge into the void above. Extending both towards
 * the camera closes the view without closing the wall the learner looks
 * through.
 */
const SLAB_WIDTH = 11;
const SLAB_DEPTH = 13;
const SLAB_CENTRE_Z = 1.6;

const WALL_THICKNESS = 0.16;

/** Where each prop stands in the showroom, and which way it faces. */
export interface PropPlacement {
  x: number;
  y: number;
  z: number;
  /** Rotation about Y in radians. Props are authored facing +Z. */
  rotationY: number;
}

/**
 * Fixed layout for the showroom.
 *
 * Hand-placed rather than generated: an auto-arranged room reliably produces
 * a couch facing a wall. Labels absent from this table have no floor position
 * because they are room surfaces, and come from `buildRoomShell` instead.
 */
export const ROOM_LAYOUT: Record<string, PropPlacement> = {
  // Seating on the left, screen on the right, both turned inwards across the
  // rug. The obvious arrangement — couch at the back, screen at the front
  // facing it — puts the screen between the camera and the entire room.
  couch: { x: -2.5, y: 0, z: 0.3, rotationY: Math.PI / 2 },
  table: { x: 0.1, y: 0, z: 0.4, rotationY: 0 },
  screen: { x: 3.35, y: 0, z: 0.3, rotationY: -Math.PI / 2 },
  lamp: { x: -3.15, y: 0, z: -2.5, rotationY: 0 },
  plant: { x: 1.9, y: 0, z: -3.2, rotationY: 0 },
  shelf: { x: 0.6, y: 0, z: -3.6, rotationY: 0 },
  bed: { x: 2.85, y: 0, z: 2.5, rotationY: -Math.PI / 2 },
  door: { x: 2.7, y: 0, z: -3.88, rotationY: 0 },
  window: { x: -3.88, y: 0, z: -1.0, rotationY: Math.PI / 2 },
  'wall art': { x: -1.7, y: 1.62, z: -3.86, rotationY: 0 },
};

/**
 * Where the language tree stands.
 *
 * Front-left, on open floor rather than tucked into a corner: it is the
 * learner's progress made physical, so it has to be visible from the default
 * camera without hunting for it.
 */
export const TREE_POSITION = { x: -2.85, y: 0, z: 2.4 };

/**
 * Height above a prop's own top at which its floating word label sits.
 *
 * Wall-mounted props get a smaller offset: a label a full 30 cm above a
 * picture frame ends up embedded in the ceiling.
 */
export const LABEL_CLEARANCE: Record<string, number> = {
  'wall art': 0.12,
  window: 0.1,
  door: 0.08,
};

export const DEFAULT_LABEL_CLEARANCE = 0.22;

export interface RoomShell {
  /** Non-interactive dressing: side walls, skirting, rug. */
  decor: Group;
  /**
   * The clickable surfaces, keyed by semantic label. These are the room's own
   * geometry rather than free-standing props, which is exactly how a headset
   * reports them: `floor`, `ceiling`, and `wall` arrive as scene-mesh planes,
   * not as objects sitting in the room.
   *
   * They are deliberately left out of `decor` so the caller can register each
   * one as its own entity. A mesh can only have one parent, and an entity's
   * `object3D` has to be the thing the raycaster hits.
   */
  surfaces: Record<string, Mesh>;
}

function slab(
  width: number,
  height: number,
  depth: number,
  color: number,
  roughness = 0.95,
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(width, height, depth),
    new MeshStandardMaterial({ color, roughness }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

/** Builds the floor, ceiling, three walls, skirting, and rug. */
export function buildRoomShell(): RoomShell {
  const object = new Group();

  const floor = slab(SLAB_WIDTH, WALL_THICKNESS, SLAB_DEPTH, PALETTE.floor, 0.8);
  floor.position.set(0, -WALL_THICKNESS / 2, SLAB_CENTRE_Z);

  const ceiling = slab(SLAB_WIDTH, WALL_THICKNESS, SLAB_DEPTH, PALETTE.ceiling);
  ceiling.position.set(0, ROOM_HEIGHT + WALL_THICKNESS / 2, SLAB_CENTRE_Z);

  const backWall = slab(ROOM_WIDTH, ROOM_HEIGHT, WALL_THICKNESS, PALETTE.wall);
  backWall.position.set(0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2);

  const leftWall = slab(WALL_THICKNESS, ROOM_HEIGHT, ROOM_DEPTH, PALETTE.wallShadowed);
  leftWall.position.set(-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0);

  const rightWall = slab(WALL_THICKNESS, ROOM_HEIGHT, ROOM_DEPTH, PALETTE.wallShadowed);
  rightWall.position.set(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0);

  // Skirting board along the two walls the camera sees most. Purely cosmetic,
  // but the hard floor/wall junction is the single thing that most makes a
  // primitive room read as a grey-box test level.
  const skirtBack = slab(ROOM_WIDTH, 0.12, 0.05, PALETTE.fabricLight);
  skirtBack.position.set(0, 0.06, -ROOM_DEPTH / 2 + WALL_THICKNESS / 2 + 0.025);
  const skirtLeft = slab(0.05, 0.12, ROOM_DEPTH, PALETTE.fabricLight);
  skirtLeft.position.set(-ROOM_WIDTH / 2 + WALL_THICKNESS / 2 + 0.025, 0.06, 0);
  const skirtRight = slab(0.05, 0.12, ROOM_DEPTH, PALETTE.fabricLight);
  skirtRight.position.set(ROOM_WIDTH / 2 - WALL_THICKNESS / 2 - 0.025, 0.06, 0);

  const rug = slab(3.4, 0.02, 2.6, PALETTE.rug, 1);
  rug.position.set(0.1, 0.012, 0.3);

  object.add(leftWall, rightWall, skirtBack, skirtLeft, skirtRight, rug);

  return {
    decor: object,
    surfaces: { floor, ceiling, wall: backWall },
  };
}

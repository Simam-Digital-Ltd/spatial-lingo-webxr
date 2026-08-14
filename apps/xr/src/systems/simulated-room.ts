import { BoxGeometry, createSystem, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import type { LessonPack } from '@spatial-lingo/core';
import { LessonTarget } from '../components/lesson-target.js';

const ARC_RADIUS = 2.5;
const ARC_SPAN = Math.PI * 0.8;
const BOX_SIZE = 0.4;

/** A single stand-in box's world-space X/Z offset from the player. */
export interface ArcPosition {
  x: number;
  z: number;
}

/**
 * Pure placement maths for the simulated room: lay out `count` positions
 * along an arc in front of the player.
 *
 * Kept standalone (no Three.js, no IWSDK) so it is testable without a World.
 *
 * @param count Number of positions to place. `<= 0` yields an empty array.
 * @param radius Arc radius in meters.
 * @param span Arc angular span in radians, centered in front of the player.
 */
export function arcPositions(
  count: number,
  radius: number = ARC_RADIUS,
  span: number = ARC_SPAN,
): ArcPosition[] {
  if (count <= 0) return [];

  const positions: ArcPosition[] = [];
  for (let index = 0; index < count; index++) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angle = -span / 2 + t * span;
    positions.push({ x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius });
  }
  return positions;
}

/**
 * Spawns stand-in box entities when no real scene mesh is available.
 *
 * Tiers 3 and 4 depend on this: a WebXR headset without mesh detection, and a
 * plain desktop browser with no WebXR at all, both need something to point
 * at. Keeping the desktop path playable is what lets a reviewer try the
 * project without a headset. Both this system and `SceneLabelSystem` produce
 * entities carrying `LessonTarget`, so everything downstream is tier-agnostic.
 */
export class SimulatedRoomSystem extends createSystem({}) {
  spawn(pack: LessonPack, count: number): void {
    const entries = pack.entries.slice(0, count);
    const positions = arcPositions(entries.length);
    const geometry = new BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);

    entries.forEach((entry, index) => {
      const position = positions[index];
      if (!position) return;

      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x4a9eff }));
      mesh.position.set(position.x, 1.2, position.z);

      // Uses World.createTransformEntity rather than a bare createEntity() +
      // manual object3D assignment: it wires the Transform/Visibility
      // components and parents the mesh under the active level automatically,
      // matching how every other renderable entity in this app is created.
      const entity = this.world.createTransformEntity(mesh);
      entity.addComponent(LessonTarget, {
        label: entry.label,
        word: entry.word,
        learned: false,
      });
      console.info('[spatial-lingo] simulated target:', entry.label, '->', entry.word);
    });

    console.info('[spatial-lingo] simulated room spawned', entries.length, 'stand-in target(s)');
  }
}

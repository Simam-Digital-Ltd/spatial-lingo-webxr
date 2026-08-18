import { Box3, createSystem } from '@iwsdk/core';
import type { LessonPack } from '@spatial-lingo/core';
import { LessonTarget } from '../components/lesson-target.js';
import { WordLabel } from '../scene/labels.js';
import { buildProp, fitTo } from '../scene/props.js';

const ARC_RADIUS = 2.5;
const ARC_SPAN = Math.PI * 0.8;

/** Largest dimension a floating prop is scaled to, in metres. */
const PROP_SIZE = 0.55;

/** Height of the arc above the floor, in metres — roughly waist to chest height. */
const ARC_HEIGHT = 1.0;

/** A single stand-in prop's world-space X/Z offset from the player. */
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
  readonly #labels = new Map<string, WordLabel>();

  spawn(pack: LessonPack, count: number): void {
    const entries = pack.entries.slice(0, count);
    const positions = arcPositions(entries.length);
    let placed = 0;

    entries.forEach((entry, index) => {
      const position = positions[index];
      if (!position) return;

      // The same procedural props the desktop showroom uses, scaled down and
      // floated at eye level. A headset in this tier is showing passthrough of
      // the learner's real room, so there is no shell around them — just the
      // objects, hanging in their actual space.
      const prop = buildProp(entry.label);
      if (!prop) return;
      fitTo(prop, PROP_SIZE);
      prop.position.x = position.x;
      prop.position.z = position.z;
      prop.position.y += ARC_HEIGHT;
      // Turn each prop to face the learner standing at the arc's centre.
      prop.rotation.y = Math.atan2(position.x, position.z) + Math.PI;

      // Uses World.createTransformEntity rather than a bare createEntity() +
      // manual object3D assignment: it wires the Transform/Visibility
      // components and parents the mesh under the active level automatically,
      // matching how every other renderable entity in this app is created.
      const entity = this.world.createTransformEntity(prop);
      entity.addComponent(LessonTarget, {
        label: entry.label,
        word: entry.word,
        learned: false,
      });

      prop.updateMatrixWorld(true);
      const top = new Box3().setFromObject(prop).max.y;
      const wordLabel = new WordLabel({
        word: entry.word,
        article: entry.article,
        label: entry.label,
      });
      wordLabel.sprite.position.set(position.x, top + 0.18, position.z);
      this.world.createTransformEntity(wordLabel.sprite);
      this.#labels.set(entry.label, wordLabel);

      placed += 1;
    });

    console.info('[spatial-lingo] simulated room spawned', placed, 'stand-in target(s)');
  }

  /** Reveals the target-language word above a stand-in prop. */
  reveal(label: string): void {
    this.#labels.get(label)?.reveal();
  }
}

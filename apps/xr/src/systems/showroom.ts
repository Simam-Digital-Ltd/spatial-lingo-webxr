import {
  Box3,
  createSystem,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { progressionFor, type LessonPack, type TreeTier } from '@spatial-lingo/core';

import { LessonTarget } from '../components/lesson-target.js';
import { WordLabel } from '../scene/labels.js';
import { buildProp } from '../scene/props.js';
import {
  buildRoomShell,
  DEFAULT_LABEL_CLEARANCE,
  LABEL_CLEARANCE,
  ROOM_LAYOUT,
  TREE_POSITION,
} from '../scene/room.js';
import { createLanguageTree, LanguageTree } from '../scene/tree.js';

/**
 * Builds and owns the browser-only showroom: the room shell, the furniture,
 * every floating word label, and the language tree.
 *
 * This is the Tier 4 experience — a plain browser with no WebXR at all. It has
 * to stand on its own, because it is the only version of the app most people
 * who open the link will ever see. Everything downstream of it (selection, the
 * lesson machine, scoring, progression) is the same code the headset runs; the
 * only difference is where the tagged objects came from.
 */

/** Emissive boost applied to a prop's materials while it is hovered. */
const HOVER_EMISSIVE = 0.22;

interface TargetVisual {
  label: string;
  object: Object3D;
  wordLabel: WordLabel;
  /** Materials touched by the hover treatment, with their original emissive. */
  highlights: { material: MeshStandardMaterial; emissive: number; intensity: number }[];
}

export class ShowroomSystem extends createSystem({}) {
  readonly #visuals = new Map<string, TargetVisual>();
  /** Everything created by `build`, so `teardown` can undo it exactly. */
  readonly #entities: Entity[] = [];
  readonly #roots: Object3D[] = [];
  #tree: LanguageTree | null = null;
  #hovered: string | null = null;
  #built = false;

  /**
   * Build the whole room and register a `LessonTarget` entity per vocabulary
   * entry that has something to point at.
   *
   * Entries with no prop and no room surface are skipped rather than given a
   * placeholder cube — see `buildProp` for why a fallback shape would be worse
   * than an honest omission. Returns the labels that were actually placed.
   */
  build(pack: LessonPack): string[] {
    if (this.#built) return [...this.#visuals.keys()];
    this.#built = true;

    const shell = buildRoomShell();
    this.#track(this.world.createTransformEntity(shell.decor), shell.decor);

    const placed: string[] = [];

    for (const entry of pack.entries) {
      const surface = shell.surfaces[entry.label];
      const placement = ROOM_LAYOUT[entry.label];

      let object: Object3D | null = null;
      let labelAnchor = new Vector3();

      if (placement) {
        const prop = buildProp(entry.label);
        if (!prop) continue;
        prop.position.set(placement.x, placement.y, placement.z);
        prop.rotation.y = placement.rotationY;
        object = prop;
        labelAnchor = this.#labelAnchorFor(prop, entry.label);
      } else if (surface) {
        // Room surfaces come back from `buildRoomShell` unparented precisely
        // so they can become entities here. Their label floats at a fixed spot
        // rather than above their bounding box: a label centred over the
        // floor's bounds would sit in the exact middle of the room, buried in
        // whatever furniture is standing there.
        object = surface;
        labelAnchor = this.#surfaceLabelAnchor(entry.label);
      }

      if (!object) continue;

      const wordLabel = new WordLabel({
        word: entry.word,
        article: entry.article,
        label: entry.label,
      });
      wordLabel.sprite.position.copy(labelAnchor);
      // Parented to the scene rather than to the prop, so a rotated prop does
      // not carry its label around with it into a wall.
      this.#track(this.world.createTransformEntity(wordLabel.sprite), wordLabel.sprite);

      const entity = this.#track(this.world.createTransformEntity(object), object);
      entity.addComponent(LessonTarget, {
        label: entry.label,
        word: entry.word,
        learned: false,
      });

      this.#visuals.set(entry.label, {
        label: entry.label,
        object,
        wordLabel,
        highlights: collectHighlights(object),
      });
      placed.push(entry.label);
    }

    const { tree, object: treeObject } = createLanguageTree();
    treeObject.position.set(TREE_POSITION.x, TREE_POSITION.y, TREE_POSITION.z);
    this.#track(this.world.createTransformEntity(treeObject), treeObject);
    this.#tree = tree;

    console.info('[spatial-lingo] showroom placed', placed.length, 'targets:', placed.join(', '));
    return placed;
  }

  /** Applies the hover treatment to `label`, clearing it from whatever had it. */
  setHovered(label: string | null): void {
    if (label === this.#hovered) return;
    if (this.#hovered) this.#applyHover(this.#hovered, false);
    this.#hovered = label;
    if (label) this.#applyHover(label, true);
  }

  /** Reveals the target-language word on a target's floating label. */
  reveal(label: string): void {
    this.#visuals.get(label)?.wordLabel.reveal();
  }

  /** Grows the language tree to the tier implied by `learnedCount`. */
  setLearnedCount(learnedCount: number): void {
    const tier: TreeTier = progressionFor(learnedCount).tier;
    this.#tree?.setTier(tier);
  }

  update(delta: number): void {
    this.#tree?.update(delta);
  }

  /**
   * Remove the entire showroom from the world.
   *
   * Called when an immersive session starts on a headset-capable browser. The
   * showroom is the flat preview shown before entering XR; leaving it up would
   * wall the learner inside an opaque virtual room, blocking the passthrough
   * view of the real room the lesson is actually about — and its props would
   * still answer raycasts, so a click could start a lesson on a couch that is
   * no longer visible.
   */
  teardown(): void {
    if (!this.#built) return;
    this.#built = false;
    this.setHovered(null);

    for (const entity of this.#entities) entity.destroy();
    this.#entities.length = 0;

    for (const root of this.#roots) root.removeFromParent();
    this.#roots.length = 0;

    for (const visual of this.#visuals.values()) visual.wordLabel.dispose();
    this.#visuals.clear();

    this.#tree?.dispose();
    this.#tree = null;
  }

  #track(entity: Entity, object: Object3D): Entity {
    this.#entities.push(entity);
    this.#roots.push(object);
    return entity;
  }

  #applyHover(label: string, on: boolean): void {
    const visual = this.#visuals.get(label);
    if (!visual) return;
    visual.wordLabel.setHighlighted(on);
    for (const entry of visual.highlights) {
      if (on) {
        entry.material.emissive.setHex(0xffffff);
        entry.material.emissiveIntensity = HOVER_EMISSIVE;
      } else {
        entry.material.emissive.setHex(entry.emissive);
        entry.material.emissiveIntensity = entry.intensity;
      }
    }
  }

  #labelAnchorFor(prop: Object3D, label: string): Vector3 {
    // The prop has to be in its final transform before this runs, because
    // Box3.setFromObject works in world space.
    prop.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(prop);
    const clearance = LABEL_CLEARANCE[label] ?? DEFAULT_LABEL_CLEARANCE;
    const centre = bounds.getCenter(new Vector3());
    return new Vector3(centre.x, bounds.max.y + clearance, centre.z);
  }

  #surfaceLabelAnchor(label: string): Vector3 {
    switch (label) {
      case 'floor':
        return new Vector3(0.6, 0.34, 2.6);
      case 'ceiling':
        return new Vector3(0.4, 2.5, 0.6);
      default:
        return new Vector3(-3.1, 2.24, -3.7);
    }
  }
}

/**
 * Collect the materials a hover highlight should touch, remembering what their
 * emissive was set to first.
 *
 * Restoring the recorded value rather than resetting to black matters for the
 * props that are emissive by design — the lamp bulb, the TV panel, the window
 * pane would all go dark the first time the pointer left them.
 */
function collectHighlights(
  object: Object3D,
): { material: MeshStandardMaterial; emissive: number; intensity: number }[] {
  const collected: { material: MeshStandardMaterial; emissive: number; intensity: number }[] = [];
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const material = child.material;
    if (material instanceof MeshStandardMaterial) {
      collected.push({
        material,
        emissive: material.emissive.getHex(),
        intensity: material.emissiveIntensity,
      });
    }
  });
  return collected;
}

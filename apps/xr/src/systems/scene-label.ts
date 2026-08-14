import { createSystem, XRMesh } from '@iwsdk/core';
import { findEntry, type LessonPack } from '@spatial-lingo/core';
import { LessonTarget } from '../components/lesson-target.js';

/**
 * Tags detected scene meshes that we have a word for.
 *
 * Replaces the Unity original's camera + YOLO detection path with WebXR
 * scene-understanding semantic labels. Fewer object classes, but zero inference
 * cost and no camera permission required.
 *
 * `global mesh` (the room shell reconstruction) is excluded by construction:
 * IWSDK's SceneUnderstandingSystem reports it with `isBounded3D: false`, and
 * the `isBounded` guard below rejects it before the vocabulary lookup ever
 * runs — it never becomes a `LessonTarget` regardless of what is in the pack.
 */
export class SceneLabelSystem extends createSystem({
  meshes: { required: [XRMesh] },
}) {
  #pack: LessonPack | null = null;

  setPack(pack: LessonPack): void {
    this.#pack = pack;
  }

  init(): void {
    this.queries.meshes.subscribe('qualify', (entity) => {
      const pack = this.#pack;
      if (!pack) return;

      const isBounded = entity.getValue(XRMesh, 'isBounded3D');
      if (!isBounded) return;

      const label = entity.getValue(XRMesh, 'semanticLabel');
      if (typeof label !== 'string' || label.length === 0) return;

      const entry = findEntry(pack, label);
      if (!entry) return;

      entity.addComponent(LessonTarget, {
        label: entry.label,
        word: entry.word,
        learned: false,
      });
      console.info('[spatial-lingo] lesson target:', label, '->', entry.word);
    });
  }
}

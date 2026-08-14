import { createSystem, type Entity, XRMesh } from '@iwsdk/core';
import { findEntry, type LessonPack } from '@spatial-lingo/core';
import { LessonTarget } from '../components/lesson-target.js';

/** The lesson-target fields we derive for a mesh, or null if it isn't one. */
export interface ResolvedLessonTarget {
  label: string;
  word: string;
}

/**
 * Pure decision: given a mesh's boundedness and semantic label, and the
 * currently loaded pack, should this mesh become a lesson target — and with
 * what word?
 *
 * `global mesh` (the room shell reconstruction) is excluded by construction:
 * IWSDK's SceneUnderstandingSystem reports it with `isBounded3D: false`, and
 * the `isBounded` guard here rejects it before the vocabulary lookup ever
 * runs — it never becomes a `LessonTarget` regardless of what is in the pack.
 */
export function resolveLessonTarget(
  isBounded: boolean,
  semanticLabel: unknown,
  pack: LessonPack | null,
): ResolvedLessonTarget | null {
  if (!isBounded) return null;
  if (!pack) return null;
  if (typeof semanticLabel !== 'string' || semanticLabel.length === 0) return null;

  const entry = findEntry(pack, semanticLabel);
  if (!entry) return null;

  return { label: entry.label, word: entry.word };
}

/**
 * Tags detected scene meshes that we have a word for.
 *
 * Replaces the Unity original's camera + YOLO detection path with WebXR
 * scene-understanding semantic labels. Fewer object classes, but zero inference
 * cost and no camera permission required.
 */
export class SceneLabelSystem extends createSystem({
  meshes: { required: [XRMesh] },
}) {
  #pack: LessonPack | null = null;
  #tagGuard: (() => boolean) | null = null;

  /**
   * Loads the active lesson pack and immediately tags any meshes that
   * qualified before the pack was available. `queries.meshes.subscribe`
   * does not replay already-qualified entities, so without this sweep a
   * mesh detected ahead of an async pack load would be dropped forever.
   */
  setPack(pack: LessonPack): void {
    this.#pack = pack;
    for (const entity of this.queries.meshes.entities) {
      this.#tagEntity(entity);
    }
  }

  /**
   * Installs a predicate consulted right before a mesh is tagged. Used by
   * `main.ts` to veto tagging once the Tier 2 room-scan fallback has already
   * committed to the simulated room, so a late-arriving real mesh can never
   * combine with the stand-in boxes. Absent a guard, tagging is unrestricted.
   */
  setTagGuard(guard: () => boolean): void {
    this.#tagGuard = guard;
  }

  init(): void {
    this.queries.meshes.subscribe('qualify', (entity) => this.#tagEntity(entity));
  }

  #tagEntity(entity: Entity): void {
    if (entity.hasComponent(LessonTarget)) return;

    const isBounded = entity.getValue(XRMesh, 'isBounded3D') === true;
    const label = entity.getValue(XRMesh, 'semanticLabel');
    const target = resolveLessonTarget(isBounded, label, this.#pack);
    if (!target) return;
    if (this.#tagGuard && !this.#tagGuard()) return;

    entity.addComponent(LessonTarget, {
      label: target.label,
      word: target.word,
      learned: false,
    });
    console.info('[spatial-lingo] lesson target:', target.label, '->', target.word);
  }
}

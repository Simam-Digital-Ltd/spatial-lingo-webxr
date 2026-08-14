import { createSystem, Raycaster, Vector2 } from '@iwsdk/core';
import { LessonTarget } from '../components/lesson-target.js';

/**
 * Turns a pointer or controller ray into a lesson target selection.
 *
 * Unity used the Interaction SDK's poke and ray interactors. IWSDK exposes
 * input through `this.input`, but the XR controller ray path
 * (`@iwsdk/xr-input`'s `RayPointer`) is internal machinery built on
 * `@pmndrs/pointer-events` with no documented way to pull a plain
 * `intersectObject`-style result out of it from the public typings alone.
 * Wiring it up here would mean guessing at an undocumented API, which this
 * task explicitly says not to do — see the report for the full reasoning.
 * So this system only implements the desktop mouse path, which is what
 * keeps Tier 4 playable and is enough to exercise the full lesson loop.
 */
export class TargetSelectionSystem extends createSystem({
  targets: { required: [LessonTarget] },
}) {
  #raycaster = new Raycaster();
  #pointer = new Vector2();
  #onSelect: ((label: string) => void) | null = null;

  onSelect(handler: (label: string) => void): void {
    this.#onSelect = handler;
  }

  init(): void {
    window.addEventListener('pointerdown', (event) => {
      this.#pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.#pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
      this.#raycaster.setFromCamera(this.#pointer, this.camera);
      this.#pick();
    });
  }

  #pick(): void {
    for (const entity of this.queries.targets.entities) {
      const object = entity.object3D;
      if (!object) continue;
      if (this.#raycaster.intersectObject(object, true).length > 0) {
        const label = entity.getValue(LessonTarget, 'label');
        if (typeof label === 'string' && label.length > 0) this.#onSelect?.(label);
        return;
      }
    }
  }
}

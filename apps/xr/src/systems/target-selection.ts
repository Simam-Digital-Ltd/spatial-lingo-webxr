import { createSystem, Raycaster, Vector2 } from '@iwsdk/core';
import { LessonTarget } from '../components/lesson-target.js';

/**
 * Turns a pointer ray into a lesson target hover or selection.
 *
 * Unity used the Interaction SDK's poke and ray interactors. IWSDK exposes
 * input through `this.input`, but the XR controller ray path
 * (`@iwsdk/xr-input`'s `RayPointer`) is internal machinery built on
 * `@pmndrs/pointer-events` with no documented way to pull a plain
 * `intersectObject`-style result out of it from the public typings alone. So
 * this system implements the desktop pointer path only, which is what keeps
 * Tier 4 playable and is enough to exercise the full lesson loop.
 *
 * Selection fires on pointer *up*, not down, and only when the pointer barely
 * moved. The desktop build orbits the camera with the same button, so without
 * that distinction every camera drag that happened to start on the couch would
 * also start a couch lesson.
 */

/** Pixels of pointer travel above which a gesture counts as a drag, not a click. */
export const CLICK_SLOP = 6;

export class TargetSelectionSystem extends createSystem({
  targets: { required: [LessonTarget] },
}) {
  #raycaster = new Raycaster();
  #pointer = new Vector2();
  #onSelect: ((label: string) => void) | null = null;
  #onHover: ((label: string | null) => void) | null = null;

  #downX = 0;
  #downY = 0;
  #travel = 0;
  #pressed = false;

  onSelect(handler: (label: string) => void): void {
    this.#onSelect = handler;
  }

  /** Called with the hovered label, or `null` when the pointer leaves them all. */
  onHover(handler: (label: string | null) => void): void {
    this.#onHover = handler;
  }

  init(): void {
    window.addEventListener('pointerdown', (event) => {
      this.#pressed = true;
      this.#travel = 0;
      this.#downX = event.clientX;
      this.#downY = event.clientY;
    });

    window.addEventListener('pointermove', (event) => {
      if (this.#pressed) {
        this.#travel = Math.max(
          this.#travel,
          Math.abs(event.clientX - this.#downX) + Math.abs(event.clientY - this.#downY),
        );
      }
      // Hover is only meaningful for a mouse. A touch "move" is a drag with
      // the finger already down, and highlighting under the fingertip just
      // flickers whatever is being dragged past.
      if (event.pointerType === 'mouse' && !this.#pressed) {
        this.#onHover?.(this.#pick(event.clientX, event.clientY));
      }
    });

    window.addEventListener('pointerup', (event) => {
      const wasClick = this.#pressed && this.#travel <= CLICK_SLOP;
      this.#pressed = false;
      if (!wasClick) return;
      const label = this.#pick(event.clientX, event.clientY);
      if (label) this.#onSelect?.(label);
    });

    window.addEventListener('pointercancel', () => {
      this.#pressed = false;
    });
  }

  /** The label under the given screen position, or null. */
  #pick(clientX: number, clientY: number): string | null {
    this.#pointer.x = (clientX / window.innerWidth) * 2 - 1;
    this.#pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    this.#raycaster.setFromCamera(this.#pointer, this.camera);

    // Nearest hit wins. The original returned the first entity the query
    // happened to yield, which meant clicking the couch through the doorway
    // could start a door lesson depending on entity creation order.
    let nearestLabel: string | null = null;
    let nearestDistance = Infinity;

    for (const entity of this.queries.targets.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const hits = this.#raycaster.intersectObject(object, true);
      const first = hits[0];
      if (!first || first.distance >= nearestDistance) continue;
      const label = entity.getValue(LessonTarget, 'label');
      if (typeof label !== 'string' || label.length === 0) continue;
      nearestDistance = first.distance;
      nearestLabel = label;
    }

    return nearestLabel;
  }
}

import { createSystem, Vector3 } from '@iwsdk/core';

/**
 * Desktop camera control: a turntable around the showroom.
 *
 * Three.js ships `OrbitControls`, but only under `three/examples/jsm`, which
 * has no type declarations at the build path this project resolves `three`
 * from — pulling it in would mean either an `any` shim or a second copy of
 * three. The controller is small enough to own outright, and owning it lets
 * the orbit be constrained to this specific room.
 *
 * It is deliberately *not* a spherical orbit. A standard polar orbit couples
 * the camera's height to its distance, so zooming out lifts the camera; past
 * roughly 3 m of elevation it clears the 2.8 m ceiling and the room turns into
 * a view of the ceiling slab's outside face. Height is therefore an
 * independent axis, clamped below the ceiling at every distance, and the
 * camera can never leave the band of space the room is actually visible from.
 *
 * The maths lives in `OrbitState`, which touches no DOM and no Three.js
 * objects, so the clamping and damping behaviour is unit-testable in Node.
 */

export interface OrbitLimits {
  /** Horizontal distance from the target, in metres. */
  minDistance: number;
  maxDistance: number;
  /** Camera height above the floor, in metres. Must stay under the ceiling. */
  minHeight: number;
  maxHeight: number;
  /** Azimuth swing either side of straight-on, in radians. */
  azimuthRange: number;
}

/**
 * Tuned to the showroom in `scene/room.ts`: an 8 x 8 m room, 2.8 m tall, with
 * its front wall left open at +Z.
 *
 * `azimuthRange` is what keeps the camera looking in through that opening. Much
 * past 0.6 rad the sight line to the room's centre clips the right-hand wall
 * instead, and the learner is left staring at the outside of it.
 */
export const DEFAULT_ORBIT_LIMITS: OrbitLimits = {
  minDistance: 4.2,
  maxDistance: 11.5,
  minHeight: 0.75,
  maxHeight: 2.45,
  azimuthRange: 0.6,
};

/** Fraction of the remaining gap closed per second by the damping. */
const DAMPING_RATE = 12;

export interface OrbitVector {
  x: number;
  y: number;
  z: number;
}

/**
 * Turntable orbit around a fixed target, with clamping and smoothing.
 *
 * Holds two copies of the orbit: the goal the input drives, and the smoothed
 * value the camera actually uses. Interpolating towards the goal rather than
 * snapping is what makes a mouse drag feel weighty instead of twitchy.
 */
export class OrbitState {
  readonly limits: OrbitLimits;
  readonly target: OrbitVector;

  #goalAzimuth: number;
  #goalHeight: number;
  #goalDistance: number;

  #azimuth: number;
  #height: number;
  #distance: number;

  constructor(
    target: OrbitVector,
    azimuth: number,
    height: number,
    distance: number,
    limits: OrbitLimits = DEFAULT_ORBIT_LIMITS,
  ) {
    this.limits = limits;
    this.target = target;
    this.#goalAzimuth = this.#clampAzimuth(azimuth);
    this.#goalHeight = this.#clampHeight(height);
    this.#goalDistance = this.#clampDistance(distance);
    this.#azimuth = this.#goalAzimuth;
    this.#height = this.#goalHeight;
    this.#distance = this.#goalDistance;
  }

  get azimuth(): number {
    return this.#azimuth;
  }

  get height(): number {
    return this.#height;
  }

  get distance(): number {
    return this.#distance;
  }

  /** Apply a drag: azimuth in radians, height in metres. */
  rotate(deltaAzimuth: number, deltaHeight: number): void {
    this.#goalAzimuth = this.#clampAzimuth(this.#goalAzimuth + deltaAzimuth);
    this.#goalHeight = this.#clampHeight(this.#goalHeight + deltaHeight);
  }

  /** Multiply the orbit distance. `factor > 1` pulls the camera back. */
  zoom(factor: number): void {
    this.#goalDistance = this.#clampDistance(this.#goalDistance * factor);
  }

  /** Ease the live orbit towards its goal. `delta` is in seconds. */
  update(delta: number): void {
    // Exponential decay, framerate-independent: a plain `lerp(x, goal, 0.1)`
    // would move twice as fast at 120 Hz as at 60 Hz.
    const alpha = 1 - Math.exp(-DAMPING_RATE * Math.max(delta, 0));
    this.#azimuth += (this.#goalAzimuth - this.#azimuth) * alpha;
    this.#height += (this.#goalHeight - this.#height) * alpha;
    this.#distance += (this.#goalDistance - this.#distance) * alpha;
  }

  /** The camera position implied by the current orbit. */
  position(): OrbitVector {
    return {
      x: this.target.x + this.#distance * Math.sin(this.#azimuth),
      y: this.#height,
      z: this.target.z + this.#distance * Math.cos(this.#azimuth),
    };
  }

  #clampAzimuth(value: number): number {
    const range = this.limits.azimuthRange;
    return Math.min(Math.max(value, -range), range);
  }

  #clampHeight(value: number): number {
    return Math.min(Math.max(value, this.limits.minHeight), this.limits.maxHeight);
  }

  #clampDistance(value: number): number {
    return Math.min(Math.max(value, this.limits.minDistance), this.limits.maxDistance);
  }
}

/** Radians of azimuth per pixel dragged horizontally. */
const DRAG_SENSITIVITY = 0.005;

/** Metres of camera height per pixel dragged vertically. */
const HEIGHT_SENSITIVITY = 0.004;

/** Pixels of movement below which a pointer gesture still counts as a click. */
export const CLICK_SLOP = 6;

/**
 * Binds pointer, wheel, and touch input to an `OrbitState`, and writes the
 * result onto the active camera every frame.
 *
 * Disabled the moment an immersive session starts. In XR the headset owns the
 * camera pose through the reference space, and writing a position here every
 * frame would fight it.
 */
export class OrbitCameraSystem extends createSystem({}) {
  #orbit = new OrbitState({ x: 0, y: 1.28, z: -1.1 }, 0, 1.82, 8.8);
  #dragging = false;
  #lastX = 0;
  #lastY = 0;
  #pinchDistance: number | null = null;
  #position = new Vector3();
  #enabled = true;

  /** Total pixels moved since the current gesture started. */
  #travel = 0;

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#dragging = false;
  }

  /** Whether the gesture that just ended should be treated as a click. */
  get lastGestureWasClick(): boolean {
    return this.#travel <= CLICK_SLOP;
  }

  init(): void {
    const canvas = this.#canvas();
    canvas.addEventListener('pointerdown', this.#onPointerDown);
    window.addEventListener('pointermove', this.#onPointerMove);
    window.addEventListener('pointerup', this.#onPointerUp);
    window.addEventListener('pointercancel', this.#onPointerUp);
    canvas.addEventListener('wheel', this.#onWheel, { passive: false });
    canvas.addEventListener('touchmove', this.#onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.#onTouchEnd);
  }

  update(delta: number): void {
    if (!this.#enabled) return;
    this.#orbit.update(delta);
    const next = this.#orbit.position();
    this.#position.set(next.x, next.y, next.z);
    this.camera.position.copy(this.#position);
    this.camera.lookAt(this.#orbit.target.x, this.#orbit.target.y, this.#orbit.target.z);
  }

  #canvas(): HTMLElement {
    // `this.world.renderer.domElement` is the canvas IWSDK created. Listening
    // on it rather than on window keeps drags over the HUD from spinning the
    // camera while the learner is trying to type.
    return this.world.renderer.domElement;
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (!this.#enabled) return;
    this.#dragging = true;
    this.#travel = 0;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragging) return;
    const dx = event.clientX - this.#lastX;
    const dy = event.clientY - this.#lastY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.#travel += Math.abs(dx) + Math.abs(dy);
    // Azimuth is negated so dragging right swings the room to the right,
    // matching the "grab the world" convention every orbit control uses.
    // Height is not: dragging down lowers the camera, like tilting a turntable.
    this.#orbit.rotate(-dx * DRAG_SENSITIVITY, -dy * HEIGHT_SENSITIVITY);
  };

  #onPointerUp = (): void => {
    this.#dragging = false;
  };

  #onWheel = (event: WheelEvent): void => {
    if (!this.#enabled) return;
    event.preventDefault();
    this.#orbit.zoom(event.deltaY > 0 ? 1.12 : 1 / 1.12);
  };

  #onTouchMove = (event: TouchEvent): void => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (!first || !second) return;
    const spread = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    if (this.#pinchDistance !== null && spread > 0) {
      this.#orbit.zoom(this.#pinchDistance / spread);
    }
    this.#pinchDistance = spread;
  };

  #onTouchEnd = (): void => {
    this.#pinchDistance = null;
  };
}

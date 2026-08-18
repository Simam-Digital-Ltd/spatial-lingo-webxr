import { describe, expect, it } from 'vitest';

import { DEFAULT_ORBIT_LIMITS, OrbitState } from '../src/systems/orbit-camera.js';
import { ROOM_HEIGHT } from '../src/scene/room.js';

const TARGET = { x: 0, y: 1.28, z: -1.1 };

function fresh(): OrbitState {
  return new OrbitState(TARGET, 0, 1.82, 8.8);
}

describe('OrbitState', () => {
  it('starts at the values it was given', () => {
    const orbit = fresh();
    expect(orbit.azimuth).toBe(0);
    expect(orbit.height).toBeCloseTo(1.82);
    expect(orbit.distance).toBeCloseTo(8.8);
  });

  it('clamps constructor arguments into the limits', () => {
    const orbit = new OrbitState(TARGET, 99, 99, 99);
    expect(orbit.azimuth).toBeCloseTo(DEFAULT_ORBIT_LIMITS.azimuthRange);
    expect(orbit.height).toBeCloseTo(DEFAULT_ORBIT_LIMITS.maxHeight);
    expect(orbit.distance).toBeCloseTo(DEFAULT_ORBIT_LIMITS.maxDistance);
  });

  /**
   * The whole reason this control is not a spherical orbit: with polar angle
   * driving height, zooming out lifts the camera over the ceiling and the room
   * turns into a view of the ceiling slab's outside face.
   */
  it('never rises above the ceiling, at any distance or drag', () => {
    const orbit = fresh();
    for (let step = 0; step < 200; step++) {
      orbit.rotate(0.2, 0.2);
      orbit.zoom(1.2);
      orbit.update(1);
      expect(orbit.position().y).toBeLessThan(ROOM_HEIGHT);
    }
  });

  it('never drops below the floor', () => {
    const orbit = fresh();
    for (let step = 0; step < 200; step++) {
      orbit.rotate(-0.2, -0.2);
      orbit.update(1);
      expect(orbit.position().y).toBeGreaterThan(0);
    }
  });

  // The goal is clamped exactly; the live value eases towards it and only
  // approaches it asymptotically, so these compare to 3 decimal places rather
  // than demanding an exact landing.
  it('keeps azimuth within the range that still looks through the open wall', () => {
    const orbit = fresh();
    for (let step = 0; step < 100; step++) orbit.rotate(0.1, 0);
    orbit.update(1);
    expect(orbit.azimuth).toBeCloseTo(DEFAULT_ORBIT_LIMITS.azimuthRange, 3);

    for (let step = 0; step < 200; step++) orbit.rotate(-0.1, 0);
    orbit.update(1);
    expect(orbit.azimuth).toBeCloseTo(-DEFAULT_ORBIT_LIMITS.azimuthRange, 3);
  });

  it('clamps zoom to the distance limits in both directions', () => {
    const orbit = fresh();
    for (let step = 0; step < 60; step++) orbit.zoom(1.2);
    orbit.update(1);
    expect(orbit.distance).toBeCloseTo(DEFAULT_ORBIT_LIMITS.maxDistance, 3);

    for (let step = 0; step < 120; step++) orbit.zoom(1 / 1.2);
    orbit.update(1);
    expect(orbit.distance).toBeCloseTo(DEFAULT_ORBIT_LIMITS.minDistance, 3);
  });

  it('stays in front of the room, never behind the back wall', () => {
    const orbit = fresh();
    for (let step = 0; step < 100; step++) {
      orbit.rotate(0.15, 0);
      orbit.update(1);
      // cos(azimuth) stays positive across the clamped range, so the camera is
      // always on the +Z side of the target — the side the wall is open on.
      expect(orbit.position().z).toBeGreaterThan(TARGET.z);
    }
  });

  it('eases towards the goal instead of snapping to it', () => {
    const orbit = fresh();
    orbit.rotate(0.5, 0);
    // One short frame must move part of the way, not all of it.
    orbit.update(1 / 60);
    expect(orbit.azimuth).toBeGreaterThan(0);
    expect(orbit.azimuth).toBeLessThan(0.5);
  });

  /**
   * Damping is exponential precisely so it does not run at a different speed on
   * a 120 Hz display than on a 60 Hz one. Two half-steps must land in the same
   * place as one whole step.
   */
  it('damps at the same rate regardless of frame rate', () => {
    const fast = fresh();
    const slow = fresh();
    fast.rotate(0.5, 0.3);
    slow.rotate(0.5, 0.3);

    for (let step = 0; step < 20; step++) fast.update(1 / 120);
    for (let step = 0; step < 10; step++) slow.update(1 / 60);

    expect(fast.azimuth).toBeCloseTo(slow.azimuth, 3);
    expect(fast.height).toBeCloseTo(slow.height, 3);
  });

  it('ignores a negative delta rather than running the damping backwards', () => {
    const orbit = fresh();
    orbit.rotate(0.4, 0);
    orbit.update(-5);
    expect(orbit.azimuth).toBe(0);
  });

  it('places the camera on a circle of the requested radius around the target', () => {
    const orbit = new OrbitState(TARGET, 0.4, 1.5, 7);
    const position = orbit.position();
    const radius = Math.hypot(position.x - TARGET.x, position.z - TARGET.z);
    expect(radius).toBeCloseTo(7, 6);
    expect(position.y).toBeCloseTo(1.5, 6);
  });
});

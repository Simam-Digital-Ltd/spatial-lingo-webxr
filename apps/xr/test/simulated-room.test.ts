import { describe, expect, it } from 'vitest';
import { arcPositions } from '../src/systems/simulated-room.js';

const RADIUS = 2.5;

describe('arcPositions', () => {
  it('returns an empty array for zero entries', () => {
    expect(arcPositions(0)).toEqual([]);
  });

  it('returns an empty array for negative counts', () => {
    expect(arcPositions(-3)).toEqual([]);
  });

  it('places a single entry centered in front of the player', () => {
    const [position] = arcPositions(1);
    expect(position).toBeDefined();
    expect(position?.x).toBeCloseTo(0);
    expect(position?.z).toBeCloseTo(-RADIUS);
  });

  it('places every position at the configured radius from the player', () => {
    for (const position of arcPositions(6)) {
      const distance = Math.hypot(position.x, position.z);
      expect(distance).toBeCloseTo(RADIUS, 5);
    }
  });

  it('keeps every position in front of the player (negative z)', () => {
    for (const position of arcPositions(6)) {
      expect(position.z).toBeLessThanOrEqual(0);
    }
  });

  it('produces distinct positions for multiple entries', () => {
    const positions = arcPositions(6);
    const unique = new Set(positions.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`));
    expect(unique.size).toBe(positions.length);
  });

  it('spans symmetrically left and right of center for an even count', () => {
    const positions = arcPositions(6);
    const first = positions[0];
    const last = positions[positions.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first?.x).toBeCloseTo(-(last?.x ?? NaN));
  });

  it('handles counts larger than the pack holds without collapsing positions', () => {
    // The starter pack currently has 13 entries; verify well beyond that.
    const positions = arcPositions(20);
    expect(positions).toHaveLength(20);
    const unique = new Set(positions.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`));
    expect(unique.size).toBe(20);
  });

  it('respects custom radius and span', () => {
    const positions = arcPositions(3, 1, Math.PI);
    for (const position of positions) {
      expect(Math.hypot(position.x, position.z)).toBeCloseTo(1, 5);
    }
  });
});

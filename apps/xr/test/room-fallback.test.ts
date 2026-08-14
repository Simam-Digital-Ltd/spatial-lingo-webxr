import { describe, expect, it } from 'vitest';
import {
  decideOnGraceTimerFired,
  decideOnRealTargetSeen,
  RoomSourceController,
} from '../src/systems/room-fallback.js';

describe('decideOnGraceTimerFired', () => {
  it('spawns the fallback when nothing has happened yet', () => {
    const decision = decideOnGraceTimerFired('awaiting-scan');
    expect(decision.spawnFallback).toBe(true);
    expect(decision.nextState).toBe('simulated-room-spawned');
  });

  it('does not spawn the fallback when real targets are already present', () => {
    const decision = decideOnGraceTimerFired('real-targets-found');
    expect(decision.spawnFallback).toBe(false);
    expect(decision.nextState).toBe('real-targets-found');
  });

  it('is a no-op if the fallback already spawned', () => {
    const decision = decideOnGraceTimerFired('simulated-room-spawned');
    expect(decision.spawnFallback).toBe(false);
    expect(decision.nextState).toBe('simulated-room-spawned');
  });
});

describe('decideOnRealTargetSeen', () => {
  it('allows tagging while still awaiting a scan', () => {
    const decision = decideOnRealTargetSeen('awaiting-scan');
    expect(decision.allowTagging).toBe(true);
    expect(decision.nextState).toBe('real-targets-found');
  });

  it('allows further tagging once real targets are already found', () => {
    const decision = decideOnRealTargetSeen('real-targets-found');
    expect(decision.allowTagging).toBe(true);
    expect(decision.nextState).toBe('real-targets-found');
  });

  it('race: rejects a real target that arrives after the fallback already spawned', () => {
    const decision = decideOnRealTargetSeen('simulated-room-spawned');
    expect(decision.allowTagging).toBe(false);
    expect(decision.nextState).toBe('simulated-room-spawned');
  });
});

describe('race orderings', () => {
  it('targets arriving just before the timer fires suppress the fallback', () => {
    const afterTarget = decideOnRealTargetSeen('awaiting-scan');
    expect(afterTarget.allowTagging).toBe(true);

    const afterTimer = decideOnGraceTimerFired(afterTarget.nextState);
    expect(afterTimer.spawnFallback).toBe(false);
  });

  it('targets arriving just after the timer fires are rejected, not double-populated', () => {
    const afterTimer = decideOnGraceTimerFired('awaiting-scan');
    expect(afterTimer.spawnFallback).toBe(true);

    const afterTarget = decideOnRealTargetSeen(afterTimer.nextState);
    expect(afterTarget.allowTagging).toBe(false);
  });
});

describe('RoomSourceController', () => {
  it('starts in the awaiting-scan state', () => {
    const controller = new RoomSourceController();
    expect(controller.state).toBe('awaiting-scan');
  });

  it('reports the fallback should spawn exactly once', () => {
    const controller = new RoomSourceController();
    expect(controller.onGraceTimerFired()).toBe(true);
    expect(controller.onGraceTimerFired()).toBe(false);
  });

  it('locks out real targets once the fallback has spawned', () => {
    const controller = new RoomSourceController();
    controller.onGraceTimerFired();
    expect(controller.onRealTargetSeen()).toBe(false);
  });

  it('locks out the fallback once a real target has been seen', () => {
    const controller = new RoomSourceController();
    expect(controller.onRealTargetSeen()).toBe(true);
    expect(controller.onGraceTimerFired()).toBe(false);
  });

  it('markSimulatedRoomSpawned locks state without going through the timer', () => {
    const controller = new RoomSourceController();
    controller.markSimulatedRoomSpawned();
    expect(controller.state).toBe('simulated-room-spawned');
    expect(controller.onRealTargetSeen()).toBe(false);
  });
});

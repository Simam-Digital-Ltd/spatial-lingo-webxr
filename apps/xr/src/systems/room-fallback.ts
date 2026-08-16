/**
 * Tier 2 (mesh-detection granted) still leaves the world empty if the user
 * has never run their headset's Room Setup: the capability was granted but
 * `SceneUnderstandingSystem` has no meshes to hand `SceneLabelSystem`, so no
 * `LessonTarget` ever appears. This module decides when to give up waiting
 * for a real scan and fall back to the simulated room, without ever letting
 * real targets and stand-in boxes coexist.
 *
 * Kept standalone (no Three.js, no IWSDK, no timers) so the decision logic is
 * testable without instantiating a `World` or faking timers.
 */

/**
 * How long to wait, after a Tier 2 session starts, for at least one real
 * `LessonTarget` to appear before assuming the room was never scanned.
 *
 * A scanned room's meshes typically surface within the first second or two
 * of session start; 4s gives slow devices real headroom while still failing
 * fast enough that an unscanned room doesn't feel broken or frozen.
 */
export const ROOM_SCAN_GRACE_PERIOD_MS = 4000;

/**
 * - `awaiting-scan`: session just started; neither a real target nor the
 *   fallback has committed yet.
 * - `real-targets-found`: at least one real mesh was tagged; the fallback
 *   must never spawn for this session.
 * - `simulated-room-spawned`: the grace period elapsed with nothing real
 *   found, so stand-in boxes were spawned; no further real target may be
 *   tagged, or the two sources would double-populate the room.
 */
export type RoomSourceState = 'awaiting-scan' | 'real-targets-found' | 'simulated-room-spawned';

/** Result of the grace-period timer firing. */
export interface GraceTimerDecision {
  nextState: RoomSourceState;
  /** Whether the simulated room should be spawned now. */
  spawnFallback: boolean;
}

/** Result of a real mesh qualifying as a lesson target. */
export interface RealTargetDecision {
  nextState: RoomSourceState;
  /** Whether `SceneLabelSystem` may actually tag this mesh as a `LessonTarget`. */
  allowTagging: boolean;
}

/**
 * Pure decision for when the grace-period timer fires: spawn the fallback
 * only if the room is still in its initial "nothing has happened yet" state.
 * If a real target already arrived, the fallback must stay off — this is
 * what stops the "targets appear just before the timer fires" race from
 * double-populating the room.
 */
export function decideOnGraceTimerFired(state: RoomSourceState): GraceTimerDecision {
  if (state === 'awaiting-scan') {
    return { nextState: 'simulated-room-spawned', spawnFallback: true };
  }
  return { nextState: state, spawnFallback: false };
}

/**
 * Pure decision for when a real mesh qualifies as a lesson target: tagging
 * is allowed unless the simulated room has already committed. This is what
 * stops the "targets appear just after the timer fires" race — once the
 * stand-ins are in, no late real mesh may add to them.
 */
export function decideOnRealTargetSeen(state: RoomSourceState): RealTargetDecision {
  if (state === 'simulated-room-spawned') {
    return { nextState: state, allowTagging: false };
  }
  return { nextState: 'real-targets-found', allowTagging: true };
}

/**
 * Small stateful wrapper around the two pure decisions above, for call sites
 * that just need "what do I do now" without threading state by hand. The
 * decision logic itself lives in, and is tested via, the pure functions.
 */
export class RoomSourceController {
  #state: RoomSourceState = 'awaiting-scan';

  get state(): RoomSourceState {
    return this.#state;
  }

  /** Call when the grace-period timer fires. Returns whether to spawn the fallback. */
  onGraceTimerFired(): boolean {
    const { nextState, spawnFallback } = decideOnGraceTimerFired(this.#state);
    this.#state = nextState;
    return spawnFallback;
  }

  /** Call when a real mesh qualifies as a lesson target. Returns whether tagging is allowed. */
  onRealTargetSeen(): boolean {
    const { nextState, allowTagging } = decideOnRealTargetSeen(this.#state);
    this.#state = nextState;
    return allowTagging;
  }

  /** Locks the controller into "simulated room" without going through the timer path. */
  markSimulatedRoomSpawned(): void {
    this.#state = 'simulated-room-spawned';
  }
}

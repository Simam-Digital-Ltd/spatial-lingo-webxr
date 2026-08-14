export type TreeTier = 0 | 1 | 2 | 3 | 4;

export interface ProgressionState {
  tier: TreeTier;
  learnedCount: number;
  /** Words still needed to reach the next tier, or null at the cap. */
  wordsToNextTier: number | null;
}

/**
 * Words required to reach each tier. This is a deliberate divergence from the
 * original, not a port of it: Unity's `TreeController` (see
 * `reference/Unity-SpatialLingo/Assets/SpatialLingo/Scripts/Characters/TreeController.cs`)
 * has no word-count threshold table at all. It exposes `SetTier`/`AnimateToTier`
 * methods that just play a growth animation for whatever tier number they're
 * given, bounded to 1–3 (`MoveBerryToIndex` warns and refuses outside `(0, 3]`).
 * What tier to request is decided elsewhere, by `AppSessionData.Tier`
 * (read in `LessonProgressState.cs`, part of the Visual Scripting graph in
 * `ExerciseManager.cs`), not by any learned-word count in `TreeController`
 * itself. This module invents its own 5-tier curve on `[0, 1, 3, 6, 10]`
 * learned words to give the WebXR port a progression signal the original
 * never needed in this class.
 */
const TIER_THRESHOLDS: readonly number[] = [0, 1, 3, 6, 10];

/** Map a learned-word count onto the language tree's growth tier. */
export function progressionFor(learnedCount: number): ProgressionState {
  if (learnedCount < 0) {
    throw new Error(`learnedCount must not be negative, got ${learnedCount}`);
  }

  let tier: TreeTier = 0;
  for (let index = TIER_THRESHOLDS.length - 1; index >= 0; index--) {
    if (learnedCount >= (TIER_THRESHOLDS[index] ?? 0)) {
      tier = index as TreeTier;
      break;
    }
  }

  const nextThreshold = TIER_THRESHOLDS[tier + 1];
  return {
    tier,
    learnedCount,
    wordsToNextTier: nextThreshold === undefined ? null : nextThreshold - learnedCount,
  };
}

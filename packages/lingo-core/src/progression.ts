export type TreeTier = 0 | 1 | 2 | 3 | 4;

export interface ProgressionState {
  tier: TreeTier;
  learnedCount: number;
  /** Words still needed to reach the next tier, or null at the cap. */
  wordsToNextTier: number | null;
}

/** Words required to reach each tier. Mirrors the original's TreeController tiering. */
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

import { createComponent, Types } from '@iwsdk/core';

/**
 * Marks a detected real-world object that has a vocabulary entry.
 *
 * The Unity original derived targets from YOLO over the passthrough camera
 * (ImageObjectClassifier + CameraTaxonTracker). WebXR gives us semantic labels
 * straight off the scene mesh, so no inference is needed for this tier.
 */
export const LessonTarget = createComponent('LessonTarget', {
  label: { type: Types.String, default: '' },
  word: { type: Types.String, default: '' },
  learned: { type: Types.Boolean, default: false },
});

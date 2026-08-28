import type { LessonPack } from '@spatial-lingo/core';

/**
 * Point the camera at a thing, and the thing becomes the lesson.
 *
 * This is the mechanic the Unity original is actually remembered for, and the
 * one this port replaced with platform semantic labels. It runs the MediaPipe
 * Object Detector in WASM on webcam frames: no API key, no server, no
 * round trip, and — the part that matters in a language app pointed at
 * someone's home — the frames never leave the machine. That is the whole
 * argument for on-device inference over a cloud vision call, and it is why
 * this comes before any hosted vision work in the roadmap.
 *
 * Two limits stated up front, because both are structural rather than bugs:
 *
 * 1. **The detector's vocabulary is not this pack's vocabulary.** The bundled
 *    model is trained on COCO's 80 everyday-object classes, which overlap the
 *    thirteen starter-pack words only partly — see `DETECTOR_ALIASES`. Words
 *    like "window" and "wall" are not COCO classes at all and can never be
 *    detected by this model, no matter how clearly they are in frame.
 * 2. **The camera sees the room the visitor is in; the rendered showroom is a
 *    different, virtual room.** So this is a second mode — "teach me what my
 *    camera sees" — not an upgrade to the existing one.
 *
 * Everything in this file above `ObjectVision` is pure, so the mapping and
 * throttling rules are tested in Node without a camera or a WASM runtime.
 */

/**
 * Pack label to the detector-model class names that should count as it.
 *
 * Written pack-label-first rather than detector-label-first because the pack
 * is the thing we control: when a new language pack adds a word, the question
 * asked is "can the model see this?", and this table is where the answer
 * lives. An entry with no detector classes is a word the model structurally
 * cannot find.
 *
 * The class names are COCO's, matched case-insensitively. `dining table` and
 * `potted plant` are COCO's own spellings, not ours.
 */
export const DETECTOR_ALIASES: Readonly<Record<string, readonly string[]>> = {
  table: ['dining table'],
  couch: ['couch', 'chair', 'bench'],
  bed: ['bed'],
  plant: ['potted plant'],
  // Three different objects a learner would reasonably call "the screen". The
  // pack teaches one word for the category, so all three map to it.
  screen: ['tv', 'laptop', 'monitor'],
};

/** Detections below this confidence are ignored. */
export const MIN_CONFIDENCE = 0.5;

/**
 * How often inference may run, in milliseconds.
 *
 * Per-frame inference would wreck the frame budget of a scene that is also
 * rendering a room. A detection pass every few hundred milliseconds is
 * plenty for objects that are, by definition, furniture.
 */
export const INFERENCE_INTERVAL_MS = 400;

/** One thing the model believes it can see. */
export interface Detection {
  label: string;
  score: number;
}

/** What a detection turned out to be, from the lesson's point of view. */
export interface VisionMatch {
  /** The pack label, if this maps to a word the pack teaches. */
  packLabel: string | null;
  /** The detector's own class name, kept for the "not in this pack" message. */
  detectorLabel: string;
  score: number;
}

/**
 * Which pack word, if any, a detector class name corresponds to.
 *
 * Case-insensitive because model label casing is not something to depend on.
 */
export function packLabelFor(detectorLabel: string, pack: LessonPack): string | null {
  const needle = detectorLabel.trim().toLowerCase();
  if (needle.length === 0) return null;

  for (const entry of pack.entries) {
    const aliases = DETECTOR_ALIASES[entry.label];
    if (!aliases) continue;
    if (aliases.some((alias) => alias.toLowerCase() === needle)) return entry.label;
  }
  return null;
}

/**
 * Pack words this model can never find.
 *
 * Exported because it is the honest answer to "why did pointing the camera at
 * my window do nothing", and the interface says so rather than leaving the
 * learner to conclude the feature is broken. It is also the first thing to
 * re-check when the pack or the model changes.
 */
export function undetectableLabels(pack: LessonPack): string[] {
  return pack.entries
    .filter((entry) => (DETECTOR_ALIASES[entry.label]?.length ?? 0) === 0)
    .map((entry) => entry.label);
}

/**
 * Turn raw detections into lesson-relevant matches, best first.
 *
 * Keeps the misses. A thing the model recognised but the pack does not teach
 * is more interesting to show than to drop silently — it tells the learner the
 * camera is working and the word is simply not in this lesson yet, which is a
 * completely different message from nothing happening at all.
 */
export function summariseDetections(
  detections: readonly Detection[],
  pack: LessonPack,
  minConfidence: number = MIN_CONFIDENCE,
): VisionMatch[] {
  const seen = new Set<string>();
  const matches: VisionMatch[] = [];

  for (const detection of [...detections].sort((a, b) => b.score - a.score)) {
    if (detection.score < minConfidence) continue;
    const detectorLabel = detection.label.trim();
    if (detectorLabel.length === 0) continue;

    const packLabel = packLabelFor(detectorLabel, pack);
    // One row per distinct outcome: five chairs in frame is one "couch", not
    // five identical lines fighting for the same strip of screen.
    const key = packLabel ?? `?${detectorLabel.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    matches.push({ packLabel, detectorLabel, score: detection.score });
  }

  return matches;
}

/** The best pack word currently in frame, or null if none is. */
export function bestPackMatch(matches: readonly VisionMatch[]): VisionMatch | null {
  return matches.find((match) => match.packLabel !== null) ?? null;
}

/**
 * Whether enough time has passed to run inference again.
 *
 * Takes the clock as an argument rather than reading it, so the throttle is
 * testable without faking timers.
 */
export function shouldRunInference(
  now: number,
  lastRun: number | null,
  interval: number = INFERENCE_INTERVAL_MS,
): boolean {
  if (lastRun === null) return true;
  return now - lastRun >= interval;
}

/** How the camera feature is currently doing. */
export type VisionState =
  | 'idle'
  | 'requesting-camera'
  | 'loading-model'
  | 'running'
  | 'unsupported'
  | 'denied'
  | 'failed';

/**
 * Describe the state for the learner, in terms of what they can do about it.
 *
 * Each of these has a different cause and a different fix, and a single
 * "camera unavailable" line would hide which one happened.
 */
export function describeVisionState(state: VisionState): string {
  switch (state) {
    case 'idle':
      return 'Point your camera at something to learn its name.';
    case 'requesting-camera':
      return 'Waiting for camera permission…';
    case 'loading-model':
      return 'Loading the detection model (a few megabytes, once)…';
    case 'running':
      return 'Looking…';
    case 'unsupported':
      return 'This browser has no camera API, so this mode is unavailable.';
    case 'denied':
      return 'Camera permission was declined. Everything else still works.';
    case 'failed':
      return 'The detection model could not be loaded. Try again, or carry on without it.';
  }
}

/**
 * Where the WASM runtime and the model come from.
 *
 * Both are fetched from Google's CDN on first use rather than bundled. The
 * runtime ships inside `@mediapipe/tasks-vision` and *could* be self-hosted by
 * copying its `wasm/` directory into the build; the model is a separate ~4 MB
 * download that is not in the package at all. They are left external here for
 * one reason: this whole feature is opt-in and degrades to nothing, so a
 * failed fetch costs a visitor who never pressed the button precisely nothing,
 * whereas bundling would add megabytes to every page load for everyone.
 *
 * Note what is and is not being claimed. The *model* is downloaded from
 * Google. The *frames* are not uploaded anywhere — inference runs in this
 * process, and that is the property this feature exists to have.
 *
 * The version is pinned rather than floating: an unpinned CDN path means
 * whatever that URL serves tomorrow executes as WASM in the visitor's browser.
 */
export const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/** Most detections a single pass may return. */
const MAX_RESULTS = 5;

interface DetectorLike {
  detectForVideo(video: HTMLVideoElement, timestamp: number): {
    detections?: readonly {
      categories?: readonly { categoryName?: string; score?: number }[];
    }[];
  };
  close?(): void;
}

/**
 * Normalise a MediaPipe result into our own flat detection list.
 *
 * Exported and pure so the shape-handling — which is nested, optional at
 * every level, and the most likely thing to break on a library upgrade — is
 * tested without a WASM runtime.
 */
export function toDetections(result: {
  detections?: readonly {
    categories?: readonly { categoryName?: string; score?: number }[];
  }[];
}): Detection[] {
  const detections: Detection[] = [];
  for (const found of result.detections ?? []) {
    const category = found.categories?.[0];
    const label = category?.categoryName;
    const score = category?.score;
    if (typeof label !== 'string' || typeof score !== 'number') continue;
    detections.push({ label, score });
  }
  return detections;
}

/**
 * The camera mode, end to end.
 *
 * Deliberately owns the whole lifecycle — permission, model load, the
 * inference loop, and teardown — because every one of those can fail
 * independently and the learner needs to be told which. `onState` fires for
 * each transition so the interface can say what is happening rather than
 * showing a spinner that means seven different things.
 *
 * Nothing here is imported at module load: the MediaPipe package is pulled in
 * dynamically inside `start`, so a visitor who never opens this mode never
 * downloads it. The bundle is already large enough that this is not an
 * optimisation but a requirement.
 */
export class ObjectVision {
  readonly #pack: LessonPack;
  readonly #onState: (state: VisionState) => void;
  readonly #onMatches: (matches: VisionMatch[]) => void;

  #detector: DetectorLike | null = null;
  #stream: MediaStream | null = null;
  #video: HTMLVideoElement | null = null;
  #frame: number | null = null;
  #lastRun: number | null = null;
  #state: VisionState = 'idle';

  constructor(
    pack: LessonPack,
    onState: (state: VisionState) => void,
    onMatches: (matches: VisionMatch[]) => void,
  ) {
    this.#pack = pack;
    this.#onState = onState;
    this.#onMatches = onMatches;
  }

  get state(): VisionState {
    return this.#state;
  }

  /** Whether this browser has a camera API at all. */
  static isSupported(nav: Navigator = navigator): boolean {
    return typeof nav.mediaDevices?.getUserMedia === 'function';
  }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.#state === 'running' || this.#state === 'loading-model') return;
    if (!ObjectVision.isSupported()) {
      this.#set('unsupported');
      return;
    }

    this.#video = video;
    this.#set('requesting-camera');

    try {
      // The rear camera on a phone is the one pointed at the room. On a laptop
      // this constraint is simply ignored and the only camera is used.
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
    } catch {
      // Declined, or no camera attached. Both mean the same thing here, and
      // neither is an error worth a console trace on a feature that is
      // explicitly optional.
      this.#set('denied');
      return;
    }

    video.srcObject = this.#stream;
    try {
      await video.play();
    } catch {
      // Autoplay refusal. The stream is live either way; the loop below reads
      // frames from it regardless of whether the element is visibly playing.
    }

    this.#set('loading-model');
    try {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      this.#detector = (await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        scoreThreshold: MIN_CONFIDENCE,
        maxResults: MAX_RESULTS,
        runningMode: 'VIDEO',
      })) as unknown as DetectorLike;
    } catch (error) {
      console.warn('[spatial-lingo] object detector failed to load', error);
      this.stop();
      this.#set('failed');
      return;
    }

    this.#set('running');
    this.#loop();
  }

  /** Stop inference, release the camera, and free the model. */
  stop(): void {
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
    // Releasing every track is what actually turns the camera light off. A
    // language demo that leaves the webcam running after you close the panel
    // would be indefensible.
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;

    if (this.#video) {
      this.#video.srcObject = null;
      this.#video = null;
    }

    this.#detector?.close?.();
    this.#detector = null;
    this.#lastRun = null;
    if (this.#state === 'running') this.#set('idle');
  }

  #loop(): void {
    const video = this.#video;
    const detector = this.#detector;
    if (!video || !detector) return;

    this.#frame = requestAnimationFrame(() => this.#loop());

    const now = performance.now();
    if (!shouldRunInference(now, this.#lastRun)) return;
    // `readyState` below HAVE_CURRENT_DATA means there is no frame to read
    // yet; calling the detector anyway throws inside WASM.
    if (video.readyState < 2) return;
    this.#lastRun = now;

    try {
      const result = detector.detectForVideo(video, now);
      this.#onMatches(summariseDetections(toDetections(result), this.#pack));
    } catch (error) {
      console.warn('[spatial-lingo] detection pass failed', error);
      this.stop();
      this.#set('failed');
    }
  }

  #set(state: VisionState): void {
    this.#state = state;
    this.#onState(state);
  }
}

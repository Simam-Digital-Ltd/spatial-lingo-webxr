import { resolveTier, type Capabilities, type Tier } from './capabilities.js';
import type { VisionState } from './vision.js';

/**
 * The developer route — the Unity Gym scene, finished rather than ported.
 *
 * The Unity original ships a Gym scene: a sandbox for exercising the AI,
 * camera and room systems without a real scanned room. Most of that already
 * exists here as the showroom and the simulated room, so porting the scene
 * would rebuild what the app does anyway. What was actually missing is the
 * part that makes those useful for testing — a way to *choose* which of them
 * runs, and a readout of what the device really granted.
 *
 * So this is one URL instead of one scene. `?debug` reveals the corner
 * readout; `?debug&tier=3` makes the app believe it is on a different device;
 * `?debug&room=simulated` uses stand-in objects even where a real room scan
 * exists. Everything here is inert without `?debug`, so a visitor who never
 * types it gets exactly the app that shipped.
 *
 * All the decision logic is pure and lives in this file's exported functions.
 * `DebugPanel` only writes to the DOM, in the same split `hud.ts` uses.
 */

/** What the device is doing, or being told to do. */
export interface DebugOptions {
  /** Whether `?debug` was present. Nothing below applies without it. */
  enabled: boolean;
  /** Tier to impersonate, or null to use whatever the device reports. */
  tier: Tier | null;
  /** Ignore any real room scan and use stand-in objects. */
  forceSimulatedRoom: boolean;
}

const DISABLED: DebugOptions = { enabled: false, tier: null, forceSimulatedRoom: false };

/**
 * Read the debug switches out of a query string.
 *
 * Takes the string rather than reading `window.location`, so the parsing rules
 * are testable in Node.
 *
 * Every switch is gated on `debug` itself rather than honoured on its own. A
 * shared link carrying a stray `?tier=4` should not quietly serve a degraded
 * app to whoever opens it — the override is a development affordance, and it
 * takes the development flag to turn it on.
 */
export function parseDebugOptions(search: string): DebugOptions {
  const params = new URLSearchParams(search);
  if (!params.has('debug')) return { ...DISABLED };

  return {
    enabled: true,
    tier: parseTier(params.get('tier')),
    // `room=simulated` reads better in a URL than a bare flag, and leaves room
    // for a future `room=scanned` without changing the shape.
    forceSimulatedRoom: params.get('room') === 'simulated',
  };
}

/** A tier from the query string, or null if it is absent or not one of ours. */
function parseTier(raw: string | null): Tier | null {
  if (raw === '1') return 1;
  if (raw === '2') return 2;
  if (raw === '3') return 3;
  if (raw === '4') return 4;
  return null;
}

/**
 * Rewrite capabilities so `resolveTier` returns the requested tier.
 *
 * The override is expressed as capabilities rather than as a tier the rest of
 * the app has to remember to consult, because the tier is *derived* — every
 * decision downstream already reads `resolveTier`, and fixing up its input
 * means there is exactly one place where the lie is told and no code path that
 * can forget to ask.
 *
 * Note what this cannot do: it makes the app *believe* a feature was granted,
 * it does not make the device grant it. Forcing tier 2 on a headset without
 * mesh detection gets you an app that waits for meshes that never arrive and
 * then falls back on the grace timer — which is itself a useful thing to be
 * able to watch, but it is not a scanned room.
 */
export function applyTierOverride(
  capabilities: Capabilities,
  options: DebugOptions,
): Capabilities {
  if (!options.enabled || options.tier === null) return capabilities;

  switch (options.tier) {
    case 4:
      return { ...capabilities, immersiveAR: false };
    case 3:
      return { ...capabilities, immersiveAR: true, meshDetection: false };
    case 2:
      return { ...capabilities, immersiveAR: true, meshDetection: true, cameraAccess: false };
    case 1:
      return { ...capabilities, immersiveAR: true, meshDetection: true, cameraAccess: true };
  }
}

/**
 * Whether to skip waiting for a room scan and go straight to stand-in objects.
 *
 * Pulled out of `main.ts` as a pure function for a specific reason: the branch
 * it replaces can only be reached inside a live `sessionstart` handler on a
 * real headset, which is exactly the thing this project cannot test in CI. A
 * one-line condition buried in an event listener is a one-line condition
 * nobody can exercise; here it is checkable in Node.
 *
 * Tier 3 has no mesh detection, so there is no scan to wait for. The override
 * reaches the same place deliberately, and the two are kept distinct in the
 * signature rather than collapsed, because they mean different things: one is
 * a device that cannot scan, the other is a device that can and is being told
 * not to.
 */
export function shouldUseSimulatedRoom(tier: Tier, options: DebugOptions): boolean {
  if (tier === 3) return true;
  return options.enabled && options.forceSimulatedRoom;
}

/** Where lesson targets are currently coming from. */
export type RoomSource = 'showroom' | 'pending' | 'scanned' | 'simulated';

/** Browser permission states, plus the two cases the API itself cannot report. */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

/** @deprecated Kept as the original name; `PermissionState` now covers both devices. */
export type MicrophoneState = PermissionState;

/**
 * Everything the panel knows, in one object.
 *
 * Deliberately a plain record rather than a set of live getters: the panel is
 * a snapshot of what the app currently believes, and building it that way is
 * what makes the rendering testable without a browser.
 */
export interface HealthReadout {
  capabilities: Capabilities;
  tierForced: boolean;
  roomSource: RoomSource;
  microphone: PermissionState;
  /** Camera permission, for the on-device vision mode. */
  camera: PermissionState;
  /** How far the object detector has got. `idle` means it was never opened. */
  vision: VisionState;
  /** A synthesiser voice exists for the pack's language. */
  voice: boolean;
  /** A Gemini key is configured, so the sentence challenge can run. */
  geminiKey: boolean;
}

const OK = '<i class="ok">yes</i>';
const OFF = '<i class="off">no</i>';

function yesNo(value: boolean): string {
  return value ? OK : OFF;
}

/**
 * Pure render: health readout to the panel's HTML.
 *
 * Says which services are reachable rather than which are configured — "a key
 * is saved" and "the model answers" are different claims, and this only makes
 * the one it can actually check without spending a request. Confirming the key
 * works would mean calling Gemini on page load, which is a charge on the
 * learner's own key for a diagnostic they did not ask for.
 */
export function renderHealthPanel(health: HealthReadout): string {
  const { capabilities: caps } = health;
  const tier = resolveTier(caps);
  const forced = health.tierForced ? ' <i class="warn">forced</i>' : '';

  return [
    `<b>tier ${tier}</b>${forced} · room: ${health.roomSource}`,
    `xr: ${yesNo(caps.immersiveAR)} · mesh: ${yesNo(caps.meshDetection)}` +
      ` · plane: ${yesNo(caps.planeDetection)} · hands: ${yesNo(caps.handTracking)}`,
    `camera-access: ${yesNo(caps.cameraAccess)}`,
    `mic: ${describePermission(health.microphone)} · recognition: ${yesNo(caps.speechRecognition)}` +
      ` · voice: ${yesNo(health.voice)}`,
    `camera: ${describePermission(health.camera)} · detector: ${health.vision}`,
    `gemini key: ${yesNo(health.geminiKey)}`,
  ].join('<br />');
}

/** Microphone permission, coloured by whether it will block a lesson. */
export function describePermission(state: PermissionState): string {
  if (state === 'granted') return OK;
  if (state === 'denied') return '<i class="warn">denied</i>';
  if (state === 'prompt') return '<i class="off">not asked</i>';
  if (state === 'unsupported') return '<i class="off">n/a</i>';
  return '<i class="off">unknown</i>';
}

interface PermissionsLike {
  query?: (descriptor: { name: string }) => Promise<{ state: string }>;
}

/**
 * Ask the browser whether the microphone is already permitted.
 *
 * Never prompts. `permissions.query` reports the standing decision without
 * opening a dialog, which is the whole point — a diagnostics panel that
 * triggered a permission prompt on load would be worse than not having one.
 *
 * Firefox has historically not supported the `microphone` descriptor and
 * rejects the query outright, so a throw is reported as `unsupported` rather
 * than treated as an error.
 */
export async function probePermission(
  nav: Navigator,
  name: 'microphone' | 'camera',
): Promise<PermissionState> {
  const permissions = (nav as Navigator & { permissions?: PermissionsLike }).permissions;
  if (!permissions?.query) return 'unsupported';

  try {
    const status = await permissions.query({ name });
    const state = status.state;
    if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
    return 'unknown';
  } catch {
    return 'unsupported';
  }
}

/**
 * The corner readout.
 *
 * Holds the last known health, so callers can push whichever field they
 * learned about — the tier arrives before the session starts, the microphone
 * state resolves asynchronously, and the key can change at any time from the
 * settings dialog — without any of them needing to know the rest.
 */
export class DebugPanel {
  readonly #element: HTMLElement | null;
  readonly #corner: HTMLElement | null;
  #health: HealthReadout;

  constructor(health: HealthReadout, doc: Document = document) {
    this.#element = doc.getElementById('debug-health');
    this.#corner = doc.getElementById('debug-corner');
    this.#health = health;
  }

  /** Reveal the corner. Called only when `?debug` is present. */
  show(): void {
    this.#corner?.classList.add('show');
    this.#render();
  }

  /** Merge in whatever the caller just found out, and repaint. */
  update(patch: Partial<HealthReadout>): void {
    this.#health = { ...this.#health, ...patch };
    this.#render();
  }

  #render(): void {
    if (this.#element) this.#element.innerHTML = renderHealthPanel(this.#health);
  }
}

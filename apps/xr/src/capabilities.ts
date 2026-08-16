/** Degradation tier the app runs at. See the spec's capability table. */
export type Tier = 1 | 2 | 3 | 4;

export interface Capabilities {
  cameraAccess: boolean;
  meshDetection: boolean;
  planeDetection: boolean;
  handTracking: boolean;
  speechRecognition: boolean;
  immersiveAR: boolean;
}

const NONE: Capabilities = {
  cameraAccess: false,
  meshDetection: false,
  planeDetection: false,
  handTracking: false,
  speechRecognition: false,
  immersiveAR: false,
};

/**
 * Pick the highest tier the device can actually sustain.
 *
 * Camera access without mesh detection is useless to us: we need scene geometry
 * to anchor a detection to, so that combination falls back to Tier 3.
 */
export function resolveTier(capabilities: Capabilities): Tier {
  if (!capabilities.immersiveAR) return 4;
  if (!capabilities.meshDetection) return 3;
  // Tier 1 is currently unreachable: `capabilities.cameraAccess` can never be
  // true. The session is created via IWSDK's `World.create({ xr: { features }
  // })`, and IWSDK 0.5.3's `XRFeatureOptions` type (see
  // node_modules/@iwsdk/core/dist/init/xr.d.ts) only exposes `handTracking`,
  // `anchors`, `hitTest`, `planeDetection`, `meshDetection`, `depthSensing`,
  // `layers`, and `unbounded` — there is no flag to request the
  // `camera-access` WebXR feature. Reaching Tier 1 needs either an IWSDK
  // upgrade that adds camera-access support, or a later phase of our own that
  // requests it some other way; until then this branch is dead in practice
  // and every immersive-AR + mesh-detection device lands on Tier 2.
  return capabilities.cameraAccess ? 1 : 2;
}

interface FeatureProbe {
  isSessionSupported?: (mode: string) => Promise<boolean>;
}

/**
 * Probe device capabilities.
 *
 * Takes Navigator and Window explicitly rather than reading globals, so the
 * logic is unit-testable in Node without a DOM.
 *
 * WebXR gives no way to ask, ahead of a session, whether an optional feature
 * like mesh detection, plane detection, hand tracking, or camera access will
 * be granted. `navigator.xr.isSessionSupported(mode)` only answers whether a
 * session *mode* (e.g. `immersive-ar`) can be requested at all — it says
 * nothing about which optional features that session would grant. There is
 * no pre-session feature-support query in the spec, so those four
 * capabilities are always reported `false` here regardless of the device.
 * The only real source of truth for them is `capabilitiesFromSession`, which
 * reads `session.enabledFeatures` off a session that has actually started.
 */
export async function probeCapabilities(nav: Navigator, win: Window): Promise<Capabilities> {
  const xr = (nav as Navigator & { xr?: FeatureProbe }).xr;
  if (!xr?.isSessionSupported) return { ...NONE };

  let immersiveAR = false;
  try {
    immersiveAR = await xr.isSessionSupported('immersive-ar');
  } catch {
    immersiveAR = false;
  }

  const speechRecognition =
    'SpeechRecognition' in win || 'webkitSpeechRecognition' in win;

  return {
    ...NONE,
    immersiveAR,
    speechRecognition,
  };
}

/**
 * Refine capabilities from a live session.
 *
 * `session.enabledFeatures` is the only trustworthy source: a feature can be
 * requested and silently declined, so we never assume a request succeeded.
 */
export function capabilitiesFromSession(session: XRSession, base: Capabilities): Capabilities {
  const enabled = new Set<string>(
    (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures ?? [],
  );
  return {
    ...base,
    meshDetection: enabled.has('mesh-detection'),
    planeDetection: enabled.has('plane-detection'),
    handTracking: enabled.has('hand-tracking'),
    cameraAccess: enabled.has('camera-access'),
  };
}

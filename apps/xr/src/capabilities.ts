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
  return capabilities.cameraAccess ? 1 : 2;
}

interface FeatureProbe {
  isSessionSupported?: (mode: string) => Promise<boolean>;
  __supported?: Set<string>;
}

/**
 * Probe device capabilities.
 *
 * Takes Navigator and Window explicitly rather than reading globals, so the
 * logic is unit-testable in Node without a DOM.
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

  const supported = xr.__supported ?? new Set<string>();
  const speechRecognition =
    'SpeechRecognition' in win || 'webkitSpeechRecognition' in win;

  return {
    immersiveAR,
    meshDetection: supported.has('mesh-detection'),
    planeDetection: supported.has('plane-detection'),
    handTracking: supported.has('hand-tracking'),
    cameraAccess: supported.has('camera-access'),
    speechRecognition,
  };
}

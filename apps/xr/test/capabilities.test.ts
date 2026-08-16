import { describe, expect, it } from 'vitest';
import { probeCapabilities, resolveTier, type Capabilities } from '../src/capabilities.js';
import { capabilitiesFromSession } from '../src/capabilities.js';

const NONE: Capabilities = {
  cameraAccess: false, meshDetection: false, planeDetection: false,
  handTracking: false, speechRecognition: false, immersiveAR: false,
};

describe('resolveTier', () => {
  it('returns 4 with no XR at all', () => {
    expect(resolveTier(NONE)).toBe(4);
  });
  it('returns 3 with immersive AR but no mesh detection', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true })).toBe(3);
  });
  it('returns 2 with mesh detection but no camera access', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true, meshDetection: true })).toBe(2);
  });
  it('returns 1 with mesh detection and camera access', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true, meshDetection: true, cameraAccess: true })).toBe(1);
  });
  it('ignores camera access without mesh detection', () => {
    expect(resolveTier({ ...NONE, immersiveAR: true, cameraAccess: true })).toBe(3);
  });
});

describe('probeCapabilities', () => {
  it('reports nothing when WebXR is absent', async () => {
    const result = await probeCapabilities({} as Navigator, {} as Window);
    expect(result).toEqual(NONE);
  });

  it('reports immersiveAR and speechRecognition, but never the optional features', async () => {
    // WebXR has no pre-session query for optional-feature support, so
    // meshDetection/planeDetection/handTracking/cameraAccess must stay false
    // here no matter what the fake reports elsewhere. Only a live session
    // (capabilitiesFromSession) can tell us the truth about those.
    const nav = {
      xr: {
        isSessionSupported: async (mode: string) => mode === 'immersive-ar',
      },
    } as unknown as Navigator;
    const win = { SpeechRecognition: class {} } as unknown as Window;

    const result = await probeCapabilities(nav, win);
    expect(result.immersiveAR).toBe(true);
    expect(result.speechRecognition).toBe(true);
    expect(result.meshDetection).toBe(false);
    expect(result.planeDetection).toBe(false);
    expect(result.handTracking).toBe(false);
    expect(result.cameraAccess).toBe(false);
  });
});

describe('capabilitiesFromSession', () => {
  const base: Capabilities = { ...NONE, immersiveAR: true };

  it('reads enabled features off the session', () => {
    const session = { enabledFeatures: ['mesh-detection', 'hand-tracking'] } as unknown as XRSession;
    const result = capabilitiesFromSession(session, base);
    expect(result.meshDetection).toBe(true);
    expect(result.handTracking).toBe(true);
    expect(result.planeDetection).toBe(false);
    expect(result.cameraAccess).toBe(false);
  });

  it('preserves base values the session says nothing about', () => {
    const session = { enabledFeatures: [] } as unknown as XRSession;
    const result = capabilitiesFromSession(session, { ...base, speechRecognition: true });
    expect(result.speechRecognition).toBe(true);
    expect(result.immersiveAR).toBe(true);
  });

  it('tolerates a session with no enabledFeatures', () => {
    const session = {} as unknown as XRSession;
    expect(() => capabilitiesFromSession(session, base)).not.toThrow();
  });
});

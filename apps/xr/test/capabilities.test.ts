import { describe, expect, it } from 'vitest';
import { probeCapabilities, resolveTier, type Capabilities } from '../src/capabilities.js';
import { capabilitiesFromSession, OPTIONAL_FEATURES } from '../src/capabilities.js';

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

  it('reports features the session supports', async () => {
    const supported = new Set(['mesh-detection', 'plane-detection', 'hand-tracking']);
    const nav = {
      xr: {
        isSessionSupported: async (mode: string) => mode === 'immersive-ar',
        // Feature probing is done by attempting optional features; the fake
        // reports support directly to keep the test hermetic.
        __supported: supported,
      },
    } as unknown as Navigator;
    const win = { SpeechRecognition: class {} } as unknown as Window;

    const result = await probeCapabilities(nav, win);
    expect(result.immersiveAR).toBe(true);
    expect(result.meshDetection).toBe(true);
    expect(result.planeDetection).toBe(true);
    expect(result.handTracking).toBe(true);
    expect(result.speechRecognition).toBe(true);
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

  it('requests every feature the tiers depend on', () => {
    expect(OPTIONAL_FEATURES).toContain('mesh-detection');
    expect(OPTIONAL_FEATURES).toContain('plane-detection');
    expect(OPTIONAL_FEATURES).toContain('hand-tracking');
    expect(OPTIONAL_FEATURES).toContain('camera-access');
  });
});

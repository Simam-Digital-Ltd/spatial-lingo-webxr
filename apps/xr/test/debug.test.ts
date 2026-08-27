import { describe, expect, it } from 'vitest';

import type { Capabilities } from '../src/capabilities.js';
import { resolveTier } from '../src/capabilities.js';
import {
  applyTierOverride,
  describeMicrophone,
  parseDebugOptions,
  probeMicrophone,
  renderHealthPanel,
  shouldUseSimulatedRoom,
  type HealthReadout,
} from '../src/debug.js';

const NONE: Capabilities = {
  cameraAccess: false,
  meshDetection: false,
  planeDetection: false,
  handTracking: false,
  speechRecognition: false,
  immersiveAR: false,
};

const HEALTH: HealthReadout = {
  capabilities: NONE,
  tierForced: false,
  roomSource: 'showroom',
  microphone: 'prompt',
  voice: false,
  geminiKey: false,
};

describe('parseDebugOptions', () => {
  it('is off with no query string at all', () => {
    expect(parseDebugOptions('')).toEqual({
      enabled: false,
      tier: null,
      forceSimulatedRoom: false,
    });
  });

  it('turns on with a bare ?debug', () => {
    expect(parseDebugOptions('?debug').enabled).toBe(true);
  });

  it('coexists with the other query flags the app already reads', () => {
    expect(parseDebugOptions('?skipwelcome&debug').enabled).toBe(true);
  });

  it('reads a tier override', () => {
    expect(parseDebugOptions('?debug&tier=3').tier).toBe(3);
  });

  it('accepts every tier the capability table defines', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(parseDebugOptions(`?debug&tier=${tier}`).tier).toBe(tier);
    }
  });

  it('ignores a tier that is not one of ours', () => {
    expect(parseDebugOptions('?debug&tier=0').tier).toBeNull();
    expect(parseDebugOptions('?debug&tier=5').tier).toBeNull();
    expect(parseDebugOptions('?debug&tier=banana').tier).toBeNull();
    expect(parseDebugOptions('?debug&tier=').tier).toBeNull();
  });

  it('reads the forced room source', () => {
    expect(parseDebugOptions('?debug&room=simulated').forceSimulatedRoom).toBe(true);
  });

  it('leaves the room alone for any other value', () => {
    expect(parseDebugOptions('?debug&room=scanned').forceSimulatedRoom).toBe(false);
  });

  // The switches are development affordances. A link someone shares with a
  // stray `?tier=4` on it must not serve a degraded app to whoever opens it.
  it('honours nothing without ?debug', () => {
    const options = parseDebugOptions('?tier=4&room=simulated');
    expect(options).toEqual({ enabled: false, tier: null, forceSimulatedRoom: false });
  });
});

describe('applyTierOverride', () => {
  const ALL: Capabilities = {
    cameraAccess: true,
    meshDetection: true,
    planeDetection: true,
    handTracking: true,
    speechRecognition: true,
    immersiveAR: true,
  };

  it('changes nothing when debug is off', () => {
    expect(applyTierOverride(ALL, { enabled: false, tier: 4, forceSimulatedRoom: false })).toBe(ALL);
  });

  it('changes nothing when no tier is requested', () => {
    expect(applyTierOverride(ALL, { enabled: true, tier: null, forceSimulatedRoom: false })).toBe(
      ALL,
    );
  });

  // The point of expressing the override as capabilities: every downstream
  // decision already reads resolveTier, so fixing up its input is enough.
  it('makes resolveTier return the requested tier, from any starting point', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      const options = { enabled: true, tier, forceSimulatedRoom: false };
      expect(resolveTier(applyTierOverride(ALL, options))).toBe(tier);
      expect(resolveTier(applyTierOverride(NONE, options))).toBe(tier);
    }
  });

  it('leaves capabilities the tier does not depend on untouched', () => {
    const forced = applyTierOverride(
      { ...NONE, speechRecognition: true, handTracking: true },
      { enabled: true, tier: 3, forceSimulatedRoom: false },
    );
    expect(forced.speechRecognition).toBe(true);
    expect(forced.handTracking).toBe(true);
  });

  it('does not mutate the capabilities it was given', () => {
    const original = { ...ALL };
    applyTierOverride(ALL, { enabled: true, tier: 4, forceSimulatedRoom: false });
    expect(ALL).toEqual(original);
  });
});

describe('shouldUseSimulatedRoom', () => {
  const off = { enabled: false, tier: null, forceSimulatedRoom: false };
  const forced = { enabled: true, tier: null, forceSimulatedRoom: true };

  it('always falls back on tier 3, which has no scan to wait for', () => {
    expect(shouldUseSimulatedRoom(3, off)).toBe(true);
  });

  it('waits for a scan on tier 2 by default', () => {
    expect(shouldUseSimulatedRoom(2, off)).toBe(false);
  });

  // The switch worth having: mesh detection was granted and a real scan
  // exists, and we want to see the stand-ins anyway.
  it('skips a real scan when the room is forced', () => {
    expect(shouldUseSimulatedRoom(2, forced)).toBe(true);
    expect(shouldUseSimulatedRoom(1, forced)).toBe(true);
  });

  it('ignores a forced room when debug is off', () => {
    expect(shouldUseSimulatedRoom(2, { ...forced, enabled: false })).toBe(false);
  });
});

describe('renderHealthPanel', () => {
  it('leads with the resolved tier', () => {
    expect(renderHealthPanel(HEALTH)).toContain('tier 4');
  });

  it('marks a forced tier so a readout is never mistaken for the real device', () => {
    expect(renderHealthPanel(HEALTH)).not.toContain('forced');
    expect(renderHealthPanel({ ...HEALTH, tierForced: true })).toContain('forced');
  });

  it('names the room source', () => {
    expect(renderHealthPanel({ ...HEALTH, roomSource: 'simulated' })).toContain('room: simulated');
  });

  it('reports every capability the tier table reads', () => {
    const html = renderHealthPanel({
      ...HEALTH,
      capabilities: { ...NONE, immersiveAR: true, meshDetection: true },
    });
    expect(html).toContain('xr: ');
    expect(html).toContain('mesh: ');
    expect(html).toContain('camera-access: ');
  });

  it('reports the optional services', () => {
    const html = renderHealthPanel({ ...HEALTH, voice: true, geminiKey: true });
    expect(html).toContain('voice: ');
    expect(html).toContain('gemini key: ');
  });
});

describe('describeMicrophone', () => {
  it('distinguishes denied from never asked', () => {
    expect(describeMicrophone('denied')).toContain('denied');
    expect(describeMicrophone('prompt')).toContain('not asked');
  });

  it('reports a browser that cannot answer separately from one that said no', () => {
    expect(describeMicrophone('unsupported')).not.toContain('denied');
    expect(describeMicrophone('unknown')).not.toContain('denied');
  });
});

describe('probeMicrophone', () => {
  it('reports unsupported when there is no permissions API', async () => {
    expect(await probeMicrophone({} as Navigator)).toBe('unsupported');
  });

  it('passes through a standing decision', async () => {
    const nav = {
      permissions: { query: async () => ({ state: 'granted' }) },
    } as unknown as Navigator;
    expect(await probeMicrophone(nav)).toBe('granted');
  });

  // Firefox has historically rejected the `microphone` descriptor outright.
  it('treats a rejected query as unsupported rather than an error', async () => {
    const nav = {
      permissions: {
        query: async () => {
          throw new TypeError('microphone is not a valid permission name');
        },
      },
    } as unknown as Navigator;
    expect(await probeMicrophone(nav)).toBe('unsupported');
  });

  it('asks for the microphone and nothing else', async () => {
    const asked: string[] = [];
    const nav = {
      permissions: {
        query: async (descriptor: { name: string }) => {
          asked.push(descriptor.name);
          return { state: 'prompt' };
        },
      },
    } as unknown as Navigator;
    await probeMicrophone(nav);
    expect(asked).toEqual(['microphone']);
  });

  it('reports an unrecognised state as unknown', async () => {
    const nav = {
      permissions: { query: async () => ({ state: 'something-else' }) },
    } as unknown as Navigator;
    expect(await probeMicrophone(nav)).toBe('unknown');
  });
});

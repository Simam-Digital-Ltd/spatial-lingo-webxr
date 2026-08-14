import { SessionMode, World, launchXR } from '@iwsdk/core';
import { loadPack } from '@spatial-lingo/core';
import starterPack from '@spatial-lingo/core/data/starter-pack.es.json' with { type: 'json' };

import {
  capabilitiesFromSession,
  probeCapabilities,
  resolveTier,
  type Capabilities,
} from './capabilities.js';
import { SceneLabelSystem } from './systems/scene-label.js';

function render(capabilities: Capabilities): void {
  const status = document.getElementById('status');
  if (!status) return;
  const tier = resolveTier(capabilities);
  status.innerHTML = [
    `<strong>Tier ${tier}</strong>`,
    ...Object.entries(capabilities).map(
      ([name, value]) => `${value ? '&check;' : '&cross;'} ${name}`,
    ),
  ].join('<br />');
  console.info('[spatial-lingo] capabilities', capabilities, 'tier', tier);
}

/**
 * Build the IWSDK world, wire up scene understanding, and start the XR
 * session. Only called once we know `immersiveAR` is supported, so a Tier 4
 * (desktop, no WebXR) device never reaches this code path.
 */
async function enterXR(capabilities: Capabilities): Promise<void> {
  const container = document.getElementById('scene-container');
  if (!container) throw new Error('[spatial-lingo] missing #scene-container');

  const world = await World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      // We drive session entry ourselves via the "Enter XR" button rather
      // than IWSDK's native browser-offered prompt.
      offer: 'none',
      features: {
        meshDetection: true,
        planeDetection: true,
        handTracking: true,
        anchors: true,
      },
    },
    features: {
      // Registers SceneUnderstandingSystem, which turns WebXR mesh-detection
      // results into XRMesh-tagged entities for SceneLabelSystem to consume.
      sceneUnderstanding: true,
      // This tier has no in-world UI yet; skip PanelUI/ScreenSpaceUI so their
      // MSDF font-generation dependency isn't pulled into the bundle at all.
      spatialUI: false,
    },
  });

  world.registerSystem(SceneLabelSystem);
  const sceneLabelSystem = world.getSystem(SceneLabelSystem);
  sceneLabelSystem?.setPack(loadPack(starterPack));

  world.renderer.xr.addEventListener('sessionstart', () => {
    const session = world.renderer.xr.getSession();
    if (!session) return;
    render(capabilitiesFromSession(session, capabilities));
  });

  launchXR(world);
}

async function main(): Promise<void> {
  const capabilities = await probeCapabilities(navigator, window);
  render(capabilities);

  if (!capabilities.immersiveAR) return;

  const button = document.createElement('button');
  button.textContent = 'Enter XR';
  button.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:1rem 2rem;font-size:1rem;';
  document.body.append(button);

  button.addEventListener('click', async () => {
    try {
      button.disabled = true;
      await enterXR(capabilities);
    } catch (error) {
      console.error('[spatial-lingo] session request failed', error);
      button.disabled = false;
    }
  });
}

void main();

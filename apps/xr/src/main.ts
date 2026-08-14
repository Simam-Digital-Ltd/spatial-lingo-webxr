import { AmbientLight, DirectionalLight, SessionMode, World, launchXR } from '@iwsdk/core';
import { loadPack } from '@spatial-lingo/core';
import starterPack from '@spatial-lingo/core/data/starter-pack.es.json' with { type: 'json' };

import {
  capabilitiesFromSession,
  probeCapabilities,
  resolveTier,
  type Capabilities,
} from './capabilities.js';
import { ROOM_SCAN_GRACE_PERIOD_MS, RoomSourceController } from './systems/room-fallback.js';
import { SceneLabelSystem } from './systems/scene-label.js';
import { SimulatedRoomSystem } from './systems/simulated-room.js';

/** Number of stand-in objects the simulated room spawns. */
const SIMULATED_ROOM_COUNT = 6;

/** Appends a note to #status about the Tier 2 room-scan fallback, without wiping the capability readout. */
function announceRoomScanFallback(): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.innerHTML += [
    '<br />',
    '<em>No room scan found — showing stand-in targets. ',
    'Run Room Setup on your headset to use your real room instead.</em>',
  ].join('');
}

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

function getContainer(): HTMLElement {
  const container = document.getElementById('scene-container');
  if (!container) throw new Error('[spatial-lingo] missing #scene-container');
  return container;
}

/**
 * Minimal lighting for the stand-in boxes: `MeshStandardMaterial` renders
 * black without at least one light in the scene. Three.js lights illuminate
 * the whole scene graph regardless of where they're parented, so adding them
 * directly to `world.scene` is enough; it doesn't touch AR passthrough video,
 * which isn't a lit three.js object.
 */
function addBasicLighting(world: World): void {
  world.scene.add(new AmbientLight(0xffffff, 1.5));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 2);
  world.scene.add(sun);
}

/**
 * Build the IWSDK world, wire up scene understanding, and start the XR
 * session. Only called once we know `immersiveAR` is supported.
 *
 * Both Tier 2 (mesh detection available) and Tier 3 (no mesh detection) run
 * through this path: which room source ends up producing `LessonTarget`
 * entities is decided once the session actually starts and we know whether
 * mesh detection was really granted, not from the pre-session probe.
 */
async function enterXR(capabilities: Capabilities): Promise<void> {
  const container = getContainer();

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

  addBasicLighting(world);

  world.registerSystem(SceneLabelSystem);
  world.registerSystem(SimulatedRoomSystem);
  const sceneLabelSystem = world.getSystem(SceneLabelSystem);
  const simulatedRoom = world.getSystem(SimulatedRoomSystem);
  if (!sceneLabelSystem || !simulatedRoom) {
    throw new Error('[spatial-lingo] room systems failed to register');
  }

  const pack = loadPack(starterPack);
  sceneLabelSystem.setPack(pack);

  // Tracks whether we're still waiting on a real scan, already found one, or
  // have committed to the simulated room, so the two sources never combine.
  // See room-fallback.ts for the full race-condition reasoning.
  const roomSource = new RoomSourceController();
  sceneLabelSystem.setTagGuard(() => roomSource.onRealTargetSeen());

  let roomSourceChosen = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  world.renderer.xr.addEventListener('sessionstart', () => {
    const session = world.renderer.xr.getSession();
    if (!session) return;
    const refined = capabilitiesFromSession(session, capabilities);
    render(refined);

    // Mesh-detection support is only known for certain once the session has
    // actually granted (or declined) the feature, so the Tier 2 vs Tier 3
    // room-source decision is made here, not before `launchXR`.
    if (!roomSourceChosen) {
      roomSourceChosen = true;
      if (resolveTier(refined) === 3) {
        // No mesh-detection at all: go straight to stand-ins, and lock the
        // controller so a spurious late mesh can never also get tagged.
        roomSource.markSimulatedRoomSpawned();
        simulatedRoom.spawn(pack, SIMULATED_ROOM_COUNT);
      } else {
        // Tier 2: mesh-detection was granted, but the headset may never have
        // been through Room Setup, in which case SceneLabelSystem will never
        // see a mesh to tag. Give a real scan a grace period to show up
        // before assuming the room is unscanned and falling back.
        fallbackTimer = setTimeout(() => {
          fallbackTimer = undefined;
          if (roomSource.onGraceTimerFired()) {
            simulatedRoom.spawn(pack, SIMULATED_ROOM_COUNT);
            announceRoomScanFallback();
            console.info(
              '[spatial-lingo] no room scan detected within',
              ROOM_SCAN_GRACE_PERIOD_MS,
              'ms; falling back to simulated room',
            );
          }
        }, ROOM_SCAN_GRACE_PERIOD_MS);
      }
    }
  });

  world.renderer.xr.addEventListener('sessionend', () => {
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
  });

  launchXR(world);
}

/**
 * Tier 4: no WebXR at all. Builds a browser-only IWSDK world (`xr: false`)
 * so the render loop, camera, and scene still run without a session, and
 * fills it with the simulated room. This is what keeps the project openable
 * on a plain laptop with no headset.
 */
async function enterDesktop(): Promise<void> {
  const container = getContainer();

  const world = await World.create(container, {
    xr: false,
    features: {
      spatialUI: false,
    },
  });

  addBasicLighting(world);

  world.registerSystem(SimulatedRoomSystem);
  const simulatedRoom = world.getSystem(SimulatedRoomSystem);
  if (!simulatedRoom) {
    throw new Error('[spatial-lingo] SimulatedRoomSystem failed to register');
  }

  simulatedRoom.spawn(loadPack(starterPack), SIMULATED_ROOM_COUNT);
}

async function main(): Promise<void> {
  const capabilities = await probeCapabilities(navigator, window);
  render(capabilities);

  if (resolveTier(capabilities) === 4) {
    await enterDesktop();
    return;
  }

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

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  PointLight,
  SessionMode,
  World,
  launchXR,
} from '@iwsdk/core';
import { loadPack, type LessonPack, type LessonState } from '@spatial-lingo/core';
import starterPack from '@spatial-lingo/core/data/starter-pack.es.json' with { type: 'json' };

import {
  capabilitiesFromSession,
  probeCapabilities,
  resolveTier,
  type Capabilities,
} from './capabilities.js';
import { Hud, WelcomeOverlay } from './hud.js';
import { PALETTE } from './scene/palette.js';
import { LessonSystem } from './systems/lesson.js';
import { OrbitCameraSystem } from './systems/orbit-camera.js';
import { ROOM_SCAN_GRACE_PERIOD_MS, RoomSourceController } from './systems/room-fallback.js';
import { SceneLabelSystem } from './systems/scene-label.js';
import { ShowroomSystem } from './systems/showroom.js';
import { SimulatedRoomSystem } from './systems/simulated-room.js';
import { TargetSelectionSystem } from './systems/target-selection.js';

/** Number of stand-in objects the headset fallback spawns on its arc. */
const SIMULATED_ROOM_COUNT = 6;

/** How long feedback stays on screen before the lesson advances, in ms. */
const FEEDBACK_DWELL_MS = 2200;

const DEFAULT_HINT =
  'Drag to look around · scroll to zoom · click an object to start';

function setHint(html: string): void {
  const hint = document.getElementById('hint');
  if (hint) hint.innerHTML = html;
}

/**
 * Writes the capability readout to the console, and reveals the diagnostics
 * corner when the URL carries `?debug`.
 *
 * Hidden by default: the raw state-machine dump is genuinely useful when
 * triaging a headset that granted fewer features than expected, and genuinely
 * noise for anyone who just opened the link to try the demo.
 */
function renderDiagnostics(capabilities: Capabilities): void {
  const panel = document.getElementById('diagnostics');
  if (panel && new URLSearchParams(window.location.search).has('debug')) {
    panel.classList.add('show');
  }
  console.info('[spatial-lingo] capabilities', capabilities, 'tier', resolveTier(capabilities));
}

function getContainer(): HTMLElement {
  const container = document.getElementById('scene-container');
  if (!container) throw new Error('[spatial-lingo] missing #scene-container');
  return container;
}

/**
 * Lighting rig for the room.
 *
 * `MeshStandardMaterial` renders black without at least one light in the
 * scene. Three.js lights illuminate the whole scene graph regardless of where
 * they are parented, so adding them straight to `world.scene` is enough — and
 * none of it touches AR passthrough video, which is not a lit three.js object.
 *
 * A warm key with shadows, a cool sky/ground hemisphere fill, and a practical
 * at the floor lamp. Three lights is more than a passthrough scene needs, but
 * the flat showroom is what most visitors will see and it is what makes the
 * difference between an interior and a grey-box test level.
 */
function addLighting(world: World): void {
  const key = new DirectionalLight(0xfff2dd, 2.1);
  key.position.set(4.5, 6.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  // The shadow frustum is sized to the room. Left at its default it covers a
  // 10 m cube centred on the origin, which puts most of the room outside the
  // map and gives everything hard, aliased shadow edges.
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = -7;
  shadowCamera.right = 7;
  shadowCamera.top = 7;
  shadowCamera.bottom = -7;
  shadowCamera.near = 0.5;
  shadowCamera.far = 26;
  shadowCamera.updateProjectionMatrix();

  const sky = new HemisphereLight(0xcfe4ff, PALETTE.floor, 1.15);
  const bounce = new AmbientLight(0xffffff, 0.32);

  // Practical inside the floor lamp's shade, matching its emissive bulb mesh.
  const lampGlow = new PointLight(0xffd9a0, 7, 5.5, 2);
  lampGlow.position.set(-3.15, 1.36, -2.5);

  world.scene.add(key, sky, bounce, lampGlow);
}

/**
 * Renderer settings for the flat showroom.
 *
 * Left alone, three.js renders with no tone mapping and no shadows, which is
 * most of why an untuned procedural scene looks like a test level no matter
 * how good the geometry is.
 */
function configureRenderer(world: World): void {
  const renderer = world.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // Capped at 2: on a 3x phone screen the extra pixels cost more than they
  // show, and this build has to stay smooth in a mid-range mobile browser.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // An explicit background rather than the default transparent clear: any
  // sliver of scene the room geometry does not cover reads as a soft dark
  // surround instead of a hole punched through to the page behind.
  world.scene.background = new Color(0x14161d);
  world.scene.fog = new Fog(0x14161d, 16, 40);
}

/**
 * Whatever is currently rendering lesson targets.
 *
 * The showroom and the headset room sources are swapped at runtime — the
 * showroom is torn down when an immersive session starts — so the lesson loop
 * talks to this interface rather than to either one directly.
 */
interface RoomRenderer {
  reveal(label: string): void;
  setLearnedCount?(learnedCount: number): void;
}

/**
 * Registers the lesson loop and connects it: selection feeds target labels in,
 * the HUD feeds typed attempts in, and lesson state flows back out to the HUD
 * and to whichever room is currently on screen.
 *
 * Wired exactly once, before any session starts, so the loop behaves
 * identically on every tier and survives entering and leaving XR.
 */
function wireLessonLoop(
  world: World,
  pack: LessonPack,
  getRoom: () => RoomRenderer | null,
  onHover: (label: string | null) => void,
): void {
  world.registerSystem(LessonSystem);
  world.registerSystem(TargetSelectionSystem);
  const lesson = world.getSystem(LessonSystem);
  const selection = world.getSystem(TargetSelectionSystem);
  if (!lesson || !selection) {
    throw new Error('[spatial-lingo] lesson systems failed to register');
  }

  const hud = new Hud();
  hud.setPack(pack);
  hud.setTotal(pack.entries.length);

  lesson.start(pack);
  selection.onSelect((label) => lesson.selectTarget(label));
  selection.onHover(onHover);

  let seenLearned = 0;
  lesson.onState((state: LessonState) => {
    hud.render(state);

    // `learnedLabels` only ever grows, so anything past the high-water mark is
    // new. Driving reveals off the state rather than off the submit call site
    // keeps the visuals correct no matter what advanced the machine.
    const labels = state.learnedLabels;
    if (labels.length <= seenLearned) return;
    const room = getRoom();
    for (let index = seenLearned; index < labels.length; index++) {
      const label = labels[index];
      if (label && room) room.reveal(label);
    }
    seenLearned = labels.length;
    room?.setLearnedCount?.(labels.length);
  });

  hud.bindInput((text) => {
    if (!lesson.submit(text)) return;
    setTimeout(() => lesson.dismiss(), FEEDBACK_DWELL_MS);
  });
}

/**
 * Wire up the headset path on an already-built world.
 *
 * Both Tier 2 (mesh detection available) and Tier 3 (no mesh detection) run
 * through this: which room source ends up producing `LessonTarget` entities is
 * decided once the session actually starts and we know whether mesh detection
 * was really granted, not from the pre-session probe.
 */
function setupImmersive(
  world: World,
  pack: LessonPack,
  capabilities: Capabilities,
  handover: { onSessionStart: () => void },
): SimulatedRoomSystem {
  world.registerSystem(SceneLabelSystem);
  world.registerSystem(SimulatedRoomSystem);
  const sceneLabelSystem = world.getSystem(SceneLabelSystem);
  const simulatedRoom = world.getSystem(SimulatedRoomSystem);
  if (!sceneLabelSystem || !simulatedRoom) {
    throw new Error('[spatial-lingo] room systems failed to register');
  }
  sceneLabelSystem.setPack(pack);

  // Tracks whether we are still waiting on a real scan, already found one, or
  // have committed to the simulated room, so the two sources never combine.
  // See room-fallback.ts for the full race-condition reasoning.
  const roomSource = new RoomSourceController();
  sceneLabelSystem.setTagGuard(() => roomSource.onRealTargetSeen());

  let roomSourceChosen = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  world.renderer.xr.addEventListener('sessionstart', () => {
    const session = world.renderer.xr.getSession();
    if (!session) return;
    handover.onSessionStart();

    const refined = capabilitiesFromSession(session, capabilities);
    renderDiagnostics(refined);

    // Mesh-detection support is only known for certain once the session has
    // actually granted (or declined) the feature, so the Tier 2 vs Tier 3
    // room-source decision is made here, not before `launchXR`.
    if (roomSourceChosen) return;
    roomSourceChosen = true;

    if (resolveTier(refined) === 3) {
      // No mesh detection at all: go straight to stand-ins, and lock the
      // controller so a spurious late mesh can never also get tagged.
      roomSource.markSimulatedRoomSpawned();
      simulatedRoom.spawn(pack, SIMULATED_ROOM_COUNT);
      return;
    }

    // Tier 2: mesh detection was granted, but the headset may never have been
    // through Room Setup, in which case SceneLabelSystem will never see a mesh
    // to tag. Give a real scan a grace period to show up before assuming the
    // room is unscanned and falling back.
    fallbackTimer = setTimeout(() => {
      fallbackTimer = undefined;
      if (!roomSource.onGraceTimerFired()) return;
      simulatedRoom.spawn(pack, SIMULATED_ROOM_COUNT);
      setHint(
        '<strong>No room scan found</strong> — showing stand-in objects. ' +
          'Run Room Setup on your headset to use your real room instead.',
      );
      console.info(
        '[spatial-lingo] no room scan detected within',
        ROOM_SCAN_GRACE_PERIOD_MS,
        'ms; falling back to simulated room',
      );
    }, ROOM_SCAN_GRACE_PERIOD_MS);
  });

  world.renderer.xr.addEventListener('sessionend', () => {
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
  });

  return simulatedRoom;
}

/**
 * One world, built once, whichever tier we are on.
 *
 * An earlier version created a second world when entering XR. That is a bug in
 * waiting — two renderers, two canvases, two render loops competing for the
 * same container — so the world is created up front with the XR configuration
 * the device can actually support, and only the *contents* are swapped when a
 * session starts.
 */
async function createWorld(capabilities: Capabilities): Promise<World> {
  const container = getContainer();

  if (!capabilities.immersiveAR) {
    return World.create(container, { xr: false, features: { spatialUI: false } });
  }

  return World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      // We drive session entry ourselves from the button rather than through
      // IWSDK's native browser-offered prompt.
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
      // No in-world UI: PanelUI/ScreenSpaceUI drag the MSDF font-atlas
      // generator and every bundled typeface into the build. World-space word
      // labels are drawn to a 2D canvas instead — see scene/labels.ts.
      spatialUI: false,
    },
  });
}

async function main(): Promise<void> {
  const capabilities = await probeCapabilities(navigator, window);
  renderDiagnostics(capabilities);

  const container = getContainer();
  const world = await createWorld(capabilities);

  configureRenderer(world);
  addLighting(world);

  world.registerSystem(ShowroomSystem);
  world.registerSystem(OrbitCameraSystem);
  const showroom = world.getSystem(ShowroomSystem);
  const orbit = world.getSystem(OrbitCameraSystem);
  if (!showroom || !orbit) {
    throw new Error('[spatial-lingo] showroom systems failed to register');
  }

  const pack = loadPack(starterPack);

  // Every tier starts in the flat showroom, so the page is never a bare "click
  // to enter" wall: you can look around and play the whole lesson loop on a
  // laptop, and step into mixed reality only if you have a headset.
  const placed = showroom.build(pack);
  const totalCount = document.getElementById('total-count');
  if (totalCount) totalCount.textContent = String(placed.length);

  let activeRoom: RoomRenderer | null = showroom;

  wireLessonLoop(
    world,
    pack,
    () => activeRoom,
    (label) => {
      showroom.setHovered(label);
      // A pointer cursor is the cheapest possible affordance, and without it
      // nothing on screen says the furniture is clickable.
      container.style.cursor = label ? 'pointer' : 'default';
    },
  );

  const welcome = new WelcomeOverlay();
  // `?skipwelcome` exists for automated capture: the screenshot harness needs
  // the room, not the card in front of it.
  if (new URLSearchParams(window.location.search).has('skipwelcome')) {
    welcome.dismiss();
  } else {
    welcome.ready(capabilities, () => setHint(DEFAULT_HINT));
  }

  if (!capabilities.immersiveAR) return;

  const simulatedRoom = setupImmersive(world, pack, capabilities, {
    onSessionStart: () => {
      // Hand the world over to the headset: drop the opaque showroom so
      // passthrough is visible, stop driving the camera, and clear the fog,
      // which would otherwise grey out anything more than 14 m away.
      showroom.teardown();
      orbit.setEnabled(false);
      world.scene.fog = null;
      container.style.cursor = 'default';
      activeRoom = simulatedRoom;
      setHint('Look at an object and pinch to start a lesson');
    },
  });

  const button = document.getElementById('enter-xr');
  if (!(button instanceof HTMLButtonElement)) return;
  button.classList.add('show');
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
      launchXR(world);
    } catch (error) {
      console.error('[spatial-lingo] session request failed', error);
      button.disabled = false;
      button.textContent = 'Enter mixed reality';
      setHint(DEFAULT_HINT);
    }
  });
}

void main();

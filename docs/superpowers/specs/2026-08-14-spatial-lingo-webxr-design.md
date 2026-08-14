# Spatial Lingo WebXR — Design

**Date:** 2026-08-14
**Status:** Approved, pending implementation plan
**Repo (public):** `spatial-lingo-webxr`

## Purpose

Port Meta's open-source Unity Quest app [Spatial Lingo](https://github.com/oculus-samples/Unity-SpatialLingo)
to the immersive web using [Meta's Immersive Web SDK (IWSDK)](https://github.com/facebook/immersive-web-sdk),
and document the migration as a hands-on guide.

Two deliverables, equally weighted:

1. A playable WebXR app that runs on Quest Browser and degrades to a desktop browser.
2. A migration guide covering the Unity/C# → WebXR/TypeScript conversion in enough
   technical detail that a Unity developer can follow it for their own project.

This is the practical companion to the existing LinkedIn article
"From Unity to Immersive Web XR: A Practical Migration Guide", and an open-source
credibility piece for Simam Digital.

### Non-goals

- Feature parity with the Unity app. Parity of the *core loop* is the bar.
- Shipping to the Horizon Store or any app store.
- A general-purpose Unity→WebXR conversion tool. This is one worked example.

## Source analysis

Spatial Lingo is five subsystems. The port maps each to a web equivalent:

| Unity / Meta SDK | Web equivalent | Risk |
| --- | --- | --- |
| MRUK scene understanding | WebXR mesh/plane detection + semantic labels via IWSDK | Low |
| Interaction SDK (grab, poke, hands + controllers) | IWSDK interaction components, `@iwsdk/xr-input` | Low |
| Lesson logic, progression (C# MonoBehaviours) | Pure TypeScript state machine | Low |
| Voice SDK (STT + TTS) | Web Speech API, cloud proxy fallback | Medium |
| Llama API (lesson generation + evaluation) | Vercel function proxy + bundled static lesson pack | Medium |
| Passthrough Camera API + Unity Sentis + YOLO/COCO | WebXR `camera-access` + ONNX Runtime Web (WebGPU) | **High** |
| Golly Gosh character, language tree, VFX | glTF/GLB via an asset conversion pipeline | Medium |

### Phase 0 recon findings (2026-08-14)

The source repo was cloned and inventoried. Five findings amend the assumptions above:

1. **Lesson targets do not come from MRUK.** `Scripts/Utilities/RoomSense.cs` is 1.9 KB and
   only wraps MRUK's `FindSpawnPositions` to pick a single spawn point. Real lesson targets
   come from `Meta.Utilities.ObjectClassifier.ImageObjectClassifier` + `CameraTaxonTracker` +
   `EnvironmentRaycastManager` — i.e. camera and YOLO. **Our scene-mesh core loop is therefore
   a redesign, not a port.** This is stated plainly in the guide rather than glossed.
2. **The app flow is not in C#.** `Data/StateGraph/AppFlow.asset` is a serialized Unity Visual
   Scripting graph; `Scripts/VisualScriptingUnits/*.cs` are custom nodes for it. Top-level
   application flow cannot be read from source alone. Earns its own guide section:
   *when the logic isn't in the code at all*.
3. **IWSDK is closer to parity than assumed.** It ships `scene-understanding`,
   `environment-raycast`, `camera`, and `depth` modules. `XRMesh` exposes `semanticLabel`,
   `dimensions`, `min`, `max`, and `isBounded3D` — exactly the Tier 2 mechanism.
   Note: IWSDK's `CameraSystem` is MediaDevices-based (`deviceId`, `facing`, `videoElement`,
   `stream`), *not* WebXR raw camera access.
4. **`Data/InferenceEngine/ObjectClassifier/yolov9onnx.onnx` ships in the repo** (Git LFS) with
   `classesYolo.txt` (80 COCO classes, 706 bytes, not LFS). Raw ONNX is directly loadable by
   ONNX Runtime Web, making Phase 6 more feasible than originally priced.
5. **Concrete stack facts** (from `@iwsdk/core@0.5.3` typings): ECS is `elics`; system config
   is `@preact/signals-core` Signals; UI is `@pmndrs/uikit`; systems are built with
   `createSystem(queries, schema)` and tick via `update(delta, time)` **in seconds**
   (three.js `Clock` convention, matching Unity's `Time.deltaTime`).

Source scale: 116 app C# files under `Assets/SpatialLingo/Scripts`. The four largest —
`ExerciseManager.cs` (39 KB), `LessonsManager.cs` (39 KB), `AssistantAI.cs` (38 KB),
`Lesson3DInteractor.cs` (28 KB) — hold the core loop and are the primary porting targets.

### The camera-access problem

The signature loop — point at a real chair, learn the word for chair — depends on raw
camera pixels. On the web that requires the
[WebXR Raw Camera Access module](https://immersive-web.github.io/raw-camera-access/),
whose Quest Browser availability is not dependable as of this writing.

**Decision:** the core loop is rebuilt on WebXR scene understanding instead. Semantic
labels from the WebXR scene graph (table, couch, window, door, floor, ceiling, screen)
supply real-world nouns with no computer vision at all. The camera + YOLO path is added
later behind a capability flag and is never on the critical path.

This constraint is an asset, not a liability: "the source API has no web twin, now what"
is the most useful chapter in the guide.

## Architecture

### Repository layout

pnpm workspace, deployed as a single Vercel project.

```
apps/xr/                IWSDK + Vite WebXR app          → /
apps/docs/              Astro Starlight migration guide → /docs
api/                    Vercel serverless functions     → /api/*
packages/lingo-core/    Pure TypeScript game logic, zero 3D dependencies
tools/asset-pipeline/   Unity FBX/prefab → glTF conversion scripts
```

### `packages/lingo-core` — the load-bearing boundary

Contains the lesson state machine, vocabulary model, pronunciation scoring, and
tree-growth progression. **Imports neither `three` nor any `@iwsdk/*` package.**

- **Does:** owns all game rules and progression state.
- **Used by:** the XR layer drives it by dispatching events and reading state.
- **Depends on:** nothing but TypeScript.

Consequences: game logic is unit-testable with vitest on a laptop, with no headset and no
browser. The XR layer stays thin. And it makes the guide's central claim concrete — what
transfers from Unity is the *logic*, not the MonoBehaviours.

### ECS design (IWSDK)

IWSDK is an ECS built on three.js. Components hold data; systems hold behaviour.

**Components:** `LessonTarget`, `Vocab`, `Companion`, `TreeGrowth`, `Speakable`,
`Highlightable`, `RoomAnchor`

**Systems:**

| System | Responsibility |
| --- | --- |
| `SceneLabelSystem` | Reads WebXR mesh/plane semantic labels, emits candidate lesson targets |
| `TargetSelectionSystem` | Gaze / point / grab selection of a target |
| `LessonSystem` | Thin adapter driving the `lingo-core` state machine |
| `VoiceSystem` | STT/TTS behind a single interface, two swappable adapters |
| `CompanionSystem` | Golly Gosh navigation, animation, gaze |
| `TreeSystem` | Language-tree growth visualisation |
| `UIPanelSystem` | Lesson panels, prompts, feedback |
| `CameraVisionSystem` | *Optional.* `camera-access` + ONNX YOLO. Off by default. |

### Capability-gated degradation

`capabilities.ts` probes at boot for `camera-access`, mesh/plane detection, hand tracking,
and `SpeechRecognition`. The app composes itself from what is actually present. Four tiers,
**all of which must be genuinely playable**:

| Tier | Environment | Behaviour |
| --- | --- | --- |
| 1 | Quest + `camera-access` | Full original loop, YOLO over real objects |
| 2 | Quest, no `camera-access` | Scene-mesh objects. **The default assumption.** |
| 3 | Other WebXR headsets | Virtual props spawned onto detected planes |
| 4 | Desktop browser | Simulated room, mouse/keyboard |

Tier 4 is non-negotiable. A reviewer opening the repo on a laptop must see it run.

### AI backend

- `api/lesson.ts` — generates lessons for a given object and target language.
- `api/evaluate.ts` — scores a pronunciation attempt.
- `api/speech.ts` — optional STT/TTS proxy for the fallback voice adapter.

Model access goes through the Vercel AI Gateway using plain `"provider/model"` strings, so
the deployment can point at Llama (matching the original) or any other provider without a
code change. The original's own README warns that keys must not ship in the app binary —
this proxy is the web answer to exactly that warning, and it becomes Chapter 8.

A bundled static lesson pack covers the default vocabulary set, so `git clone && pnpm dev`
gives the full experience with **no API keys**. The live LLM path is an upgrade, not a
gate. API keys are server-side only and never reach the client bundle.

### Voice

One `VoiceAdapter` interface, two implementations:

- `WebSpeechAdapter` — `SpeechRecognition` + `SpeechSynthesis`. Zero-dependency, zero-cost.
- `ProxyVoiceAdapter` — cloud STT/TTS via `api/speech.ts`.

Quest Browser's Web Speech support is **unverified** and is probed in Phase 1, before
Phase 4 commits to it.

### Assets

Clone the Unity repo with Git LFS, extract Golly Gosh and the language-tree meshes and
animations, convert FBX/prefab → glTF/GLB, optimise through IWSDK's asset tooling.

Unity shaders, custom rigs, and animation controllers do not cross cleanly. Phase 2 runs
early so those surprises surface while there is room to react. Where conversion fails,
author a procedural stand-in and document why the original failed — that failure is guide
material.

Licensing: the source repo is MIT with no asset carve-out and no `LICENSE.md`. To be
re-verified against the actual tree in Phase 0. Attribution notice ships in our repo root.

## The migration guide

Lives in `apps/docs`, Astro Starlight, deployed to `/docs` beside the live demo.
Each chapter is written as its phase completes, not retrofitted at the end.

**Chapters:**

1. **Why port a Unity app to the web** — distribution, no install, the trade-offs
2. **Project setup** — Unity project vs `npm create @iwsdk@latest`, build and deploy models
3. **C# → TypeScript: the code-level translation** *(see below — the anchor chapter)*
4. **Scene understanding** — MRUK vs WebXR mesh/plane detection
5. **Interaction** — Interaction SDK vs IWSDK interaction components
6. **Assets** — FBX/prefab → glTF, what converts, what does not, and what to do about it
7. **Voice** — Voice SDK vs Web Speech API and cloud fallback
8. **AI integration** — embedded keys vs a serverless proxy
9. **When the API has no web twin** — the camera-access story and capability-gated design
10. **Testing without a headset** — IWSDK's MCP + Playwright agent mode in CI
11. **Deploying** — Vercel, HTTPS, headset testing loop
12. **Results** — performance comparison, what was lost, what was gained

### Chapter 3, expanded

Explicitly requested and the chapter Unity developers will arrive for. Side-by-side C# and
TypeScript throughout, drawn from real code in this port rather than invented examples:

- `MonoBehaviour` → ECS component + system: why the data/behaviour split, and how to
  restructure a class that was doing both
- `Update()` / `FixedUpdate()` / `LateUpdate()` → system `update(delta)` and execution order
- `Awake` / `Start` / `OnEnable` / `OnDestroy` → entity lifecycle and system init/teardown
- Coroutines and `yield return` → `async`/`await`, promises, and frame-budget scheduling
- Prefabs → entity factories and glTF instancing
- `ScriptableObject` config → JSON modules and typed schemas
- `GetComponent<T>()` → ECS queries, and why the query is faster and safer
- `Vector3` / `Quaternion` / `Transform` → three.js equivalents, including the
  left-handed vs right-handed coordinate handedness trap and unit conventions
- Unity's `Resources` / Addressables → Vite imports, dynamic `import()`, and asset hashing
- C# events and `UnityEvent` → typed event emitters
- Null-checking a destroyed `GameObject` vs entity invalidation
- `[SerializeField]` inspector tuning → dev UI, hot reload, and config modules
- Static typing differences that actually bite: structs vs objects, value vs reference
  semantics, `float` vs `number`, and integer division
- **When the logic isn't in the code at all** — Spatial Lingo's top-level flow lives in a
  Unity Visual Scripting graph (`AppFlow.asset`), not in C#. How to recover behaviour from a
  serialized graph, and why an explicit TypeScript state machine is the better destination

## Testing

- **`lingo-core`** — vitest unit tests. Full game-logic coverage with no headset, no browser.
- **Runtime** — IWSDK ships an MCP server (32 tools) and a managed Playwright Chromium.
  Drive the app in agent mode, assert ECS state, capture and diff screenshots.
- **CI** — GitHub Actions: typecheck, lint, vitest, build, runtime smoke test.
- **Manual** — Quest Browser pass at the end of every phase. Deployed and playable, always.

## Phases

Each phase ends deployed and playable. Nothing accumulates unshipped.

| # | Phase | Exit criteria |
| --- | --- | --- |
| 0 | Recon | **Done 2026-08-14.** Repo cloned, inventory written, MIT confirmed. See findings above. |
| 1 | Scaffold | IWSDK app deployed to Vercel, capability probe reporting on real hardware, CI green |
| 2 | Assets | Golly Gosh + tree rendering in-headset from GLB, pipeline scripted and documented |
| 3 | Core loop | `lingo-core` + scene-mesh targets + lesson panels playable on static pack |
| 4 | Voice | Speak a word, get scored, on Quest and desktop |
| 5 | AI backend | Live lesson generation and evaluation via Vercel, static fallback intact |
| 6 | Camera + YOLO | *Stretch.* Tier 1 works where `camera-access` exists |
| 7 | Docs + launch | Guide complete, before/after captures, repo public, LinkedIn follow-up |

## Risks

| Risk | Mitigation |
| --- | --- |
| `camera-access` unavailable on Quest Browser | Assumed unavailable by design. Phase 6 is upside only. |
| Web Speech API unsupported on Quest Browser | Probed in Phase 1. Proxy adapter built behind the same interface. |
| Unity assets do not convert cleanly | Phase 2 scheduled early. Procedural stand-ins as fallback, failures documented. |
| Scene semantic labels too coarse for a language app | Supplement with virtual props (Tier 3 mechanism) to widen vocabulary. |
| Guide written too late, details forgotten | Chapters written per-phase, enforced as a phase exit criterion. |
| IWSDK is 0.x (0.5.3, 14 releases) and will churn | Pin exact versions, no `^` ranges. Upgrades are deliberate, isolated commits. |
| WebXR performance below Quest-native | Measure and publish honestly in Chapter 12. An honest comparison is more useful than a flattering one. |

## Open questions

None blocking. Two to resolve during Phase 0 and Phase 1 respectively:

- Exact asset licensing, verified against the cloned tree.
- Web Speech API behaviour on Quest Browser, verified on hardware.

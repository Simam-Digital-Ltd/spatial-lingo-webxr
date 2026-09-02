# Spatial Lingo — WebXR

[![CI](https://github.com/Simam-Digital-Ltd/spatial-lingo-webxr/actions/workflows/ci.yml/badge.svg)](https://github.com/Simam-Digital-Ltd/spatial-lingo-webxr/actions/workflows/ci.yml)

A WebXR port of [Spatial Lingo](https://github.com/oculus-samples/Unity-SpatialLingo), Meta's
open-source Unity Quest app that teaches vocabulary by pointing at real objects in your room.
This port rebuilds the app on [Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk)
(IWSDK) instead of Unity, so it runs in a browser — on a Quest, or on a plain laptop with no
headset at all.

**Try it now: <https://spatial-lingo-webxr.web.app>** — no install, no headset, no account. It
runs in any modern browser; on a Quest the same URL offers a mixed-reality session.

It is a redesign in places, not a straight port. The clearest example: the original finds lesson
targets by running YOLO object detection over the passthrough camera feed; this port finds them
from WebXR's scene-understanding semantic labels instead — no camera, no inference model, but a
smaller, platform-fixed vocabulary of recognizable object types. See
[`docs/migration/04-scene-understanding.md`](docs/migration/04-scene-understanding.md) for the
full comparison, and the rest of `docs/migration/` for how the whole port was done.

## Capability tiers

The app probes what the browser/device actually supports and runs at the highest tier it can
sustain, degrading gracefully rather than requiring a specific device:

| Tier | Requires | What happens |
| --- | --- | --- |
| 1 | `camera-access` WebXR feature, on top of mesh detection | **Structurally unreachable in this build.** IWSDK 0.5.3's session-feature options (`XRFeatureOptions`) have no flag to request `camera-access` at all, so it is never requested and can never come back granted — see `apps/xr/src/capabilities.ts:31`. The four-tier design is three tiers in practice until IWSDK adds that flag or a later phase requests the feature another way. |
| 2 | `immersive-ar` + mesh detection granted | Real scanned-room meshes carrying a WebXR semantic label become lesson targets. If mesh detection is granted but the room was never scanned (no meshes appear), the app waits 4 seconds and then falls back to Tier 3/4's stand-in targets rather than sitting empty. |
| 3 | `immersive-ar` granted, no mesh detection | Six stand-in props spawn on an arc in front of the player, each tagged with a real vocabulary word and carrying a floating word label. |
| 4 | No WebXR at all | The **showroom**: a furnished procedural apartment with thirteen labelled objects, a turntable camera, hover highlighting, and the language tree growing as words are learned. This is the version most people who open the link will see, so it is built as a first-class experience rather than a fallback. |

**Selection input is pointer-only, in every tier.** Tiers 2 and 3 spawn and tag targets in a
passthrough session, but `TargetSelectionSystem` (`apps/xr/src/systems/target-selection.ts`)
only wires up a screen-pointer raycast (mouse and touch), and the word-attempt input is a DOM
`<input>` element with no `dom-overlay` WebXR feature requested to make it reachable in-headset.
So while a real Quest session will correctly spawn and label targets, there is currently no way
to select one or submit an attempt from inside the headset — the lesson loop only runs
end-to-end on desktop (Tier 4, or a mouse over a Tier 2/3 view) until a controller-ray selection
path is added.

Verified live: on desktop, under the production build, the app resolves Tier 4 and runs the full
lesson loop with no headset. Under the [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime)
WebXR emulator, a real `requestSession` grants mesh detection and declines `camera-access`,
resolving to Tier 2 exactly as designed. No physical Quest headset has been used to verify any of
this — see [`docs/migration/00-recon.md`](docs/migration/00-recon.md), which records that
honestly with `PENDING` markers rather than guessing at device behavior.

## Quickstart

```bash
pnpm install
pnpm dev
```

No API keys, no accounts, no headset required. This opens the Vite dev server for the `xr` app;
on a plain browser tab it runs Tier 4's showroom, so you can try the full lesson loop — click an
object, type the word, get scored, watch the tree grow — immediately.

```bash
pnpm test        # 56 tests in packages/lingo-core, 186 in apps/xr
pnpm typecheck    # both packages
pnpm build        # production build of apps/xr
```

### Camera mode

**"Teach me what my camera sees"** runs the MediaPipe Object Detector in WASM on webcam frames.
No key, no server, and the frames are analysed in this process and never uploaded — which is the
entire argument for on-device inference in an app pointed at someone's home. The library is
dynamically imported, so a visitor who never opens the mode downloads none of it.

The honest limit, stated because it is structural rather than a bug: the model knows COCO's 80
everyday-object classes, which cover **5 of the 13** starter-pack words — table, couch, bed, plant
and screen. Window, door, floor, ceiling, wall, lamp, shelf and wall art are not COCO classes and
can never be detected, however clearly they are in frame. The interface says so up front rather
than letting you conclude the camera is broken. Anything the model recognises that the pack has no
word for is shown as "sofa — not in this pack yet" rather than dropped, because the miss is what
tells you the camera is working.

The camera the browser sees is the room *you* are in, while the rendered showroom is a different,
virtual room — so this is a second mode, not an upgrade to the existing one.

### WebXR Capability Report Card

**<https://spatial-lingo-webxr.web.app/report>** — open it on any headset, press one button, and
it tells you what the browser actually granted: enabled session features, semantic labels seen,
hand tracking, mesh and plane counts. Copy the result as JSON or as a Markdown table.

It exists because there is no way to ask, ahead of a session, whether an optional WebXR feature
will be granted — `isSessionSupported` only answers whether a *mode* can be requested. The only
source of truth is `session.enabledFeatures` on a session that actually started, which means
somebody has to put the headset on. This makes that a 90-second job.

Two properties worth knowing:

- **It requests `camera-access` directly**, which this app cannot — IWSDK 0.5.3 has no flag for
  it. So the report card can answer a question the app is structurally unable to ask.
- **It never reports a measurement it did not take.** A feature the device refused reads `false`;
  a check that never ran reads `not measured`.

It is a single self-contained HTML file ([`apps/xr/public/report.html`](apps/xr/public/report.html))
with no dependencies and no build step — save it and run it against any WebXR project.

### The developer route

The Unity original ships a Gym scene — a sandbox for exercising the room and AI systems without a
real scanned room. Here that is a URL rather than a scene, because the showroom and the simulated
room already *are* the sandbox; what was missing was a way to choose between them.

| Switch | Effect |
| --- | --- |
| `?debug` | Corner readout: resolved tier, granted WebXR features, microphone permission, speech-synthesis voice, whether a Gemini key is configured, and the raw lesson-machine state. |
| `?debug&tier=N` | Run as though the device were tier `N` (1–4) — check the fallbacks without owning four devices. |
| `?debug&room=simulated` | Use stand-in objects even where a real room scan exists. |

Nothing here is honoured without `?debug` itself, so a shared link carrying a stray `?tier=4`
cannot serve a degraded app to whoever opens it. Two honest limits: the tier override makes the
app *believe* a feature was granted, it cannot make the device grant one; and the key readout says
a key is configured, not that the model answers — checking that would spend a request on the
learner's own key for a diagnostic they never asked for.

## Repo layout

```
packages/lingo-core/   Lesson rules: state machine, scoring, vocabulary, tree progression.
                        Zero 3D/DOM dependencies, enforced by test/purity.test.ts. Runs and
                        is fully tested in plain Node.
apps/xr/                The WebXR app: IWSDK world setup, capability probing, scene-label
                        and simulated-room systems, the desktop-mouse target-selection input,
                        and the DOM overlay that renders lesson state.
docs/migration/         The migration guide — how this port was built, chapter by chapter.
```

`reference/Unity-SpatialLingo` (the original Unity project, used read-only for citation and
comparison) is **gitignored** and not part of the clone — it's a local-only working directory.
Recreate it yourself if you want it:

```bash
git clone https://github.com/oculus-samples/Unity-SpatialLingo reference/Unity-SpatialLingo
```

## The migration guide

If you're a Unity developer looking at WebXR for the first time, start with
[`docs/migration/01-project-setup.md`](docs/migration/01-project-setup.md) and read in order:

- [`00-recon.md`](docs/migration/00-recon.md) — how the Unity source was inventoried, and the
  (still-pending) real device capability readings.
- [`01-project-setup.md`](docs/migration/01-project-setup.md) — Unity project vs. pnpm workspace,
  why the rules package is dependency-free, and why every dependency is pinned to an exact
  version on this 0.x SDK.
- [`03-csharp-to-typescript.md`](docs/migration/03-csharp-to-typescript.md) — the anchor chapter:
  `MonoBehaviour` → component + system, coroutines → async/query-subscriptions, `Update()` →
  `update(delta, time)`, `GetComponent` → `entity.getValue`, `[SerializeField]` → schemas and
  signals, and what to do when the actual app logic turns out to live in a Unity Visual
  Scripting graph instead of any `.cs` file.
- [`04-scene-understanding.md`](docs/migration/04-scene-understanding.md) — MRUK vs. WebXR mesh
  detection, and why this is a redesign of the core mechanic, not a port of it.
- [`05-tips-and-gotchas.md`](docs/migration/05-tips-and-gotchas.md) — the grab bag: what does and
  does not cross from a Unity project, handedness and Euler order, smoothness vs. roughness,
  shadow frustums, why there is no TextMeshPro, IWSDK-specific traps, and how to test any of it
  without a headset.

## Where this is going

The port is the origin, not the ceiling. `docs/roadmap/` plans the next version:

- [`00-google-stack.md`](docs/roadmap/00-google-stack.md) — voice, grading and vision on Google
  services, and the key/quota strategy that keeps a public demo from becoming a bill.
- [`01-stack-alternatives.md`](docs/roadmap/01-stack-alternatives.md) — every existing piece of the
  stack with a keep/swap/skip verdict.
- [`02-2026-experience.md`](docs/roadmap/02-2026-experience.md) — the target: a tutor that can see
  the room you are in, name anything you point at, and drive the scene while it talks.

## Credit and license

This is a fan/community port. It is **not affiliated with or endorsed by Meta Platforms, Inc.**
The original Spatial Lingo application, and the Immersive Web SDK this port is built on, are
both open-source projects by Meta Platforms, Inc. and affiliates, licensed under the MIT
License. See [`NOTICE`](NOTICE) for the full attribution and links to both upstream projects.

This project itself is licensed under the MIT License. See [`LICENSE`](LICENSE) for the full text.

## Deploying

The live build is on Firebase Hosting. `firebase.json` is committed — it holds only hosting
rules, cache headers, and a `Permissions-Policy` that keeps `xr-spatial-tracking` available while
denying camera and geolocation. It contains no credentials.

`.firebaserc`, which names the deploy target project, is **deliberately git-ignored**, along with
service-account JSON, `.env*`, and the usual key file extensions — see `.gitignore`. This
repository is public, so nothing that grants access to a project is ever committed. To deploy
your own copy:

```bash
firebase login
firebase projects:create your-project-id
echo '{"projects":{"default":"your-project-id"}}' > .firebaserc
pnpm --filter @spatial-lingo/xr build
firebase deploy --only hosting
```

There are no build-time secrets: the vocabulary pack is a static JSON file bundled into the app,
which is why the demo needs no key wall and no backend.

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) typechecks, tests and builds every push to
`master` and every pull request. It then deploys what it just checked — a temporary
[Hosting preview channel](https://firebase.google.com/docs/hosting/test-preview-deploy) for a pull
request, the live site for a merge.

The deploy half is **opt-in**, so a fork gets working checks without owning a Firebase project. To
turn it on for your own copy, add two things to the repository:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `FIREBASE_SERVICE_ACCOUNT` | the full JSON of a service account with the *Firebase Hosting Admin* role |
| Variable | `FIREBASE_PROJECT_ID` | your project id, e.g. `your-project-id` |

Without both, the deploy jobs skip with a notice and the checks still run. The project id is a
variable rather than a literal in the workflow because `.firebaserc` is git-ignored on purpose —
see above.

A pull request opened from a **fork** is checked but never deployed: GitHub does not expose
secrets to fork workflows, which is the behaviour you want on a public repo.

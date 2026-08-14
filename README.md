# Spatial Lingo — WebXR

A WebXR port of [Spatial Lingo](https://github.com/oculus-samples/Unity-SpatialLingo), Meta's
open-source Unity Quest app that teaches vocabulary by pointing at real objects in your room.
This port rebuilds the app on [Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk)
(IWSDK) instead of Unity, so it runs in a browser — on a Quest, or on a plain laptop with no
headset at all.

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
| 3 | `immersive-ar` granted, no mesh detection | Six stand-in boxes spawn on an arc in front of the player, each tagged with a real vocabulary word, so the lesson loop is still playable in a passthrough session with no scene understanding. |
| 4 | No WebXR at all | A plain desktop/browser scene with the same stand-in boxes. This is what makes the project runnable and reviewable without a headset. |

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
on a plain browser tab it runs Tier 4 with stand-in targets, so you can try the full lesson loop
— click a target, type the word, get scored — immediately.

```bash
pnpm test        # 51 tests in packages/lingo-core, 55 in apps/xr
pnpm typecheck    # both packages
pnpm build        # production build of apps/xr
```

## Repo layout

```
packages/lingo-core/   Lesson rules: state machine, scoring, vocabulary, tree progression.
                        Zero 3D/DOM dependencies, enforced by test/purity.test.ts. Runs and
                        is fully tested in plain Node.
apps/xr/                The WebXR app: IWSDK world setup, capability probing, scene-label
                        and simulated-room systems, the desktop-mouse target-selection input,
                        and the DOM overlay that renders lesson state.
docs/migration/         The migration guide — how this port was built, chapter by chapter.
reference/              The original Unity project, read-only, for citation and comparison.
                        Never modified by this port.
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

## Credit and license

This is a fan/community port. It is **not affiliated with or endorsed by Meta Platforms, Inc.**
The original Spatial Lingo application, and the Immersive Web SDK this port is built on, are
both open-source projects by Meta Platforms, Inc. and affiliates, licensed under the MIT
License. See [`NOTICE`](NOTICE) for the full attribution and links to both upstream projects.

This project itself is licensed under the MIT License (see `license` in `package.json`).

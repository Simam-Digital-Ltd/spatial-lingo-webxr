# 00 — Device recon: real WebXR capability readings

This document records what a **physical Meta Quest headset, running Quest Browser**,
actually reports for `session.enabledFeatures` when the app requests its IWSDK
session features (`meshDetection`, `planeDetection`, `handTracking`, `anchors` —
see `apps/xr/src/main.ts`'s `World.create({ xr: { features } })` call).

It answers the spec's open question — does `camera-access` exist on Quest Browser? —
which decides whether Phase 6 (`CameraVisionSystem`, camera + YOLO) is ever worth
starting. See `docs/superpowers/specs/2026-08-14-spatial-lingo-webxr-design.md`,
section "The camera-access problem" and the risk row
`camera-access unavailable on Quest Browser`.

**Status: PENDING — requires physical Quest.** No headset was available in this
environment and no Vercel deployment was made. The code path is implemented and
unit-tested (`apps/xr/test/capabilities.test.ts`), but nobody has pressed "Enter XR"
on a real device yet. Do not treat any value below as measured.

## How to fill this in

1. Deploy the app to a reachable URL:
   ```bash
   pnpm build
   npx vercel deploy
   ```
   (Requires an authenticated `vercel` CLI session — run `vercel login` first if needed.)
2. Put on the Quest headset and open the deployment URL in Quest Browser.
3. Confirm the on-page status panel renders `Tier 3` before entering XR. Quest Browser reports
   `immersive-ar` as supported even with no session started, so `resolveTier` sees
   `immersiveAR: true` with no mesh detection yet and resolves to Tier 3 — not Tier 4, which is
   only what a browser with no WebXR support at all resolves to (see `apps/xr/src/capabilities.ts`'s
   `resolveTier`).
4. Press **Enter XR**. Accept any permission prompts the browser shows (hand tracking,
   scene understanding, etc.) — decline none of them, so the reading reflects the browser's
   actual ceiling, not a user's conservative choice.
5. Read the rendered capability list and the resolved tier off the in-headset panel, and
   also check the browser console for the `[spatial-lingo] capabilities ... tier ...`
   `console.info` line (visible via `adb logcat` or a remote devtools session if you need
   the exact object instead of the rendered check/cross marks).
6. Fill in every `PENDING — requires physical Quest` cell in the table below with the
   observed `true`/`false` and the resolved tier. Record the Quest hardware model (Quest 2 /
   Quest 3 / Quest 3S / Quest Pro) and the Quest Browser (Wolvic/Horizon OS browser) version,
   since feature availability has historically differed across both.
7. Update the "Verdict" section once real data is in.

## Device and environment

| Field | Value |
| --- | --- |
| Quest hardware model | PENDING — requires physical Quest |
| Horizon OS / firmware version | PENDING — requires physical Quest |
| Quest Browser version | PENDING — requires physical Quest |
| Deployment URL tested | PENDING — requires physical Quest |
| Date tested | PENDING — requires physical Quest |
| Tester | PENDING — requires physical Quest |

## Requested features (IWSDK session features, `apps/xr/src/main.ts`)

| Feature | Requested | Enabled on device (`session.enabledFeatures`) |
| --- | --- | --- |
| `local-floor` | yes (IWSDK reference-space default) | PENDING — requires physical Quest |
| `bounded-floor` | yes (IWSDK reference-space default) | PENDING — requires physical Quest |
| `mesh-detection` | yes | PENDING — requires physical Quest |
| `plane-detection` | yes | PENDING — requires physical Quest |
| `hand-tracking` | yes | PENDING — requires physical Quest |
| `anchors` | yes | PENDING — requires physical Quest |
| `camera-access` | no — not requestable in IWSDK 0.5.3 (`XRFeatureOptions` has no `cameraAccess` flag; see below) | PENDING — requires physical Quest |

## Resolved capabilities (from `resolveTier`)

| Capability | Value | Resolved tier |
| --- | --- | --- |
| `immersiveAR` | PENDING — requires physical Quest | — |
| `meshDetection` | PENDING — requires physical Quest | — |
| `planeDetection` | PENDING — requires physical Quest | — |
| `handTracking` | PENDING — requires physical Quest | — |
| `cameraAccess` | PENDING — requires physical Quest | — |
| `speechRecognition` | PENDING — requires physical Quest | — |
| **Overall tier (1–4)** | | PENDING — requires physical Quest |

## Verdict

PENDING — requires physical Quest. Once filled in, this section should state plainly
whether `camera-access` is available on Quest Browser and therefore whether Phase 6
(`CameraVisionSystem`) is worth scheduling, per the spec's decision rule: "the camera +
YOLO path is added later behind a capability flag and is never on the critical path."
If `camera-access` reads `false`, the Tier 2 default assumption in the spec is confirmed
and no further action is needed here.

## Additional findings (non-device, added after initial recon)

These do not fill in any `PENDING` cell above — they record what *was* verified, off-device,
and are kept clearly separate from the device table.

### Tier 1 is structurally unreachable in the current build, independent of the device

`camera-access` cannot read `true` on any device with this codebase as it stands today, not
because of anything Quest Browser does or doesn't grant, but because the app never asks for it.
IWSDK 0.5.3's `XRFeatureOptions` type (`node_modules/@iwsdk/core/dist/init/xr.d.ts`) exposes only
`handTracking`, `anchors`, `hitTest`, `planeDetection`, `meshDetection`, `depthSensing`, `layers`,
and `unbounded` as requestable session features — there is no `cameraAccess` flag. `main.ts`
builds its session via `World.create({ xr: { features } })` using exactly that type, so
`camera-access` is never included in the WebXR feature request, regardless of what the browser
would have granted. This is documented in code at `apps/xr/src/capabilities.ts:31`. It means the
device table above, once filled in, should be expected to show `camera-access: false` even if
Quest Browser itself supports the feature — the missing piece is in this app's IWSDK version, not
(necessarily) in the browser. Reaching Tier 1 needs either an IWSDK upgrade that adds a
camera-access flag, or a later phase that requests the WebXR feature by some other means.

### Emulator verification (IWER, not a device — see caveat below)

`@iwsdk/vite-plugin-dev` bundles Meta's own [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime)
WebXR emulator together with `@iwer/sem` (scene-understanding fixture data). Against that
emulator, a real `requestSession('immersive-ar')` call was made and observed live in-browser:

- Granted: `local-floor bounded-floor mesh-detection plane-detection hand-tracking anchors
  viewer local`
- `camera-access` was requested at the time this verification was run, under an earlier build
  that still had a (since-removed) `OPTIONAL_FEATURES` set including it, and was **not** granted
  by IWER — `cameraAccess: false` in the resulting `Capabilities` object. The current build no
  longer requests `camera-access` at all (see the "Tier 1 is structurally unreachable" section
  above), so this result is now doubly true: unrequested features can't be granted either.
- `capabilitiesFromSession` + `resolveTier` correctly resolved this to **Tier 2**, the spec's
  designed default for "mesh detection without camera access."

`@iwer/sem` ships five pre-scanned rooms (`living_room`, `meeting_room`, `music_room`,
`office_large`, `office_small`), totalling 119 labelled entities, and maps Meta's internal
OpenXR-level semantic labels onto the WebXR standard label set (from `@iwer/sem`'s `entity.js`,
the authoritative source for this mapping): `STORAGE → shelf`, `WALL_FACE → wall`,
`DOOR_FRAME → door`, `WINDOW_FRAME → window`, `WALL_ART → wall art`, `CHAIR → couch`,
`INVISIBLE_WALL_FACE → window`, `GLOBAL_MESH → global mesh`. The starter vocabulary pack covers
114 of the 119 entities across all five rooms; the misses are `global mesh` (×4, correctly
excluded — it's the room shell, not a lesson target) and one `other`. `bed` does not appear in
any of the five fixture rooms.

**Caveat, stated plainly:** this is evidence about IWER's fixture data and about this app's own
capability-resolution code, not evidence about a real Quest headset. An emulator reports the
features and labels its authors chose to implement. Whether Quest Browser's real
`session.enabledFeatures` matches IWER's, and whether real room scans produce the same clean
per-mesh semantic labels the fixture rooms do, remain exactly as unanswered as the `PENDING`
table above states. See `docs/migration/04-scene-understanding.md` for the fuller discussion of
why this distinction matters.

### `World.create()` does not resolve without a compositing environment

Unrelated to the camera-access question, but discovered during the same verification pass and
worth recording here since it affects how *any* future device/CI testing of this app must be
set up: IWSDK's `World.create()` does not resolve its returned promise until a
`requestAnimationFrame` callback actually fires. In a non-compositing environment — a headless
browser pane, a backgrounded tab — no `rAF` ever fires, so `await World.create(...)` hangs
forever with no error and no timeout. Verifying the lesson loop in this environment required
manually injecting a `setTimeout`-based `requestAnimationFrame` shim before the bundle loaded.
Anyone setting up automated device or CI testing against this app needs to account for this.

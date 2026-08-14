# 00 — Device recon: real WebXR capability readings

This document records what a **physical Meta Quest headset, running Quest Browser**,
actually reports for `session.enabledFeatures` when the app requests
`OPTIONAL_FEATURES` (see `apps/xr/src/capabilities.ts`).

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
3. Confirm the on-page status panel renders `Tier 4` before entering XR (desktop/no-session
   baseline — on Quest Browser without a session yet, this is really "no session started",
   which reads the same as Tier 4 until you press the button).
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

## Requested features (`OPTIONAL_FEATURES`)

| Feature | Requested | Enabled on device (`session.enabledFeatures`) |
| --- | --- | --- |
| `local-floor` | yes | PENDING — requires physical Quest |
| `bounded-floor` | yes | PENDING — requires physical Quest |
| `mesh-detection` | yes | PENDING — requires physical Quest |
| `plane-detection` | yes | PENDING — requires physical Quest |
| `hand-tracking` | yes | PENDING — requires physical Quest |
| `anchors` | yes | PENDING — requires physical Quest |
| `camera-access` | yes | PENDING — requires physical Quest |

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

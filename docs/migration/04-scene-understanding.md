# 04 — Scene understanding: MRUK vs. WebXR mesh detection

Read this chapter expecting a redesign, not a port. It's the single most important framing in
this guide: the mechanic that drives the whole app — "point at a real object, learn its word" —
was rebuilt on a different sensing pipeline, not translated line-for-line. Say so plainly to
whoever you're handing this port to, because it changes what "feature parity" even means here.

## What the Unity original actually does

It's tempting to assume `RoomSense.cs`, in `Assets/SpatialLingo/Scripts/Utilities/`, is where
Spatial Lingo finds the objects it teaches words for. It is not. The entire file is 1.9 KB, and
its only job is finding **one spawn point** for something else to appear at:

```csharp
private IEnumerator SpawnCoroutine(FindSpawnPositions spawnPositionFinder)
{
    while (MRUK.Instance == null || MRUK.Instance.GetCurrentRoom() == null)
    {
        yield return null;
    }
    var room = MRUK.Instance.GetCurrentRoom();
    spawnPositionFinder.StartSpawn(room);

    var spawned = FindFirstObjectByType<RoomSenseSpawnObject>();
    // ...
    FindSpawnPosition?.Invoke(new SpawnPositionResult(position, true));
}
```

`MRUK` is Meta's Mixed Reality Utility Kit — it exposes the room's scanned geometry (walls,
floor, furniture volumes) from Quest's on-device scene model. `RoomSense` uses it for exactly
one query: "where in this room can `FindSpawnPositions` legally place something" (the language
tree/Golly Gosh character, per the surrounding scripts). It is not deriving lesson targets. It
never touches object *classification* at all.

The actual object-recognition path — the part that decides "this is a table, teach the word for
table" — is a separate, heavier pipeline:

- `Data/InferenceEngine/ObjectClassifier/yolov9onnx_min_0.2score_0.5iou.sentis` — a YOLOv9 object
  detection model, compiled to Unity Sentis's `.sentis` format, running over the passthrough
  camera feed. `classesYolo.txt` alongside it lists the trained class labels.
- `Meta.Utilities.ObjectClassifier` (`ImageObjectClassifier`, referenced throughout
  `Scripts/Lessons/LessonsManager.cs`) — runs that model against camera frames.
- `Meta.Utilities.CameraTaxonTracking` (`CameraTaxonTracker`, also wired into `LessonsManager`'s
  constructor) — tracks detected objects ("taxa") across frames as the camera moves, associating
  a stable identity and a 3D position/extent with each one via `EnvironmentRaycastManager`
  (raycasting the detection bounding box into the depth-sensed environment).

So the real dependency chain for "what should this lesson teach" in the original is: **camera
frame → YOLO inference (Sentis) → per-frame detections → taxon tracking across frames →
raycast against environment depth → confidence-scored, positioned `Lesson`.** `RoomSense` never
appears in that chain. It's a red herring if you go looking for "the object detection script" —
the file that name suggests it should be is the wrong one.

## What this port does instead

WebXR's scene-understanding features give the browser semantic labels directly off the scanned
scene mesh, with no camera frame and no inference model in the loop. `apps/xr/src/systems/scene-label.ts`
reads them straight off `XRMesh`:

```ts
export class SceneLabelSystem extends createSystem({
  meshes: { required: [XRMesh] },
}) {
  #tagEntity(entity: Entity): void {
    const isBounded = entity.getValue(XRMesh, 'isBounded3D') === true;
    const label = entity.getValue(XRMesh, 'semanticLabel');
    const target = resolveLessonTarget(isBounded, label, this.#pack);
    if (!target) return;
    entity.addComponent(LessonTarget, { label: target.label, word: target.word, learned: false });
  }
}
```

`XRMesh.semanticLabel` is a string the platform assigns to each scanned mesh at scan time — the
labelling happens once, on-device, as part of Room Setup, not per-frame at runtime. There's no
model to load, no inference cost, and — this is the trade worth naming honestly — no camera
permission needed at all for this tier. It's a categorically different, and categorically
coarser, sensing pipeline than YOLO-over-passthrough: WebXR hands you a closed set of semantic
categories chosen by the platform (`table`, `couch`, `wall`, `window`, `door`, `shelf`, and
similar), not an open, trainable model that could in principle recognize anything in
`classesYolo.txt` or beyond. `resolveLessonTarget` (same file) is the pure decision function
that turns a mesh's boundedness and label into a lesson target or `null`:

```ts
export function resolveLessonTarget(
  isBounded: boolean,
  semanticLabel: unknown,
  pack: LessonPack | null,
): ResolvedLessonTarget | null {
  if (!isBounded) return null;
  if (!pack) return null;
  if (typeof semanticLabel !== 'string' || semanticLabel.length === 0) return null;
  const entry = findEntry(pack, semanticLabel);
  if (!entry) return null;
  return { label: entry.label, word: entry.word };
}
```

The `isBounded` guard is what excludes the room-shell reconstruction ("global mesh") from ever
becoming a lesson target — IWSDK's `SceneUnderstandingSystem` reports the room shell with
`isBounded3D: false` specifically, so it's rejected before the vocabulary lookup runs at all,
by construction rather than by an exclusion list.

## What Quest Browser actually reports: known vs. unknown

Here's where this chapter has to be careful, because there are two very different kinds of
evidence in this project and they must not be blurred together.

**What was verified, on desktop, against IWER — Meta's WebXR emulator** (bundled via
`@iwsdk/vite-plugin-dev`, backed by `@iwer/sem`): a real `requestSession('immersive-ar')` call
against the emulator granted `local-floor bounded-floor mesh-detection plane-detection
hand-tracking anchors viewer local`, requested `camera-access` and did **not** get it granted,
and the app's own `capabilitiesFromSession` + `resolveTier` logic correctly resolved that to
Tier 2 — the designed default for a device with mesh detection but no camera access. That's a
real, reproducible result, and it's evidence about how this app's own capability-resolution code
behaves when it hears "no" from a session, not evidence about a headset.

`@iwer/sem` ships five pre-scanned rooms as fixture data — `living_room`, `meeting_room`,
`music_room`, `office_large`, `office_small` — totalling 119 labelled entities, and maps Meta's
internal OpenXR-level semantic labels onto the WebXR standard label set IWSDK expects
(`STORAGE → shelf`, `WALL_FACE → wall`, `DOOR_FRAME → door`, `WINDOW_FRAME → window`,
`CHAIR → couch`, among others — read from `@iwer/sem`'s `entity.js`, the authoritative
source for this mapping). The starter vocabulary pack in this repo covers 114 of those 119
entities; the five misses are `global mesh` (×4, and this is *correct* — see the `isBounded`
guard above, it's the room shell and is supposed to be excluded) and a single `other`. That's a
strong signal that the label vocabulary is well-matched to what a scanned room actually reports.

**But it is a signal about IWER, not about Quest Browser, and that line needs to be drawn
explicitly and not blurred.** IWER is Meta's own emulator, and its fixture rooms are presumably
representative of real Quest scan output — but "presumably representative" is not the same claim
as "measured on device." An emulator reports the features its authors chose to implement and the
labels its authors chose to map. It cannot tell you whether Quest Browser's real
`session.enabledFeatures` actually includes `mesh-detection` and `camera-access` the way the
emulator's does, what the label vocabulary looks like on an unscanned or partially-scanned room,
or whether real-world scan quality (partial occlusion, small objects, cluttered rooms) produces
the same clean per-mesh labels the fixture data does. No physical Quest headset was used in this
project, and no Quest Browser reading was captured. `docs/migration/00-recon.md` records this
honestly: every device field in that document is marked `PENDING — requires physical Quest`, and
it should stay that way until someone actually runs this on hardware. **Do not treat the IWER
coverage numbers above as a proxy for what a real headset will report** — they're a lower bound
on plausibility, not a device measurement.

## The tier fallback design

Because Tier 2's real behaviour on-device is unverified, the app is built to degrade gracefully
rather than assume mesh detection will find anything:

- **Tier 4** (no WebXR at all — plain desktop browser): `SimulatedRoomSystem`
  (`apps/xr/src/systems/simulated-room.ts`) spawns six stand-in boxes on an arc in front of the
  camera, each tagged with the same `LessonTarget` component a real mesh would get. This is what
  keeps the project runnable and reviewable with no headset.
- **Tier 3** (immersive-AR granted, no mesh detection): same simulated-room fallback, spawned
  immediately once the session starts.
- **Tier 2** (mesh detection granted): the app waits for real `XRMesh` entities to qualify.
  But a granted *capability* isn't the same as a *scanned room* — a user who has never run Room
  Setup on their headset will have mesh detection turned on and precisely zero meshes to tag.
  `apps/xr/src/systems/room-fallback.ts`'s `RoomSourceController` handles this: it gives a real
  scan a 4-second grace period (`ROOM_SCAN_GRACE_PERIOD_MS`) after session start, and only falls
  back to the simulated room if nothing real showed up in that window — with the two sources
  (`decideOnGraceTimerFired` / `decideOnRealTargetSeen`) built so they can never both populate
  the room, regardless of which race wins.
- **Tier 1** (camera-access granted): structurally unreachable in the current build. See
  `apps/xr/src/capabilities.ts:31` — IWSDK 0.5.3's `XRFeatureOptions` type has no flag to request
  the `camera-access` WebXR feature at all, so it's never requested, so it can never come back
  granted. The four-tier design in the spec is three tiers in practice until either IWSDK adds
  that flag or a later phase requests the feature some other way. This is documented in code, not
  quietly worked around.

## Practical takeaways

- Before assuming a file is "the sensing code," check what it actually queries. `RoomSense.cs`'s
  name suggests object detection; its body is a spawn-point finder. The real detection pipeline
  in the original is `ImageObjectClassifier` + `CameraTaxonTracker` + `EnvironmentRaycastManager`,
  a different subsystem entirely.
- WebXR scene-understanding semantic labels are a legitimate, much cheaper replacement for
  camera + inference — no model, no per-frame cost, no camera permission — but they trade away
  open-vocabulary detection for a platform-fixed label set. That's a real capability loss and
  should be described as one, not hidden behind "should be equivalent."
- Emulator verification (IWER/`@iwer/sem`) is real, reproducible evidence about your own code's
  behavior against a session that grants and declines features the way a headset might. It is
  not device verification. Keep those two categories of claim visibly separate in your own
  documentation, the way `00-recon.md` does with its `PENDING` markers.

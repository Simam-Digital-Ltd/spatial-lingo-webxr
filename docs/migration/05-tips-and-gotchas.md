# 05 — Tips and gotchas for Unity developers

The other chapters walk through this port in order. This one is a grab bag: the things that
cost time, the things that are not written down anywhere obvious, and the things a Unity
developer is most likely to assume work the way they did in the editor.

Each item is marked with how it is known:

- **[verified]** — hit, fixed, and confirmed in this port.
- **[from source]** — read directly out of IWSDK 0.5.3 or three.js r184 typings in `node_modules`.
- **[general]** — established web/three.js behaviour, not specific to this project.

---

## 1. What crosses the boundary, and what does not

There is no exporter. Nothing about a Unity project converts to a web project — you are
rebuilding, and the only question is which inputs survive as data rather than as code.

| Unity artifact | Crosses? | What to do instead |
| --- | --- | --- |
| C# scripts | No | Rewrite. Chapter 3 maps the idioms one by one. |
| Prefabs, scenes | No | Compose in code, or author a JSON layout you load at runtime. |
| Visual Scripting graphs | No | And they are invisible to a code search — see below. |
| Animation clips, Animator controllers | No | Rebuild as tweens, or export baked animation inside a glTF. |
| FBX / Unity meshes | Indirectly | Export to **glTF/GLB**. This is the one asset format the web actually wants. |
| Textures | Yes | Re-encode: KTX2/Basis for compression, WebP/PNG otherwise. |
| Materials | Partly | Values transfer, shaders do not. See §3. |
| ScriptableObjects | Yes, as data | They are usually just serialized data — emit JSON. |
| Sentis / ONNX models | Not usefully | There is a web inference story, but it is a separate project, not a port. |
| Audio clips | Yes | Re-encode to a web-friendly codec. |

**The trap worth naming first [verified]:** in this project, a meaningful part of the app's
control flow lived in a Unity **Visual Scripting graph**, not in any `.cs` file. If you inventory
a Unity project by reading its scripts, you will conclude that logic is missing rather than that
it lives in an asset. The same applies to inspector-wired references: a `[SerializeField]` that
is only ever assigned in the editor is a dependency your code search cannot see.

Inventory the project *before* translating anything, and be suspicious of any file whose name
tells you what it does. In this port the file that looked like the object-recognition system
turned out to be 1.9 KB of spawn-point lookup.

---

## 2. Coordinates, units, and rotations

- **Handedness [general].** Unity is left-handed, three.js is right-handed. Both are Y-up. In
  practice this means **Z is flipped**: a Unity forward of `+Z` is `-Z` in three.js. Positions,
  rotations about Y, and anything derived from "forward" all need the sign flip. Getting this
  wrong produces a scene that looks right until something rotates.
- **Units [general].** Both use metres. This is the one thing that transfers unchanged, and it
  matters more in XR than it did on a monitor — a couch that is 15% too big is immediately wrong
  when you are standing next to it.
- **Euler order [general].** Unity applies ZXY; three.js defaults to XYZ. Copying three Euler
  numbers across will produce a subtly wrong orientation. Prefer transferring quaternions, or set
  the order explicitly.
- **Delta time [verified].** `Time.deltaTime` and IWSDK's `update(delta, time)` are both in
  **seconds**. Nothing to convert — but note that raw browser timing APIs like
  `performance.now()` are in milliseconds, so an off-by-1000 is easy to introduce the moment you
  step outside the system update signature.

---

## 3. Materials, colour, and lighting

This is where a technically correct port looks bad, and where a Unity developer's instincts are
actively misleading.

- **Smoothness is inverted [general].** Unity's Standard/URP Lit uses *smoothness*; three.js uses
  *roughness*. `roughness ≈ 1 - smoothness`. Copy the number across unchanged and every surface
  reads as either wet plastic or chalk.
- **Metallic/smoothness packing [general].** Unity packs smoothness into the alpha channel of the
  metallic map. three.js expects separate `metalnessMap` and `roughnessMap` (conventionally packed
  into blue and green of one texture). Unpack before you assume the material is broken.
- **Colour space [general].** Colour textures (albedo, emissive) must be tagged sRGB. Data
  textures (normal, roughness, metalness, AO) must not — tagging them sRGB is a common and very
  visible bug: the surface comes out too smooth and too bright.
- **Light intensity does not transfer [general].** Modern three.js uses physically-based light
  units. A Unity intensity of `1` is not a three.js intensity of `1`. Re-light by eye rather than
  by copying numbers.
- **Tone mapping is off by default [verified].** three.js applies no tone mapping unless you ask
  for it. Turning on `ACESFilmicToneMapping` with a modest exposure was, in this port, the single
  largest visual improvement per line of code — it is most of the difference between "procedural
  test level" and "interior".

---

## 4. Shadows will disappoint you until you size the frustum

**[verified]** Shadows are off by default. Turning them on is one line; getting them to look like
anything is not.

A `DirectionalLight`'s shadow camera defaults to a 10 m cube centred on the origin. Anything
outside that box gets no shadow at all, and everything inside gets a low effective resolution
because the map is being spent on empty space. Size the shadow camera's frustum to the actual
extent of your scene, then raise the map size. In this port, that plus a small negative bias took
shadows from "aliased mess" to "usable" without touching anything else.

There is no lightmapping and no baked GI. What you get is what you light in real time.

---

## 5. There is no TextMeshPro

**[verified]** Text is genuinely harder on the web than in Unity, and it is worth deciding early
which of three routes you are on:

1. **DOM text over the canvas.** Cheapest, sharpest, most accessible, fully styleable — and
   invisible inside an immersive session unless you request the `dom-overlay` feature. This is
   what this port uses for its 2D interface.
2. **Canvas-texture sprites.** Draw the string to a 2D canvas, upload it as a texture, put it on a
   sprite. Works everywhere including in-headset, costs one texture per label, and is what this
   port uses for world-space word labels.
3. **MSDF text via IWSDK's spatial UI.** Proper world-space UI with crisp text at any distance.
   Be aware of the cost: enabling `spatialUI` pulls the MSDF font-atlas generator and bundled
   typefaces into the build. Measured here, that was several megabytes of font chunks — worth it
   if you use the UI, pure weight if you do not.

---

## 6. Input: there is no Interaction SDK

**[verified]** The single biggest ergonomic drop from Unity. There is no poke interactor, no ray
interactor, no grab component you can drop on an object and have it work in both hands.

- IWSDK forwards DOM pointer events from the canvas into the three.js scene by default
  (`input.canvasPointerEvents`), so a mouse and touch path is close to free **[from source]**.
- Controller and hand-ray selection is a separate path. Do not assume that because pointer
  selection works on desktop, it works in a headset. In this port it does not, and that gap is
  documented rather than implied.
- IWSDK does ship opt-in `grabbing` and `locomotion` feature systems, both off by default
  **[from source]** — check those before writing your own.

**A hard browser rule [general]:** an immersive session can only be requested from a user
gesture. You cannot auto-enter XR on page load. Budget for an explicit "enter" button in the
design, because you will be adding one regardless.

---

## 7. Audio does not start until the user clicks

**[general]** Browsers suspend audio until a user gesture. An `AudioManager` port that plays a
sound on scene load will silently do nothing, with no error. Route your first playback through
the same gesture that starts the experience.

IWSDK ships an audio system with positional audio and an asset-manifest loader **[from source]**,
so this is a matter of wiring, not of building from scratch.

---

## 8. Physics is opt-in and is not Unity's

**[from source]** IWSDK exposes a `physics` feature flag backed by Havok, off by default. There is
no `Rigidbody` you attach and no implicit collider on a mesh. If your Unity scene relied on
colliders for anything other than physics — triggers, raycast filtering, interaction volumes —
plan to rebuild those explicitly rather than expecting them to come along with the geometry.

---

## 9. Scenes and prefabs: what to use instead

Three options, in increasing order of ambition:

1. **Build in code.** Fine for a small scene, and it makes the layout diff-able. This port keeps a
   single `ROOM_LAYOUT` object mapping semantic names to positions — one file to edit when the
   room feels wrong, no scene file, no editor.
2. **Load a level JSON.** IWSDK's `World.create` accepts a `level` URL, and an `assets` manifest
   that preloads before the first frame **[from source]** — the closest thing to a scene file in
   the SDK.
3. **glTF as your prefab format.** For anything authored in a DCC tool, GLB is the unit of
   composition. Bake transforms and materials in, load once, clone as needed.

**Player prefs [general]:** `PlayerPrefs` maps onto `localStorage`. Both are synchronous
key–value string stores. Neither is a save system, in either engine.

---

## 10. IWSDK gotchas specifically

Everything here is read out of 0.5.3's own typings or was hit during this port.

- **Optional vs required features [from source].** `feature: true` requests a feature as
  *optional*; `{ required: true }` makes it mandatory. A required feature that the device does not
  support fails the whole session request. Default to optional and check
  `session.enabledFeatures` afterwards, rather than assuming what you asked for is what you got.
- **`layers` is requested even if you never mention it [from source].** It defaults to optional to
  maximise session-start success.
- **Not every WebXR feature has a flag [verified].** `XRFeatureOptions` in 0.5.3 has no
  `camera-access` entry, so that feature cannot be requested through the structured API at all.
  Before planning a feature around a capability, check that the SDK version you are pinned to can
  actually ask for it.
- **`features.camera` is not camera access [verified].** The world-level `camera` flag is an
  ordinary webcam stream via `getUserMedia`, not pose-aligned passthrough frames. The names are
  close enough to cost an afternoon.
- **Create one world, not one per mode [verified].** It is tempting to build a browser world and
  then a second XR world when the user enters a session. Two worlds in one container means two
  renderers, two canvases, and two render loops. Build one world up front and swap its *contents*.
- **Camera restore on exit [from source].** IWSDK restores `world.camera` to its pre-XR transform
  when a session ends (`restoreCameraOnExit`, on by default), because otherwise the renderer
  leaves the camera at the last head pose and your 2D view is stuck inside the user's head. If you
  drive your own camera, know this is happening.
- **`World.create()` never resolves without a `requestAnimationFrame` [verified].** In a
  backgrounded tab, a non-compositing embedded pane, or a headless browser with no frame loop, the
  promise hangs forever with no error and no timeout. This is the single most confusing failure
  mode in the SDK, and it dictates how you set up any automated testing (see §12).

---

## 11. Performance: a different budget, same instincts

Your Unity instincts about draw calls, overdraw, and texture memory all still apply — Quest is the
same GPU it always was. What changes is what you can spend up front.

- **Download size is now a gameplay constraint [verified].** A Unity build is installed once. A web
  build is downloaded before anyone sees anything. This port ships a ~1.7 MB gzipped main bundle
  and that is on the heavy side of comfortable.
- **Turn off feature systems you do not use [verified].** They cost bundle weight even when unused
  at runtime.
- **Cap the pixel ratio [verified].** On a 3× phone screen the extra pixels cost far more than they
  show. Clamping `setPixelRatio` to 2 is nearly free visually.
- **Stereo doubles your per-frame cost.** A scene that is comfortable on a monitor is not
  automatically comfortable in a headset. `renderer.xr.setFoveation` exists **[from source]** and
  is worth reaching for before you start cutting geometry.
- **Build the scene deterministically [verified].** Generating props with `Math.random` means the
  room reshuffles on every load, which makes before/after screenshots useless for review. A hashed
  sine keyed on an index gives you variety that is identical every run.
- **Damp frame-rate independently [verified].** `value += (target - value) * 0.1` is tied to frame
  rate and behaves differently at 60 Hz and 90 Hz. Use `1 - Math.exp(-rate * delta)` as the blend
  factor instead.

---

## 12. Testing and debugging without a headset in your hand

- **Put the rules where a headset cannot reach them [verified].** The highest-leverage decision in
  this whole port: lesson state, scoring, and progression live in a package that cannot import the
  renderer, enforced by a test that parses every import. The result is a full test suite that runs
  under plain Node in milliseconds. Do this on day one, not after the app works.
- **Use the WebXR emulator [verified].** Meta's IWER, bundled with IWSDK's dev plugin, serves real
  `requestSession` calls and ships pre-scanned fixture rooms with semantic labels. It is the
  fastest way to exercise a scene-understanding path. It tells you nothing about what a real device
  reports — treat it as a fixture, not as evidence.
- **Headless CI needs a frame loop [verified].** Because of the `World.create` behaviour in §10,
  anything that renders needs a real compositing browser, or a shim that fakes
  `requestAnimationFrame` before the bundle loads. Plan for this before you write the CI job.
- **Remote-debug the device browser [general].** Quest's browser supports remote inspection over
  ADB from desktop Chrome, which gives you a real console and network panel against the headset.
  This is the only way to find out what the device actually granted.
- **Write down what you have not tested [verified].** In this repo, every device-capability cell is
  marked `PENDING` rather than filled with a plausible guess. A blank you can see is worth more
  than a number you cannot trust.

---

## 13. Shipping

- **HTTPS is mandatory [general].** WebXR requires a secure context. `localhost` counts; the LAN
  address you use to test from the headset does not, so you need dev certificates for on-device
  testing.
- **Set a permissions policy [verified].** Keep `xr-spatial-tracking` available and deny what you
  do not use. It is one header and it is the difference between a session starting and silently
  not being offered.
- **Cache the hash, not the entry [verified].** Serve hashed asset files as immutable and the HTML
  entry point as no-cache, or returning visitors get a stale app pointed at deleted bundles. Watch
  for the case where "clean URLs" serves your entry from `/` rather than `/index.html` — the rule
  has to match the path actually served.
- **Keep credentials out of a public repo [verified].** Hosting *config* is safe to commit;
  anything naming a deploy target or granting access to it is not. Ignore key shapes by extension
  so a stray file is ignored by default rather than by someone remembering.
- **Check the licence on the art [general].** An MIT-licensed Unity sample does not necessarily
  mean every asset inside it may be redistributed. Building props procedurally sidesteps the
  question entirely, which is one reason this port carries no binary art at all.

---

## 14. The three habits that generalised

1. **Put every rule that does not need a scene graph where it cannot reach one**, and enforce that
   with a test rather than a comment.
2. **Name your redesigns out loud.** One sentence — "this mechanic was rebuilt on a different
   sensing pipeline" — prevents months of arguments about feature parity.
3. **Pin exact versions on a 0.x SDK.** A minor bump is a breaking change more often than not, and
   the whole platform layer of your app sits behind that one dependency.

# Roadmap — what the 2026 version is

The first two roadmap documents ask "how do we close the gap with the Unity original". That is the
wrong ceiling. The original was designed in 2023 around what a Quest could do with an on-device
YOLO model and a text-completion API, and matching it exactly would land us in 2023 with extra
steps.

This document sets a different target: **a language tutor that can see the room you are in, talk
with you about it, and drive the scene while it does.** The port stays the origin story. It stops
being the product.

Everything here is additive to a build that already works, and everything degrades — the tier
system in the code exists precisely so that ambitious paths can fail without taking the app with
them.

---

## The reframe

| The 2023 shape | The 2026 shape |
| --- | --- |
| Fixed 80-class detector picks from a closed vocabulary | Point at anything; the model names it |
| Speak, get transcribed, get graded | Hold a conversation with something that can see what you see |
| A tree that grows on a word count | A tutor that knows what you keep getting wrong |
| One authored room, one language | Your room becomes the syllabus, in any language |
| A human plays it | An agent can play it too — which makes it testable |

---

## 1. The live tutor — one capability instead of three

`00-google-stack.md` plans voice, grading and vision as three separate phases with three separate
integrations. The Gemini **Live API** collapses them: a bidirectional streaming session that takes
microphone and camera in, returns speech out, and supports **function calling** in the middle of
the conversation.

That last part is what makes it a spatial experience rather than a chat window bolted onto a 3D
scene. The tutor gets tools that reach into the app:

- `highlight_object(label)` — the couch glows while it is being talked about.
- `start_lesson(label)` / `record_result(label, verdict)` — the existing lesson machine, driven by
  the conversation instead of by a click.
- `get_progress()` — so it can say "you have had *ventana* wrong twice, try again" rather than
  guessing.
- `grow_tree()` — the celebration fires because you earned it in conversation.

The state machine, scoring and progression stay exactly where they are. The model becomes a new
*input* to the loop that already exists, which is why this is an addition rather than a rewrite.

**It also changes the key problem.** The Live API supports short-lived ephemeral auth tokens
intended for client-side use: a tiny server endpoint mints a token, the browser opens the stream
directly to Google, and the long-lived key never leaves the server. The proxy in `00` shrinks from
"a service that forwards every request" to "a function that mints a token and counts sessions" —
less code, less latency, less to abuse. Verify the current auth options and session limits before
designing around it.

**The honest caveats:** streaming audio and video is materially more expensive per minute than a
two-hundred-token grade call, so session length caps matter more than request counts. Latency and
mobile battery both need measuring rather than assuming. And this path needs a network, so the
offline tier from `00` stays exactly as planned — it is what the app is when the tutor is
unavailable.

---

## 2. Point at anything

The port's most-apologised-for limitation is that WebXR semantic labels are a closed set: it
teaches furniture, not your coffee mug. Two web-native pieces remove that ceiling entirely.

- **On-device detection** (MediaPipe Tasks, or the original YOLOv9 ONNX through ONNX Runtime Web)
  finds *that there is a thing there* and where it is. Free, private, no round trip.
- **A multimodal model names it** — a single cropped region, not a video stream, sent once on
  demand. "That is a mug. *Una taza.*"

The vocabulary stops being a JSON file we maintain and becomes whatever the learner points at.
Cache aggressively by crop hash: the same mug should cost one call, ever.

Worth noting what this fixes conceptually. The Unity original's YOLO model was limited to 80 COCO
classes; the port's semantic labels are limited to a dozen room categories. Both are closed sets.
This is the first version of the idea that is not.

---

## 3. Your room becomes the syllabus

Today the room is authored and the pack is hand-written. Put those two together with the above and
the app can build a lesson pack from **the room the learner is actually in** — scan or camera pass,
detect what is there, generate a pack for those objects in the target language, cache it locally,
and teach that.

This is the version of the original idea the original could not build. It also makes the app
genuinely different for each person, which is the difference between a demo and something someone
opens twice.

---

## 4. Hands, without a headset

MediaPipe hand landmarks run on a plain webcam. That means **pointing at the couch with your
finger** works on a laptop, with no headset and no controllers — the interaction the Unity build
needed a Quest for, available at the tier most visitors are on.

It also quietly fixes the gap that is currently in the README: selection is pointer-only. A pinch
or a point becomes a second input path, and the same gesture code is what a headset session would
want anyway.

---

## 5. Make it agent-playable

Ship an **MCP server** exposing the lesson loop as tools — `list_targets`, `look_at`, `answer`,
`get_progress`. Three consequences, in increasing order of interest:

1. **It is a genuinely novel demo.** "An AI plays my language app" is a thing almost nobody has
   built, and it costs a small server rather than a research project.
2. **It is a test harness.** An agent driving the real loop through the real interface is a
   playtest that runs in CI — far more convincing than the synthetic pointer events the current
   screenshot harness fires.
3. **It is where the browser is going.** In-page agent tooling — an app exposing its own tools to
   an agent running in the browser — is an emerging pattern with proposals in flight. Building the
   MCP surface now means the in-browser version is a binding, not a rebuild. Treat specifics as
   unstable and design the tool surface, not the transport.

---

## 6. The unglamorous one that matters most

None of the above makes it a good *learning* app. Spaced repetition does.

A scheduling algorithm over the learned set — which words are due, which are weak, what to ask
next — is pure logic with no dependencies, it belongs in `lingo-core` beside the scorer, it is
fully testable in Node, it costs nothing to run, and it is the difference between a toy someone
tries once and something that is worth opening tomorrow.

Do this one regardless of whether any of the rest happens.

---

## What this changes about the existing plan

- **Phases 1–3 of `00` merge** into the live tutor for the online path, while the offline path
  (pre-rendered audio, deterministic scoring, on-device detection) stays exactly as specified and
  becomes more important, not less — it is the fallback for everything above.
- **The proxy shrinks** from a request forwarder to a token minter plus a session counter.
- **The word-cloud scene stops being a port target.** A conversation with a tutor that can see the
  room supersedes it; rebuild the sample only if the sample itself is the point.
- **The camera tier is no longer blocked.** It runs on the browser tier today through an ordinary
  webcam, and only the in-headset passthrough variant waits on the SDK.

## What does not change

The constraints are what make the ambitious version safe to attempt:

- The rules package stays free of network clients and model calls, enforced by the existing test.
- Every capability is feature-flagged and degrades to the current behaviour.
- The app keeps working with every service switched off, offline, and forever.
- No key is ever committed; ephemeral tokens are minted server-side and expire.
- Camera and microphone are opt-in, per session, with a plain explanation of where the data goes —
  on-device detection stays on-device, and anything streamed to a model is named as such.
- Nothing is described as working on a headset until it has been run on one.

## How to describe it

Not "a Unity sample ported to WebXR". That is the origin, and it belongs in the second paragraph.

**A WebXR language tutor that can see the room you are in.** Runs in a browser tab, works on a
laptop, gets better with a headset, and started life as a Quest-only Unity demo that nobody could
open.

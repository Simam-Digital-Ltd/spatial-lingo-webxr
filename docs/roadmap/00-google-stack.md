# Roadmap — closing the gap on a Google stack

The four Unity sample scenes that were never ported each demonstrate a Meta SDK: Voice SDK
(Wit.ai), Llama, Unity Sentis, and the Passthrough Camera API. Three of those have no WebXR
equivalent at all, which is why the gap has stayed open.

This plan rebuilds the same four capabilities on Google's services instead — **Cloud
Speech-to-Text and Text-to-Speech** for voice, **Gemini / LearnLM** for language teaching and
grading, and **MediaPipe + Cloud Vision** for semantic vision. It is a plan, not an
implementation: nothing below has been built yet.

Everything already deployed stays as it is. Each capability is additive, feature-flagged, and
degrades to the current behaviour when its service is unavailable or the visitor declines a
permission.

---

## The one architectural consequence, stated first

**Today this app is a static site with no backend.** That is why it deploys as a folder of files,
costs nothing to run, has no keys to leak, and cannot be abused.

Every hosted Google service needs an API key, and **an API key in a client-side bundle is a
public API key** — obfuscation does not help, and a static host has nowhere else to put it. So
each capability below has to answer one question before anything else: *does it need a server?*

| Capability | Needs a server? | Why |
| --- | --- | --- |
| Pronunciation audio (TTS) | **No** | The vocabulary is 13 fixed words. Synthesise at build time, ship the audio as static files. |
| Speech input (STT) | **No**, at first | The browser's own Web Speech API needs no key. Cloud STT is a later upgrade that does. |
| Lesson grading, word clouds (Gemini) | **Yes** | Prompts are dynamic; the key must stay server-side. |
| Live object recognition (MediaPipe) | **No** | The model runs on-device in the browser. No key, no upload, no per-call cost. |
| Scene description (Cloud Vision / Gemini vision) | **Yes** | Same key problem as grading. |

So two of the four scenes can ship with **no backend at all**, and the two that cannot share a
single small proxy. That proxy is the one new piece of infrastructure this whole roadmap
introduces.

### The proxy, once

A single Cloud Function (or Cloud Run service) in the existing Firebase project:

- Holds the Gemini and Cloud API keys in server-side config. Nothing lands in the repo — the
  existing `.gitignore` rules already cover `.env*` and service-account JSON.
- Exposes two or three narrow endpoints (`/grade`, `/wordcloud`, `/describe`) rather than
  proxying the Google API surface — a general-purpose proxy is a free Gemini key for the whole
  internet.
- Enforces **App Check**, a per-IP rate limit, a hard monthly spend cap, and a maximum prompt
  size. A public demo with an unmetered LLM behind it is a bill waiting to happen.
- Returns a structured verdict, never raw model text passed straight to the UI.

---

## Key strategy: three tiers, and the model is the only metered thing

Worth narrowing the problem before solving it. Voice is pre-rendered at build time or runs in the
browser; vision runs on-device in WASM. **None of that is metered.** The only thing that ever costs
money per use is the language model, and only on the sentence-grading and word-cloud paths.

So the app ships with three levels, and the first one needs no key at all.

### Tier A — no key, and it never expires

The default for every visitor. Deterministic Levenshtein scoring (already built and tested),
pre-rendered pronunciation audio, on-device object recognition, and **pre-generated word clouds
committed as JSON**. The pack is 13 entries; its word clouds are generated once, offline, by a
script that runs on a developer machine, and are static content from then on.

This is the important design move, not a fallback: it takes the entire `/wordcloud` endpoint out of
the runtime. A demo that calls a model on every lesson start is paying repeatedly to produce the
same eight words.

Tier A is what the link does when the budget is gone, when the proxy is down, and in five years
when nobody is paying the bill.

### Tier B — the shared demo key, on a hard leash

For the "say a whole sentence and have it actually understood" moment, which is the only thing
Tier A genuinely cannot do.

- **Firebase App Check** so only the deployed app can call the endpoint. It is not airtight — a
  determined person can extract a token — but it removes casual scraping entirely.
- **A global daily budget counter**, checked and incremented in a transaction before each model
  call. When the day's allowance is spent, the endpoint returns "unavailable" and the app silently
  drops to Tier A. Set it low: a few hundred calls a day is a generous demo and a trivial bill.
- **A per-client daily cap** keyed on App Check token and IP, so one visitor cannot spend the
  global budget alone. Ten to twenty grades a day per person is far more than a demo visit needs.
- **A hard cap on request size** — reject anything over a couple of hundred characters before it
  reaches the model. This is a cost control and an abuse control at once: a capped input cannot be
  used to smuggle a long prompt through the endpoint.

**Do not rely on Google Cloud budget alerts as a stop.** They notify; they do not halt spend. The
only reliable hard stop is the counter in your own code. Alerts are the second line, not the first.

### Tier C — bring your own key

For anyone who wants it uncapped, including us during development.

- A settings panel takes a Gemini API key, stores it in `localStorage`, and calls Google directly
  from the browser. It never touches our proxy and never reaches our server.
- The key stays on that device. Say so in the copy, and give it a visible "forget this key"
  control.
- Link out to how to create a key, and state plainly that it will be readable by anyone with
  access to that browser profile — a browser is not a secret store, and the honest framing is what
  makes this a reasonable thing to offer at all.
- Verify at implementation: whether the Generative Language endpoint permits direct browser calls
  from an arbitrary origin, and which key restrictions Google supports for it. If browser-direct
  calls are not workable, the same key can be passed through the existing proxy per request
  instead — the proxy uses it and never persists it.

BYOK also settles the fork-and-deploy case: anyone running their own copy supplies their own key
and owes us nothing.

---

## Spending as few tokens as possible

Every technique below removes calls rather than shrinking them, which is the only optimisation
that scales.

1. **Never call the model for a single word.** Comparing one word against one expected answer is
   what the existing scorer does, correctly and for free. The model is reserved for free-form
   sentences, which is one path in the app.
2. **Precompute everything that does not depend on the learner.** Word clouds, related words and
   example sentences are functions of the pack, not of the session. Generate offline, commit the
   JSON, spend nothing at runtime.
3. **Cache on a hash of (target word, normalised transcript).** Learners converge on the same
   handful of sentences, so a shared cache turns the popular cases into zero-token responses — and
   the normalisation function for that hash already exists in the scorer.
4. **Send the one entry, never the pack.** The prompt needs the target word and the transcript. It
   does not need thirteen vocabulary entries, the tier table, or conversation history — there is no
   conversation.
5. **Constrain the output to a small schema** — a verdict from a fixed set plus one short feedback
   sentence — and set an explicit low output-token ceiling. No reasoning traces, no restatement of
   the question, no encouragement paragraph.
6. **Use the cheapest model tier that can do it.** Deciding whether a short Spanish sentence uses a
   word correctly is not a frontier-model task. The smallest current Flash-class model is the right
   default, and worth re-benchmarking rather than assuming.
7. **Truncate the transcript before sending**, to the same cap the endpoint enforces.
8. **Check the free tier first.** The Gemini API publishes free-tier rate limits that may cover a
   demo outright. Verify the current limits before provisioning paid billing at all.

Rough shape of one grade call under this design: a short system instruction, one target word and
one capped transcript in; a two-field JSON object out. That is a couple of hundred tokens round
trip, which at current Flash-class pricing makes a day of demo traffic a rounding error — but
verify current rates rather than trusting that sentence.

**Measure first, then set the leash.** Log tokens per call from day one, watch the first week, and
set the daily budget from observed usage rather than from an estimate.

---

## Where the pieces map

| Unity original | Google replacement | Runs where |
| --- | --- | --- |
| Voice SDK / Wit.ai transcription | Web Speech API, then Cloud Speech-to-Text | Browser, then proxy |
| Voice SDK synthesis | Cloud Text-to-Speech, pre-rendered | Build step |
| Llama grading, word clouds, related words | Gemini (LearnLM line for pedagogy) | Proxy |
| Unity Sentis + YOLOv9 | MediaPipe Object Detector (WASM, on-device) | Browser |
| Passthrough Camera API | `getUserMedia` webcam on the browser tier | Browser |
| MRUK room geometry | WebXR scene understanding (already done) | Browser |

Two notes on that table.

**Model names go stale.** Verify the current Gemini model IDs and whether the LearnLM line is
still published separately or has been folded into mainline Gemini before writing any code
against it. Treat every model ID in this document as a family, not a literal string.

**The camera verdict changes.** The earlier "structurally blocked" finding was about *passthrough*
frames inside a headset session, and it still holds — IWSDK 0.5.3 cannot request `camera-access`.
But the browser tier has an ordinary webcam available through `getUserMedia`, which IWSDK exposes
via its `features.camera` flag. **The Camera Image scene is buildable today on desktop and phone.**
Only the in-headset version stays blocked.

---

## Phase 1 — Voice, without a backend

The largest single divergence from the original: Spatial Lingo is a *speaking* exercise and this
port makes you type. This phase changes that, and needs no key and no server.

### 1a. Hear the word (pre-rendered TTS)

The vocabulary is a fixed pack of 13 entries. There is no reason to synthesise at runtime.

- A build-time script calls Cloud Text-to-Speech once per entry — the word, the article + word,
  and the example sentence — and writes static audio into the app's assets.
- The generated files are committed or built in CI; the script needs a key, the app does not.
- The player gets a speaker button on the lesson card and on each world-space label.

**Fix the pack first.** The current entries are stored without diacritics (`sofa`, `lampara`,
`esta`). Scoring strips accents anyway, so this never mattered — but a TTS engine reading
`lampara` will stress the wrong syllable. Add a separate accented display/speech field and leave
the comparison field as-is, so no scoring test changes.

Acceptance: every entry has audio; the app plays a word within 100 ms of a click, offline, with no
network call at lesson time.

### 1b. Say the word (Web Speech API)

- A microphone button on the lesson card starts recognition with the language set from the pack.
- The transcript feeds the **existing** `scoreAttempt` path — the same Levenshtein scoring, the
  same three-tries accounting, the same verdicts. Voice becomes a second input method, not a
  second lesson loop.
- Typing stays. It is the fallback when the microphone is denied, unavailable, or too noisy, and
  it is the only input that works in a quiet room at 1 a.m.

Risks worth planning around: Web Speech is not implemented uniformly across browsers, Chrome's
implementation is server-backed (so it is not actually offline, and not actually private), and
support in the Quest browser is unverified. Feature-detect and hide the button rather than
showing a control that does nothing.

### 1c. Pronunciation scoring — deliberately deferred

A transcript match tells you the learner said the right *word*. It does not tell you they said it
well. Real pronunciation assessment needs phoneme-level confidence, which is a different class of
service. Ship 1a and 1b, then decide whether it is worth it.

**Effort:** small. **Server:** none. **Unlocks:** the SpeechToText, TextToSpeech, Transcription and
VoiceSynthesize sample scenes, and the original's core mechanic.

---

## Phase 2 — Word cloud and grading, on Gemini

This is the scene that needs both missing subsystems at once, which is why it comes after voice.

### What the scene is

The learner is shown a cluster of related words and speaks a sentence using them. The original
sends the response to Llama, which decides whether it was good enough to complete the lesson.

### How it rebuilds

- **The cloud itself is nearly free.** It is a set of world-space labels arranged in a sphere —
  the sprite-label code from `scene/labels.ts` already does exactly this. The work is layout and
  the reveal animation, not new rendering.
- **Word generation** goes through `/wordcloud`: given a target word and the learner's level,
  return 6–8 related words with a strict JSON schema. Generate ahead of time for the 13 entries
  and cache; only regenerate when the pack changes. A demo that calls an LLM on every lesson start
  is spending money to produce the same eight words repeatedly.
- **Grading** goes through `/grade`: given the target vocabulary and the transcript, return a
  verdict plus one short piece of feedback, again schema-constrained. This is where the LearnLM
  line earns its place if it is still available — it is tuned for exactly this kind of
  instructional response.

### The rules that must not move

`packages/lingo-core` cannot import a network client — the purity test forbids it, and that
boundary is the most valuable structural decision in the project. So:

- The core exposes a verdict *type* and the deterministic scorer.
- The app layer calls the proxy and hands the core a verdict.
- Grading stays testable offline with fixture responses, and the app still works with the LLM
  path switched off — it falls back to the Levenshtein scorer.

**Never let model output drive game state directly.** Validate against a schema, clamp the
verdict to the known set, and treat a malformed response as "service unavailable", not as a
failed answer.

**Effort:** medium. **Server:** required. **Unlocks:** Word Cloud, LlamaAPI and AssistantAI sample
scenes.

---

## Phase 3 — Semantic vision, on-device first

The Unity original's real mechanic: point the camera at a thing, a model says what it is, and that
becomes the lesson. This is the part everyone remembers, and the part this port replaced with
platform semantic labels.

### 3a. MediaPipe in the browser (no key, no server, no upload)

- Request the webcam through `getUserMedia` behind an explicit, clearly-worded permission prompt.
- Run the MediaPipe Object Detector in WASM on the video frames — a direct analogue of what Sentis
  was doing on-device in Unity, and the reason to prefer it over a cloud call: no per-frame cost,
  no round trip, and the frames never leave the machine. In a language app pointed at someone's
  home, that last point is the whole argument.
- Map detections to pack entries by label. Anything not in the pack is shown as "not in this
  lesson pack yet" rather than silently ignored — the miss is more interesting than the hit.
- Throttle inference hard. A detection pass every few hundred milliseconds is plenty; per-frame
  inference will wreck the frame budget of a scene that is also rendering a room.

### 3b. Cloud enrichment, optional

For open-vocabulary description — "what is in this picture" rather than "which of my 13 words is
in it" — a single Gemini vision call through `/describe`, on an explicit button press, never on a
timer. One call per user action, hard-capped.

### 3c. In-headset, still blocked

Passthrough frames remain unavailable until IWSDK can request `camera-access`. Track the SDK
rather than planning around it. Note the honest limitation: on the browser tier the camera sees
the *room the visitor is in*, while the rendered showroom is a different, virtual room — so this
is a second mode ("teach me what my camera sees"), not an upgrade to the existing one.

**Effort:** medium. **Server:** none for 3a. **Unlocks:** Camera Image, ObjectRecognition and
PassthroughHighlighting sample scenes, on the browser tier.

---

## Phase 4 — The character

No Google service substitutes here — this is animation and behaviour, and it is the only item on
the list with no platform blocker and no API cost. It is also the largest art cost.

Scope it small: a stylised low-poly companion built from primitives like the rest of the scene,
with idle, celebrate, and point-at-target states, and a look-at constraint. It does not need to be
Golly Gosh; it needs to be *someone in the room with you*. Voice from Phase 1 gives it a
voice for free.

**Effort:** large, mostly art. **Server:** none.

---

## Phase 5 — The gym scene, as a debug route

The Unity Gym scene is a developer sandbox for exercising the AI, camera and room systems without
a real scanned room. The closest thing here is already built — the simulated room and the browser
showroom serve that purpose.

Finish the idea rather than porting the scene: put the existing `?debug` diagnostics panel, a tier
override, a "force the fallback room" switch, and per-service health readouts (proxy reachable,
microphone permitted, model loaded) behind one route. Cheap, and it makes every phase above
testable without faking a device.

**Effort:** small. **Server:** none.

---

## Sequence and why

1. **Voice (Phase 1).** No backend, no keys, no ongoing cost, and it closes the single largest
   divergence from the original. Highest value per unit of risk on the list.
2. **Gym/debug route (Phase 5).** Small, and everything after it is easier to test.
3. **Word cloud (Phase 2).** First thing that needs the proxy, so it carries the cost of building
   it. Do not start until the spend cap and App Check are in place.
4. **Vision (Phase 3).** Independent of Phase 2 — could swap with it. Sequenced second because
   camera permission is a bigger ask of a casual visitor than a microphone.
5. **Character (Phase 4).** Last, because it is the most effort and the least mechanism.

## Cost, honestly

The current app costs approximately nothing to serve. After Phase 2 it will not.

Before writing the proxy, set a hard billing cap on the Google Cloud project, decide what happens
when it is hit (degrade to the offline scorer — never fail closed on a demo), and cache
aggressively. Pre-generating word clouds for a 13-entry pack turns a per-session cost into a
one-off. Assume a link that gets shared will be hit by bots, and design the rate limit for that
rather than for the traffic you expect.

## What stays true regardless

- The rules package stays free of network clients, enforced by the existing purity test.
- Every capability is feature-flagged and degrades to current behaviour.
- Typing never stops working.
- No key, service-account file, or project identifier is ever committed. The repository is public.
- Nothing gets described as working on a headset until it has been run on one.

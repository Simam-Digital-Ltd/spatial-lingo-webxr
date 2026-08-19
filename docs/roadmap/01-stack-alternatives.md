# Roadmap — the rest of the stack, on Google

`00-google-stack.md` plans the four missing capabilities. This one goes through everything that
already exists and asks the harder question: now that the Unity and Meta constraints are gone,
what should be replaced, and what is fine where it is?

The verdicts are deliberate. "Full Google stack" is a direction, not an instruction to swap
working parts for branded equivalents — and there is one place where Google has nothing to offer
at all, which is worth naming before the table.

---

## The one gap: Google does not ship a WebXR engine

Meta does, and we are using it. There is no Google product that replaces `@iwsdk/core`.

Keep it. It is MIT-licensed, it is the reason scene understanding, session management and the ECS
came for free, and it carries no runtime tie to Meta services — nothing in the deployed bundle
calls a Meta server. Using Meta's SDK to run on Google's infrastructure is not a contradiction;
it is just what the web looks like right now.

**The exit, if it is ever needed.** Most of what this app does is already ours: the room, the
lighting, the camera, the labels, the lesson loop and the selection raycast are all hand-written
three.js and plain TypeScript. IWSDK supplies session setup, the ECS, and the scene-understanding
bridge. Replacing it means writing a WebXR session manager and dropping the ECS — a real week of
work, not a rewrite. Worth knowing, not worth doing today.

The alternatives if we ever wanted a different engine — Babylon.js, PlayCanvas, A-Frame,
Wonderland — are all further from where this code already sits, not closer.

---

## The whole stack, with verdicts

| Area | Today | Google / modern option | Verdict |
| --- | --- | --- | --- |
| XR engine | IWSDK 0.5.3 + three.js r184 | none exists | **Keep** |
| Hosting | Firebase Hosting | — | **Keep**, already Google |
| Renderer | WebGL2 via three.js | three.js WebGPURenderer | **Wait** |
| Speech in | Web Speech API | Cloud STT for consistency | **Done** keyless |
| Speech out | `speechSynthesis` | Cloud TTS, pre-rendered | **Done** keyless |
| Grading beyond one word | none | Gemini | **Add** — `00`, Phase 2 |
| Object recognition | platform semantic labels | MediaPipe on-device | **Add** — `00`, Phase 3 |
| Vocabulary | one hand-written Spanish pack | Cloud Translation, offline | **Swap** — see below |
| Progress persistence | `localStorage` | Firestore for cross-device | **Done** locally |
| Feature flags | hard-coded, needs a redeploy | Firebase Remote Config | **Add** |
| Analytics | none | GA4 via Firebase | **Add**, minimal |
| Error reporting | console only | Cloud Logging / Error Reporting | **Add** with the proxy |
| Abuse control | none needed yet | Firebase App Check | **Add** with the proxy |
| CI | none — deploys are manual | GitHub Actions + Hosting preview channels | **Add** |
| Browser automation | Chrome DevTools Protocol | already the Google option | **Keep** |
| 3D assets | procedural, zero binaries | Draco + KTX2/Basis if assets ever land | **Not yet** |
| Deploy config leftovers | none | — | **Done** |

---

## Worth doing, in order

### ~~1. Delete the Vercel leftovers~~ — done

`vercel.ts` and the `@vercel/config` dev dependency were from an earlier plan to deploy on Vercel.
Both are gone.

### ~~2. Persist progress~~ — done locally

Learned words are in `localStorage`, keyed per language and validated against the current pack on
load. See `apps/xr/src/progress.ts`.

**Firestore is still deliberately not done.** Cross-device sync means anonymous Firebase Auth, a
data-retention answer, and a running service — for a demo where the whole session is ten minutes
and thirteen words. Do not add it until someone actually asks to continue on their headset what
they started on their laptop.

### 3. Continuous integration

There is none. Tests, typecheck and build all run on a developer machine and deploys are manual,
which is how a broken build reaches a public URL.

GitHub Actions is the pragmatic choice for a public repo, and it composes with the Google side
rather than competing with it: **Firebase Hosting preview channels** give every pull request its
own temporary URL. That is the single most useful thing CI can do for a project whose output is
visual — a reviewer clicks a link and sees the change instead of imagining it.

Cloud Build is the Google-native alternative and is the right answer only if the build ever needs
to sit inside the same project as the services.

### 4. More languages, generated offline

The pack format is already language-agnostic — a BCP-47 tag, a display name, and entries. There is
exactly one pack because writing them by hand is the bottleneck.

Cloud Translation plus Cloud TTS, run as an **offline generation script**, turns that into a build
step: translate the thirteen labels, synthesise the audio, commit the pack. Runtime cost stays
zero, and the app gains a language picker — which is also the `LanguageSelect` sample scene from
the Unity project, arriving as a side effect rather than as a port.

Two cautions. Machine translation of single words without context picks the wrong sense often
enough to matter — a human should review thirteen words per language before it ships. And gendered
articles and pronunciation hints are not something translation output gives you for free; the pack
schema will need to carry them per language.

### 5. Feature flags and a little telemetry

Once there are tiers, models and budgets, "turn the model path off without a redeploy" becomes
worth having. **Remote Config** does exactly that, and it maps cleanly onto the capability-tier
design already in the code.

Keep analytics minimal and say so in the interface: how many people started a lesson, how many
finished one, which tier they resolved to. That last number is the one genuinely valuable metric
this project does not have — it would tell us whether anyone is opening it on a headset at all,
which is currently an open question the roadmap keeps having to say "unverified" about.

---

## Deliberately not doing

- **WebGPU.** three.js ships a WebGPU renderer and it is the future, but IWSDK targets the WebGL
  path, WebXR support across the two is uneven, and this scene is nowhere near GPU-bound. Revisit
  when there is a performance problem to solve.
- **Firebase Auth.** No accounts. The app asks for nothing and stores nothing, and that is a
  feature of a demo link, not an omission.
- **Firestore as a general database.** The proxy needs a counter. A counter is not a reason to
  adopt a database for the app.
- **Google Fonts as a CDN.** Self-host anything we use. A third-party font request is a blocking
  dependency on someone else's uptime for text that must render.
- **Photorealistic 3D Tiles / geospatial.** Genuinely interesting — an outdoor mode where the
  vocabulary comes from a real street — and completely out of scope. Noted so it is not
  re-discovered as a new idea later.
- **Replacing Vite, Vitest or pnpm.** They work, they are fast, and none of them are the
  interesting part of this project.

---

## What stays true

Same constraints as the rest of the roadmap, restated because this document proposes adding
services and every one of them is a chance to break one:

- The rules package stays free of network clients, enforced by the existing purity test.
- Every capability is feature-flagged and degrades to current behaviour.
- The app keeps working with every service switched off.
- No key, service-account file, or project identifier is ever committed. The repository is public.
- Nothing is described as working on a headset until it has been run on one.

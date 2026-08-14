# 03 — C# to TypeScript: the anchor chapter

This is the chapter to read if you're a Unity developer and you want to know what actually
changes when the target is WebXR instead of a Quest-native Player build. Every example below is
pulled from this repository — the Unity side from `reference/Unity-SpatialLingo`, the TypeScript
side from `packages/lingo-core` and `apps/xr`. Nothing here is invented for illustration.

## 1. `MonoBehaviour` → component + system

Unity's `MonoBehaviour` bundles three things that IWSDK (and ECS architectures generally) keep
separate: **data** (serialized fields), **identity** (a `GameObject` the behaviour is attached
to), and **behaviour** (`Update`, `OnEnable`, message callbacks). A `MonoBehaviour` subclass is
all three at once, and Unity's object model doesn't let you have one without the others — you
can't query "give me all the data of this shape" without also getting whatever code happens to
live on the same class.

`RoomSense.cs` is a `MonoBehaviour`:

```csharp
[MetaCodeSample("SpatialLingo")]
public class RoomSense : MonoBehaviour
{
    [Header("Spawn Position Finder")]
    [SerializeField] private FindSpawnPositions m_spawnPositionFinder;

    public void FindSpawnPositions()
    {
        _ = StartCoroutine(SpawnCoroutine(m_spawnPositionFinder));
    }
    // ...
}
```

IWSDK splits this into a **component** (pure data, no behaviour) and a **system** (behaviour
that queries for entities carrying that data). `apps/xr/src/components/lesson-target.ts` is a
component:

```ts
export const LessonTarget = createComponent('LessonTarget', {
  label: { type: Types.String, default: '' },
  word: { type: Types.String, default: '' },
  learned: { type: Types.Boolean, default: false },
});
```

`apps/xr/src/systems/scene-label.ts` is the system that acts on it — it declares which
components it needs via a query, and the ECS runtime (`elics`, which IWSDK is built on) hands
it the matching entities:

```ts
export class SceneLabelSystem extends createSystem({
  meshes: { required: [XRMesh] },
}) {
  init(): void {
    this.queries.meshes.subscribe('qualify', (entity) => this.#tagEntity(entity));
  }
  // ...
}
```

The practical difference: a `LessonTarget` is just three typed fields sitting on any entity.
Nothing about it requires the `SceneLabelSystem` that tags it — `SimulatedRoomSystem`
(`apps/xr/src/systems/simulated-room.ts`) attaches the exact same component to a stand-in box
mesh instead of a real scene mesh, and every downstream system (`TargetSelectionSystem`,
`LessonSystem`) works identically either way, because they only ever query for the component,
never for "the thing `SceneLabelSystem` made." In Unity that decoupling exists only if you build
it yourself — `MonoBehaviour` doesn't hand you a query API.

## 2. Coroutines → async, and where the polling loop actually goes

`RoomSense.SpawnCoroutine` waits for Meta's Mixed Reality Utility Kit to finish initializing
before it can find a spawn point:

```csharp
private IEnumerator SpawnCoroutine(FindSpawnPositions spawnPositionFinder)
{
    // Wait for MRUK to have spawning data ready
    while (MRUK.Instance == null || MRUK.Instance.GetCurrentRoom() == null)
    {
        yield return null;
    }
    var room = MRUK.Instance.GetCurrentRoom();
    spawnPositionFinder.StartSpawn(room);
    // ...
}
```

This is a **polling loop written by hand**: `MRUK.Instance` is a singleton that becomes non-null
at some point after scene load, and there's no event for "MRUK is ready" — so the coroutine
checks every frame (`yield return null` resumes on the next frame) until the precondition holds.
This is idiomatic Unity, and it's also exactly the kind of code that's easy to get subtly wrong
— checking the wrong condition, forgetting to also guard `GetCurrentRoom()` being null,
leaking the coroutine if the object is destroyed mid-wait.

IWSDK's scene-understanding system doesn't need this at all, because the underlying ECS query
mechanism *is* an event source. `SceneLabelSystem` doesn't poll for "is there a mesh yet" — it
subscribes once, and the runtime calls it exactly when a mesh newly satisfies the query:

```ts
init(): void {
  this.queries.meshes.subscribe('qualify', (entity) => this.#tagEntity(entity));
}
```

There is no `while (...) { await nextFrame(); }` anywhere in this codebase's equivalent of
`RoomSense`. The polling loop doesn't get *replaced* with a cleaner polling loop — it
**disappears entirely**, because the query subscription model makes "notify me when this
becomes true" a primitive instead of something you build out of a frame-by-frame check. That's
the single biggest coroutine-shaped habit to unlearn: before reaching for `setInterval` or a
manual `while` + `await`, check whether the ECS query API already expresses what you're waiting
for as an event.

Where async *is* still the right tool — genuinely one-shot async work with no natural event,
like `main.ts`'s `await World.create(...)` or a network request — `async`/`await` is the direct
replacement for `IEnumerator` + `yield return`. IWSDK's own APIs use it throughout; there's
nothing coroutine-specific to relearn there beyond ordinary JavaScript async/await.

## 3. `Update()` → `update(delta, time)` — both in seconds

Unity's `MonoBehaviour.Update()` takes no arguments; you read `Time.deltaTime` (seconds since
last frame) and `Time.time` (seconds since app start) off the static `Time` class inside the
method body. IWSDK systems instead receive both as parameters directly:

```ts
update(delta: number, time: number): void {
  // delta: seconds since last frame
  // time: seconds since the world started
}
```

Same units (seconds, not milliseconds — this is the detail worth double-checking, since some
web timing APIs like `performance.now()` report milliseconds and it's an easy off-by-1000 to
introduce), same per-frame cadence, but passed explicitly rather than read from a global. None
of the systems in this port (`LessonSystem`, `SceneLabelSystem`, `SimulatedRoomSystem`,
`TargetSelectionSystem`) currently override `update()` — the lesson loop is entirely
event-driven (query subscriptions, DOM `keydown`, `pointerdown`) rather than polled per-frame —
but the signature is there for anything that does need per-frame work, e.g. a future animation
or a continuous raycast.

## 4. `GetComponent<T>()` → `entity.getValue(Component, 'field')` and query subscriptions

Unity's `GetComponent<T>()` returns the whole component instance and you reach into its public
fields. IWSDK's `Entity.getValue` reads one field off one component at a time, typed by the
component's schema:

```ts
// apps/xr/src/systems/scene-label.ts
const isBounded = entity.getValue(XRMesh, 'isBounded3D') === true;
const label = entity.getValue(XRMesh, 'semanticLabel');
```

```ts
// apps/xr/src/systems/target-selection.ts
const label = entity.getValue(LessonTarget, 'label');
```

For "find me the entity with this component" — the `GetComponent` use case where you already
have a specific `GameObject` reference — IWSDK's model inverts it: you don't fetch a component
off a known entity so much as declare a query for *any* entity carrying a component, and iterate
what matches:

```ts
// apps/xr/src/systems/target-selection.ts
export class TargetSelectionSystem extends createSystem({
  targets: { required: [LessonTarget] },
}) {
  #pick(): void {
    for (const entity of this.queries.targets.entities) {
      const object = entity.object3D;
      // ...
    }
  }
}
```

`this.queries.targets.entities` is always the live, current set of entities with a
`LessonTarget` component — there's no `FindObjectOfType` scan, no manual list maintenance. The
ECS runtime maintains membership as components are added and removed.

## 5. `[SerializeField]` → `createSystem` schema and `@preact/signals-core` config signals

`[SerializeField]` does two jobs in Unity: it exposes a private field to the Inspector for
designer tuning, and it gets that value serialized into the scene/prefab asset. `RoomSense.cs`'s
`m_spawnPositionFinder` is exactly this — a private reference wired up by hand in the Editor,
invisible to anyone reading only the script.

IWSDK's `createSystem` and `createComponent` take an explicit schema instead, so the shape and
defaults of configurable data live in the source file, not in a separate serialized asset:

```ts
// apps/xr/src/components/lesson-target.ts
export const LessonTarget = createComponent('LessonTarget', {
  label: { type: Types.String, default: '' },
  word: { type: Types.String, default: '' },
  learned: { type: Types.Boolean, default: false },
});
```

For values that need to be *reactive* — read live, and recompute dependents when they change,
the way an Inspector-tunable value might drive other behaviour at runtime — IWSDK's ecosystem
uses `@preact/signals-core`, a small reactive-primitives library independent of any UI
framework. This port doesn't currently have a case that needs one (the lesson state is pushed
via `LessonMachine.subscribe`, a plain listener-set pattern — see `packages/lingo-core/src/machine.ts`),
but it's the IWSDK-idiomatic answer to "a value the rest of the app should react to changing,"
where `[SerializeField]` was Unity's answer to "a value someone should be able to tune."

## 6. When the logic isn't in the code at all

This is the finding worth spending the most time on, because it changes how you should even
approach a port like this.

Spatial Lingo's actual app flow — presenting a lesson, listening for a spoken attempt, showing
feedback, deciding whether to retry or move on — is **not implemented in any `.cs` file.**
`Assets/SpatialLingo/Data/StateGraph/AppFlow.asset` is a serialized Unity Visual Scripting
graph: a YAML asset holding node instances, port connections, and constant values, editable only
inside the Unity Editor's graph canvas. `Assets/SpatialLingo/Scripts/VisualScriptingUnits/`
contains custom node *definitions* — `LessonProgressState.cs`, `LessonWaitingState.cs`,
`WaitForUserLessonAttempt.cs`, `SkippableEventUnit.cs`, and others — but a node definition tells
you what a node's inputs and outputs are, not how they're wired together or what the graph as a
whole *does*. That wiring exists only inside `AppFlow.asset`, in a form that `grep` and `git
diff` cannot usefully read.

This matters more than it sounds. It means a straightforward "read the C#, translate the
C#" approach to porting cannot recover the lesson flow, because the lesson flow was never in the
C#. Reading `LessonProgressState.cs` tells you a state-graph node exists that reports lesson
progress; it does not tell you what triggers a transition into or out of it, what other states
can follow it, or what happens if two transitions could fire at once. That information lives in
a serialized asset with no textual diff and no way to review "the logic" as a document.

The response in this port was to make that flow explicit, in code, as the migration destination
rather than an afterthought: `packages/lingo-core/src/machine.ts`'s `LessonMachine` is a
plain TypeScript class with five phases —

```ts
export type LessonPhase = 'idle' | 'presenting' | 'listening' | 'feedback' | 'complete';
```

— and every transition between them is a named method with an explicit guard:

```ts
beginListening(): void {
  if (this.#phase !== 'presenting') {
    throw new Error(`beginListening requires phase presenting, got ${this.#phase}`);
  }
  this.#phase = 'listening';
  this.#emit();
}
```

Writing this table down as code — rather than as a graph you can only inspect visually — is
what caught a real bug during this port, one that a graph-based flow had likely never surfaced
precisely *because* it can't be read as a document. The bug: an earlier draft of
`beginListening()` accepted the machine being in the `feedback` phase as well as `presenting`,
as a "convenience" for a caller that wanted to jump straight back into listening. But nothing
else in the machine expected that transition to skip `dismissFeedback()` — the method that
records whether the last attempt passed and pushes a learned label into `#learned`. A caller
that used the shortcut would silently drop a **correct** answer: the lesson would return to
`listening` without ever recording the win, and the player could complete a word correctly and
have it not count, with no error, no log, and no visible sign anything had gone wrong. This is
recorded in `.superpowers/sdd/progress.md` under Task 5 as a CRITICAL finding, and it was found
because the transition table was sitting in a diff, in a code review, where "does
`beginListening` from `feedback` skip a required side effect" is a question a reviewer can
actually ask. The fix removed the extra guard clause entirely — `beginListening` now only
accepts `presenting`, matching every real call site (`selectTargetSafely` in
`apps/xr/src/systems/lesson.ts` always calls `targetLabel()` immediately before it, which always
leaves the machine in `presenting`).

The lesson for a Unity-to-web port generally: **when you find a `.cs` file that seems too thin
for what the app visibly does, stop and check whether the actual logic lives in a Visual
Scripting graph, a state machine asset, or a Timeline instead of code.** `RoomSense.cs` is 1.9
KB and only ever finds one spawn point (see Chapter 4) — it looks like it should be doing more,
and the reason it isn't is that the orchestration lives elsewhere. Porting the `.cs` file
faithfully and stopping there silently drops everything the graph was doing. The fix isn't a
smarter reading of the C# — it's opening the graph in the Unity Editor (or asking whoever built
it) and writing the state machine down explicitly, in a form future you can diff and review.

## Summary table

| Unity concept | WebXR/IWSDK equivalent | Where in this repo |
| --- | --- | --- |
| `MonoBehaviour` (data + identity + behaviour) | component (data) + system (behaviour), joined by ECS queries | `components/lesson-target.ts` + `systems/scene-label.ts` |
| Coroutine polling (`while (...) yield return null`) | Query subscription (`subscribe('qualify', ...)`) — the poll disappears | `RoomSense.SpawnCoroutine` vs. `SceneLabelSystem.init` |
| `Update()`, `Time.deltaTime`/`Time.time` | `update(delta, time)`, both in seconds, passed as arguments | any `createSystem` subclass |
| `GetComponent<T>()` | `entity.getValue(Component, 'field')`; iteration via query results, not `FindObjectOfType` | `target-selection.ts` |
| `[SerializeField]` (Inspector + serialization) | `createComponent`/`createSystem` schema; `@preact/signals-core` for reactive config | `components/lesson-target.ts` |
| Visual Scripting graph (`AppFlow.asset`) — logic outside any file you can diff | Explicit state machine class, reviewable in a normal code diff | `AppFlow.asset` vs. `packages/lingo-core/src/machine.ts` |

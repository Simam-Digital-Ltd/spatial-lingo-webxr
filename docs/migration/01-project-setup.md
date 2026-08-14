# 01 — Project setup: Unity project vs. pnpm workspace

This chapter is about structure, not gameplay: how a Unity project's assumptions map onto
a TypeScript monorepo, why this port splits into two packages instead of one, and why every
dependency in `package.json` is pinned to an exact version.

## The Unity project you're leaving behind

`reference/Unity-SpatialLingo` is a single Unity project. Everything — game rules, rendering,
platform glue, editor tooling — lives inside `Assets/`, addressed by GUIDs in `.meta` files,
and built as one indivisible Player build. There's no boundary that stops a `MonoBehaviour` in
`Scripts/Lessons/` from reaching into `UnityEngine.Camera.main`, and nothing enforces one: the
compiler links everything into one assembly (or a handful of asmdefs, which are a much looser
boundary than a package boundary — asmdefs prevent circular references, they don't restrict
which platform APIs a given asmdef may call). The build target — Quest, in this case — is
baked into that structure from the start: `Meta.XR.MRUtilityKit`, `Meta.Utilities.ObjectClassifier`,
and `UnityEngine` types are imported directly into the same files that hold the lesson-scoring
logic (see `Assets/SpatialLingo/Scripts/Lessons/LessonsManager.cs`, which imports
`Meta.Utilities.CameraTaxonTracking` and `Meta.Utilities.ObjectClassifier` right alongside its
word-matching code).

## The pnpm workspace

This repo is a pnpm workspace (`pnpm-workspace.yaml`) with two packages:

```
packages/lingo-core/    @spatial-lingo/core   — the rules, zero 3D/DOM dependencies
apps/xr/                @spatial-lingo/xr     — IWSDK, three.js, the WebXR app
```

`pnpm-workspace.yaml` is two lines:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`apps/xr/package.json` declares `"@spatial-lingo/core": "workspace:*"` and pnpm symlinks it
in rather than publishing anything — the two packages develop in lockstep, but the dependency
is still a real package boundary, checked by `pnpm typecheck` and enforceable by tooling in a
way an `asmdef` reference is not.

## Why `lingo-core` is separated, and what that boundary actually buys

`packages/lingo-core/src/` holds `machine.ts` (the lesson state machine), `scoring.ts` (attempt
grading), `progression.ts` (the language-tree tier curve), `vocabulary.ts` (pack loading and
lookup), and `types.ts`. None of it imports `three`, `@iwsdk/core`, `elics` (IWSDK's ECS
runtime), `@preact/signals-core`, or `@pmndrs/uikit`. None of it references `document`,
`window`, or `navigator`.

That's not a convention anyone has to remember — it's enforced by a test,
`packages/lingo-core/test/purity.test.ts`. It walks every `.ts` file under `src/`, extracts
every import specifier (`from '...'`, bare `import '...'`, dynamic `import(...)`, and
`require(...)`), and fails if any of them start with a banned prefix:

```ts
const FORBIDDEN = ['three', '@iwsdk/', 'elics', '@preact/signals-core', '@pmndrs/uikit'];
```

A second check strips comments and string/template literals, then greps the remainder for the
bare identifiers `document`, `window`, or `navigator` — so a JSDoc comment that happens to
mention "window" doesn't trip it, but real code that touches a DOM global does. Both checks ran
into real edge cases while being built: the DOM-global guard had to be rewritten to reject bare
side-effect imports and bare identifiers (round 1), the `require`/import extraction inadvertently
depended on `@types/node` in a way that broke `pnpm typecheck` outside `lingo-core` and had to be
pinned (round 2), and the comment/string stripper originally blanked *inside* template-literal
interpolations too, which would have hidden a violation like `` `${window.location.href}` ``
behind an apparently-clean file — fixed with a brace-depth-aware scanner that preserves
interpolation contents. That history is recorded in `.superpowers/sdd/progress.md` under Task 4;
it's worth reading if you're about to write a similar guard, because none of those failure
modes are obvious until you hit them.

What this buys in practice: **51 tests run in `lingo-core` under Node, with no browser, no
WebXR polyfill, no rendering context, and no headset.** The entire lesson loop — state
transitions, Levenshtein-based scoring, pack validation, tree-tier thresholds — is testable in
CI in milliseconds. Compare that to the Unity original, where `LessonsManager` (a plain
`IDisposable`, not even a `MonoBehaviour`, which is itself worth noting — see Chapter 3) is
still wired directly to `CameraTaxonTracker` and `AssistantAI` in its constructor, so exercising
its logic in isolation means either running the Unity Test Framework with mocked MRUK/Sentis
dependencies, or not testing it in isolation at all.

The recommendation this chapter is building toward, and the one Chapter 3 argues for in more
detail: **put every rule that doesn't need a scene graph into a package that cannot import one,
and enforce that with a test, not a comment.** It is the single highest-leverage structural
decision in this port.

## Exact-version pinning, and why it matters more here than usual

Every dependency in this workspace is pinned to an exact version — no `^` or `~` — in both
`package.json` files:

```json
// apps/xr/package.json
"@iwsdk/core": "0.5.3",
"three": "0.184.0",
"@iwer/sem": "2.3.0",
"vite": "7.3.6",
"vitest": "4.1.10"
```

For most dependencies, caret ranges are a reasonable default. They stop being reasonable when
the dependency is pre-1.0. Per npm's own semver convention, a caret range on a `0.x.y` package
only admits patch bumps — `^0.184.0` resolves to `0.184.x`, not `0.184.0` through `<1.0.0` — so a
caret on a 0.x package reads as more permissive than it is, right up until a transitive
dependency pins a *different* 0.x caret and the two ranges don't overlap. That's exactly what
happened partway through this build: `@iwer/sem` (needed to add the IWER WebXR emulator, see
Chapter 4) requires `three: "^0.184.0"`. Since `three` was 0.x, that caret admitted only
`0.184.0` — nothing looser. The project was on `three@0.170.0`. That single transitive
requirement cascaded:

```
three   0.170.0 -> 0.184.0   (apps/xr)
vite    6.0.7   -> 7.3.6     (apps/xr; @iwsdk/vite-plugin-dev peers vite@^7)
vitest  2.1.8   -> 4.1.10    (both packages; only line supporting vite 7)
@types/node 22.10.5 -> 22.19.21  (vite 7 peers ^20.19 || >=22.12)
```

Two majors of `vitest` jumped in one dependency chain because one 0.x package added a
peer dependency. That's the risk exact pinning is defending against: on a 0.x SDK, letting the
package manager pick minor/patch versions on your behalf means every `pnpm install` is a
potential breaking change, silently. Pinning exactly doesn't prevent the breakage — it makes
the breakage a deliberate, reviewed commit instead of something that happens between two
otherwise-unrelated `pnpm install` runs.

One incident from this exact upgrade is worth repeating as a warning: a backgrounded `pnpm add`
that had been started against the *old* dependency baseline finished *after* a later commit had
already bumped the same `package.json` — and silently reverted `three`/`vite`/`vitest` back to
their old pins on write. It was only caught because a `pnpm install` afterward still warned
`unmet peer vite@^7`, which contradicted the file that had just been read. The lesson generalizes
beyond this project: **never run a background package-manager write concurrently with anything
else editing the same manifest.** There is no lockfile-level protection against two writers
racing on the same `package.json`.

Verify after any dependency bump that only one copy of a given package resolves in the pnpm
store — a duplicate `three` (one at `0.170.0`, one at `0.184.0`) would produce an `instanceof`
hazard: a `Mesh` constructed against one copy fails `instanceof Mesh` checks against the other.
This was checked explicitly after the bump (`pnpm-lock.yaml` confirmed a single `three@0.184.0`,
with the old `0.170.0` store entry orphaned but unreferenced) — `super-three@0.181.0` remaining
in the tree is not a violation of that check, because it is the dev-only emulator plugin's
internal DevUI renderer, published under a different package name specifically so it doesn't
collide with the app's own `three`.

## Practical takeaways

- Two packages, one boundary: game rules with zero 3D/DOM imports, enforced by a test that
  is designed to fail loudly (`test/purity.test.ts`).
- Pin exact versions on any 0.x dependency. A caret there is not the safety net it is on a
  1.x+ package — see the `@iwer/sem` → `three` cascade above.
- After any bump that touches a package pulled in transitively by multiple direct
  dependencies (here, `three`), confirm there's exactly one resolved copy before trusting
  `instanceof` anywhere in the app.

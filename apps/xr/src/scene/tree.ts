import {
  CatmullRomCurve3,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import type { TreeTier } from '@spatial-lingo/core';

import { PALETTE } from './palette.js';

/**
 * The language tree: the learner's progress made physical.
 *
 * Spatial Lingo's Unity build drove this through `TreeController.cs`, which
 * plays an authored growth animation per tier and moves a berry along a
 * spline. None of that survives the port — the animation clips, the rigged
 * mesh, and the Visual Scripting graph that decided when to advance all live
 * in Unity-only asset formats. See `docs/migration/03-csharp-to-typescript.md`
 * for the full accounting of what could and could not be carried across.
 *
 * What is rebuilt here is the *behaviour*: a tree that visibly gains structure
 * as words are learned. Every element is built once and tagged with the tier
 * it appears at, so advancing a tier is a visibility change plus a short scale
 * tween rather than a rebuild. That keeps growth allocation-free at runtime,
 * which matters on a headset where a mid-session GC pause is a visible stutter.
 */

/** How long a newly revealed part takes to scale up, in seconds. */
const GROWTH_DURATION = 0.55;

/**
 * Overall scale of the whole tree at each tier.
 *
 * Structure alone is not enough to read as growth. With every tier drawn at
 * full size, tier 0 is a full-height trunk carrying a single leaf, which looks
 * like a broken model rather than a seedling. Scaling the trunk itself means
 * the tree gets visibly *bigger* as well as fuller.
 */
const TIER_SCALE: readonly number[] = [0.5, 0.65, 0.78, 0.9, 1];

/** Fraction of the remaining scale gap closed per second. */
const SCALE_DAMPING = 4.5;

interface TieredPart {
  object: Object3D;
  /** Lowest tier at which this part is visible. */
  tier: TreeTier;
  /** Seconds into its growth tween, or null when not currently growing. */
  elapsed: number | null;
}

/** Deterministic pseudo-random in [0, 1) — see the note on determinism below. */
function jitter(seed: number): number {
  const value = Math.sin(seed * 127.1) * 43758.5453;
  return value - Math.floor(value);
}

function branchCurve(
  base: Vector3,
  direction: Vector3,
  length: number,
  droop: number,
): CatmullRomCurve3 {
  const mid = base.clone().addScaledVector(direction, length * 0.55);
  mid.y += droop;
  const tip = base.clone().addScaledVector(direction, length);
  tip.y += droop * 0.4;
  return new CatmullRomCurve3([base.clone(), mid, tip]);
}

/**
 * A procedural stylised tree whose visible structure is a function of tier.
 *
 * Tier 0 is a bare sapling; tier 4 is a full canopy with fruit. The tier
 * thresholds themselves live in `@spatial-lingo/core`'s `progressionFor`, not
 * here — this class only renders whatever tier it is handed.
 */
export class LanguageTree {
  readonly object: Group = new Group();

  readonly #parts: TieredPart[] = [];
  readonly #bark: MeshStandardMaterial;
  readonly #leafYoung: MeshStandardMaterial;
  readonly #leafMature: MeshStandardMaterial;
  readonly #berry: MeshStandardMaterial;

  #tier: TreeTier = 0;
  #scale = TIER_SCALE[0] ?? 1;

  constructor() {
    this.#bark = new MeshStandardMaterial({ color: PALETTE.bark, roughness: 0.9 });
    this.#leafYoung = new MeshStandardMaterial({ color: PALETTE.leafYoung, roughness: 0.85 });
    this.#leafMature = new MeshStandardMaterial({ color: PALETTE.leafMature, roughness: 0.85 });
    this.#berry = new MeshStandardMaterial({
      color: PALETTE.berry,
      roughness: 0.35,
      emissive: PALETTE.berry,
      emissiveIntensity: 0.25,
    });

    this.#buildTrunk();
    this.#buildBranches();
    this.#applyTier(0, true);
    this.object.scale.setScalar(this.#scale);
  }

  get tier(): TreeTier {
    return this.#tier;
  }

  /**
   * Show the structure for `tier`, growing in anything newly revealed.
   *
   * Going backwards (a lower tier than the current one) hides parts instantly
   * rather than shrinking them. Nothing in the lesson loop ever un-learns a
   * word, so that path only runs on an explicit reset.
   */
  setTier(tier: TreeTier): void {
    if (tier === this.#tier) return;
    const growing = tier > this.#tier;
    this.#tier = tier;
    this.#applyTier(tier, !growing);
  }

  /** Advance the growth tweens. `delta` is in seconds, matching IWSDK. */
  update(delta: number): void {
    const targetScale = TIER_SCALE[this.#tier] ?? 1;
    if (Math.abs(this.#scale - targetScale) > 1e-4) {
      const alpha = 1 - Math.exp(-SCALE_DAMPING * Math.max(delta, 0));
      this.#scale += (targetScale - this.#scale) * alpha;
      this.object.scale.setScalar(this.#scale);
    }

    for (const part of this.#parts) {
      if (part.elapsed === null) continue;
      part.elapsed += delta;
      const t = Math.min(part.elapsed / GROWTH_DURATION, 1);
      // Ease-out-back: overshoots slightly then settles, which reads as growth
      // rather than as a part popping into existence.
      const overshoot = 1.7;
      const p = t - 1;
      const eased = 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
      part.object.scale.setScalar(Math.max(eased, 0.001));
      if (t >= 1) {
        part.object.scale.setScalar(1);
        part.elapsed = null;
      }
    }
  }

  dispose(): void {
    for (const material of [this.#bark, this.#leafYoung, this.#leafMature, this.#berry]) {
      material.dispose();
    }
    this.object.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose();
    });
  }

  #register(object: Object3D, tier: TreeTier): void {
    this.object.add(object);
    this.#parts.push({ object, tier, elapsed: null });
  }

  #applyTier(tier: TreeTier, instant: boolean): void {
    for (const part of this.#parts) {
      const shouldShow = part.tier <= tier;
      const wasVisible = part.object.visible;
      part.object.visible = shouldShow;
      if (!shouldShow) {
        part.elapsed = null;
        continue;
      }
      if (instant || wasVisible) {
        part.object.scale.setScalar(1);
        part.elapsed = null;
      } else {
        part.object.scale.setScalar(0.001);
        part.elapsed = 0;
      }
    }
  }

  #buildTrunk(): void {
    // An S-curve rather than a straight cylinder. A vertical pole reads as a
    // post; the lean is what makes it read as a tree at a glance.
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(0.1, 0.42, 0.05),
      new Vector3(-0.06, 0.86, -0.02),
      new Vector3(0.04, 1.24, 0.03),
    ]);
    const trunk = new Mesh(new TubeGeometry(curve, 24, 0.11, 10, false), this.#bark);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    this.#register(trunk, 0);

    // Root flare: four stubby cones splaying out where the trunk meets ground.
    for (let index = 0; index < 4; index++) {
      const angle = (index / 4) * Math.PI * 2 + 0.4;
      const direction = new Vector3(Math.cos(angle), 0.22, Math.sin(angle)).normalize();
      const root = new Mesh(
        new TubeGeometry(
          branchCurve(new Vector3(0, 0.16, 0), direction, 0.3, -0.12),
          8,
          0.055,
          8,
          false,
        ),
        this.#bark,
      );
      root.castShadow = true;
      this.#register(root, 0);
    }

    // The tier-0 sapling needs a real crown, not one leaf: an unstarted lesson
    // is the first thing a visitor sees, and a bare stick reads as a bug.
    const crown = new Group();
    crown.position.set(0.04, 1.3, 0.03);
    const buds: [number, number, number, number][] = [
      [0.15, 0, 0.06, 0],
      [0.11, -0.14, -0.03, 0.06],
      [0.1, 0.13, -0.04, -0.05],
    ];
    for (const [radius, x, y, z] of buds) {
      const bud = new Mesh(new IcosahedronGeometry(radius, 1), this.#leafYoung);
      bud.position.set(x, y, z);
      bud.castShadow = true;
      crown.add(bud);
    }
    this.#register(crown, 0);
  }

  #buildBranches(): void {
    // Four branch tiers, one unlocked per progression tier above zero. Angles
    // and lengths come from `jitter` (a hashed sine) rather than Math.random so
    // the tree is identical on every load — a tree that reshuffles itself makes
    // before/after screenshots useless for review.
    const tiers: TreeTier[] = [1, 2, 3, 4];

    tiers.forEach((tier, tierIndex) => {
      const branchCount = 2 + tierIndex;
      const baseHeight = 0.72 + tierIndex * 0.16;

      for (let index = 0; index < branchCount; index++) {
        const seed = tierIndex * 13 + index * 7 + 1;
        const angle = (index / branchCount) * Math.PI * 2 + jitter(seed) * 1.2 + tierIndex;
        const lift = 0.45 + jitter(seed + 3) * 0.5;
        const direction = new Vector3(Math.cos(angle), lift, Math.sin(angle)).normalize();
        const length = 0.38 + jitter(seed + 5) * 0.26;
        const base = new Vector3(0, baseHeight + jitter(seed + 9) * 0.18, 0);

        const branch = new Mesh(
          new TubeGeometry(branchCurve(base, direction, length, -0.06), 10, 0.045, 8, false),
          this.#bark,
        );
        branch.castShadow = true;
        this.#register(branch, tier);

        // Canopy cluster at the branch tip: three overlapping faceted blobs.
        const tip = base.clone().addScaledVector(direction, length);
        tip.y -= 0.024;
        const cluster = new Group();
        cluster.position.copy(tip);
        for (let blobIndex = 0; blobIndex < 3; blobIndex++) {
          const radius = 0.15 + jitter(seed + blobIndex * 17) * 0.09;
          const leaf = new Mesh(
            new IcosahedronGeometry(radius, 1),
            blobIndex === 0 ? this.#leafMature : this.#leafYoung,
          );
          leaf.position.set(
            (jitter(seed + blobIndex * 23) - 0.5) * 0.2,
            (jitter(seed + blobIndex * 29) - 0.5) * 0.16,
            (jitter(seed + blobIndex * 31) - 0.5) * 0.2,
          );
          leaf.castShadow = true;
          cluster.add(leaf);
        }
        this.#register(cluster, tier);

        // Fruit only from tier 3, so reaching it is visibly a milestone.
        if (tier >= 3 && index % 2 === 0) {
          const berry = new Mesh(new SphereGeometry(0.05, 12, 10), this.#berry);
          berry.position.copy(tip).add(new Vector3(0, -0.16, 0.05));
          this.#register(berry, tier);
        }
      }
    });
  }
}

/** Builds the tree and places it on its own low plinth. */
export function createLanguageTree(): { tree: LanguageTree; object: Object3D } {
  const tree = new LanguageTree();
  const stand = new Group();
  stand.add(tree.object);
  return { tree, object: stand };
}

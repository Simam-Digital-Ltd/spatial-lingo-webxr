import {
  Box3,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

import { PALETTE } from './palette.js';

/**
 * Procedural stand-in furniture, one builder per WebXR semantic label.
 *
 * On a headset with a scanned room, `SceneLabelSystem` tags the real room mesh
 * and nothing here is used. These props exist for the two tiers that have no
 * room mesh to tag: a headset without mesh detection (Tier 3) and a plain
 * browser with no WebXR at all (Tier 4). The label set is deliberately the
 * WebXR standard semantic-label vocabulary, so a prop and a real detected mesh
 * are interchangeable everywhere downstream.
 *
 * Everything is built from primitives rather than loaded from a model file. It
 * keeps the deployed bundle free of binary assets, and it means the whole room
 * is diffable source rather than an opaque `.glb`.
 */

interface SurfaceOptions {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

/** Shared material factory, so every prop lands in the same lighting response. */
function surface(color: number, options: SurfaceOptions = {}): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0,
  });
  if (options.emissive !== undefined) {
    material.emissive.setHex(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  if (options.transparent) {
    material.transparent = true;
    material.opacity = options.opacity ?? 0.5;
  }
  return material;
}

/** A box centred on (x, y, z). */
function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  x: number,
  y: number,
  z: number,
  options: SurfaceOptions = {},
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), surface(color, options));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  color: number,
  x: number,
  y: number,
  z: number,
  options: SurfaceOptions = {},
): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(radiusTop, radiusBottom, height, 20),
    surface(color, options),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function sphere(radius: number, color: number, options: SurfaceOptions = {}): Mesh {
  const mesh = new Mesh(new SphereGeometry(radius, 14, 12), surface(color, options));
  mesh.castShadow = true;
  return mesh;
}

/**
 * Faceted blob used for foliage and cushions.
 *
 * `IcosahedronGeometry` at detail 1 gives the low-poly look the reference art
 * uses, and costs a fraction of a smooth sphere. That matters more than it
 * looks: the same props render twice per frame in stereo on a headset.
 */
function blob(
  radius: number,
  color: number,
  x: number,
  y: number,
  z: number,
  scale?: Vector3,
): Mesh {
  const mesh = new Mesh(new IcosahedronGeometry(radius, 1), surface(color, { roughness: 0.9 }));
  mesh.position.set(x, y, z);
  if (scale) mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function group(...children: Object3D[]): Group {
  const container = new Group();
  for (const child of children) container.add(child);
  return container;
}

function buildTable(): Group {
  const legs: Mesh[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      legs.push(box(0.07, 0.42, 0.07, PALETTE.woodDark, sx * 0.46, 0.21, sz * 0.28));
    }
  }
  return group(
    box(1.1, 0.07, 0.7, PALETTE.wood, 0, 0.45, 0),
    box(0.98, 0.05, 0.6, PALETTE.woodDark, 0, 0.22, 0),
    ...legs,
    // A book and a mug. Without a little clutter a coffee table reads as a
    // featureless slab from across the room.
    box(0.22, 0.04, 0.16, PALETTE.rug, -0.22, 0.5, 0.06),
    cylinder(0.05, 0.05, 0.1, PALETTE.fabricLight, 0.24, 0.53, -0.04),
  );
}

function buildCouch(): Group {
  return group(
    box(1.9, 0.32, 0.88, PALETTE.couch, 0, 0.24, 0),
    box(1.9, 0.62, 0.2, PALETTE.couch, 0, 0.7, -0.4),
    box(0.2, 0.5, 0.88, PALETTE.couch, -0.95, 0.55, 0),
    box(0.2, 0.5, 0.88, PALETTE.couch, 0.95, 0.55, 0),
    box(0.78, 0.16, 0.72, PALETTE.couchCushion, -0.42, 0.49, 0.02),
    box(0.78, 0.16, 0.72, PALETTE.couchCushion, 0.42, 0.49, 0.02),
    blob(0.16, PALETTE.cushionAccent, -0.6, 0.68, -0.22, new Vector3(1.2, 1.1, 0.5)),
    // Feet, so the couch does not look welded to the floor.
    box(0.1, 0.08, 0.1, PALETTE.woodDark, -0.8, 0.04, 0.32),
    box(0.1, 0.08, 0.1, PALETTE.woodDark, 0.8, 0.04, 0.32),
  );
}

function buildScreen(): Group {
  return group(
    box(0.5, 0.05, 0.28, PALETTE.woodDark, 0, 0.02, 0),
    box(0.08, 0.22, 0.08, PALETTE.screenBody, 0, 0.14, 0),
    box(1.4, 0.82, 0.06, PALETTE.screenBody, 0, 0.66, 0),
    // Emissive panel inset slightly forward so the bezel still reads.
    box(1.3, 0.72, 0.02, PALETTE.screenGlow, 0, 0.66, 0.04, {
      emissive: PALETTE.screenGlow,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    }),
  );
}

function buildLamp(): Group {
  const shade = new Mesh(
    new ConeGeometry(0.26, 0.32, 20, 1, true),
    surface(PALETTE.lampShade, {
      roughness: 0.6,
      emissive: PALETTE.bulb,
      emissiveIntensity: 0.35,
    }),
  );
  shade.position.set(0, 1.42, 0);

  // The visible bulb is what sells the lamp as lit, without needing a real
  // PointLight per prop. Per-prop dynamic lights would blow the light budget
  // on a headset, where every light costs twice.
  const bulb = sphere(0.07, PALETTE.bulb, {
    emissive: PALETTE.bulb,
    emissiveIntensity: 1.6,
  });
  bulb.position.set(0, 1.34, 0);
  bulb.castShadow = false;

  return group(
    cylinder(0.18, 0.22, 0.05, PALETTE.woodDark, 0, 0.03, 0),
    cylinder(0.025, 0.025, 1.3, PALETTE.brass, 0, 0.68, 0, { metalness: 0.6, roughness: 0.35 }),
    shade,
    bulb,
  );
}

function buildPlant(): Group {
  return group(
    cylinder(0.19, 0.14, 0.3, PALETTE.pot, 0, 0.15, 0),
    cylinder(0.21, 0.21, 0.05, PALETTE.pot, 0, 0.31, 0),
    cylinder(0.035, 0.045, 0.36, PALETTE.woodDark, 0, 0.5, 0),
    blob(0.26, PALETTE.foliage, 0, 0.78, 0, new Vector3(1, 0.9, 1)),
    blob(0.19, PALETTE.foliageLight, 0.2, 0.62, 0.12),
    blob(0.17, PALETTE.foliage, -0.19, 0.66, -0.1),
    blob(0.14, PALETTE.foliageLight, 0.04, 0.98, -0.06),
  );
}

function buildShelf(): Group {
  const parts: Mesh[] = [
    box(0.05, 1.5, 0.34, PALETTE.wood, -0.45, 0.75, 0),
    box(0.05, 1.5, 0.34, PALETTE.wood, 0.45, 0.75, 0),
    box(0.95, 0.04, 0.34, PALETTE.wood, 0, 0.02, 0),
    box(0.95, 0.04, 0.3, PALETTE.woodDark, 0, 1.48, -0.02),
  ];
  const bookColors = [PALETTE.rug, PALETTE.couch, PALETTE.brass, PALETTE.foliage, PALETTE.canvasArt];
  // Three shelves of books. Heights are jittered by index rather than by
  // Math.random so the room is byte-identical on every load — a room that
  // reshuffles itself makes screenshot comparison between builds useless.
  for (let level = 0; level < 3; level++) {
    const y = 0.4 + level * 0.42;
    parts.push(box(0.95, 0.04, 0.34, PALETTE.wood, 0, y, 0));
    for (let index = 0; index < 6; index++) {
      const color = bookColors[(level * 6 + index) % bookColors.length] ?? PALETTE.rug;
      const height = 0.2 + ((level * 7 + index * 3) % 5) * 0.022;
      parts.push(box(0.055, height, 0.22, color, -0.34 + index * 0.13, y + 0.02 + height / 2, 0.02));
    }
  }
  return group(...parts);
}

function buildBed(): Group {
  return group(
    box(1.42, 0.28, 2.0, PALETTE.wood, 0, 0.14, 0),
    box(1.5, 0.5, 0.1, PALETTE.woodDark, 0, 0.45, -1.02),
    box(1.34, 0.22, 1.9, PALETTE.fabricLight, 0, 0.39, 0),
    box(1.34, 0.06, 1.15, PALETTE.fabricCool, 0, 0.52, 0.36),
    box(0.56, 0.14, 0.32, PALETTE.fabricLight, -0.32, 0.57, -0.76),
    box(0.56, 0.14, 0.32, PALETTE.fabricLight, 0.32, 0.57, -0.76),
  );
}

function buildDoor(): Group {
  const knob = sphere(0.055, PALETTE.brass, { metalness: 0.7, roughness: 0.3 });
  knob.position.set(0.34, 1.05, 0.08);
  return group(
    box(1.0, 2.1, 0.1, PALETTE.woodDark, 0, 1.05, -0.03),
    box(0.88, 1.98, 0.08, PALETTE.wood, 0, 1.05, 0.02),
    box(0.66, 0.7, 0.02, PALETTE.woodDark, 0, 1.5, 0.06),
    box(0.66, 0.62, 0.02, PALETTE.woodDark, 0, 0.66, 0.06),
    knob,
  );
}

function buildWindow(): Group {
  const pane = box(1.24, 1.24, 0.02, PALETTE.glass, 0, 1.5, 0, {
    emissive: PALETTE.glass,
    emissiveIntensity: 0.55,
    roughness: 0.1,
    transparent: true,
    opacity: 0.75,
  });
  pane.castShadow = false;
  return group(
    box(1.44, 1.44, 0.09, PALETTE.fabricLight, 0, 1.5, -0.02),
    pane,
    box(0.05, 1.28, 0.06, PALETTE.fabricLight, 0, 1.5, 0.02),
    box(1.28, 0.05, 0.06, PALETTE.fabricLight, 0, 1.5, 0.02),
    box(1.56, 0.08, 0.16, PALETTE.wood, 0, 0.74, 0.02),
  );
}

function buildWallArt(): Group {
  const dot = new Mesh(new CircleGeometry(0.1, 20), surface(PALETTE.cushionAccent));
  dot.position.set(0.16, 0.1, 0.045);
  return group(
    box(0.84, 0.64, 0.05, PALETTE.brass, 0, 0, 0, { metalness: 0.4, roughness: 0.45 }),
    box(0.72, 0.52, 0.02, PALETTE.canvasArt, 0, 0, 0.03),
    // Two blocked-in shapes, so the canvas reads as a painting rather than a
    // blue card.
    box(0.3, 0.2, 0.01, PALETTE.foliageLight, -0.14, -0.1, 0.045),
    dot,
  );
}

/**
 * Small free-standing tile used for labels whose real-world referent is a room
 * surface (floor, ceiling, wall).
 *
 * Those get dedicated clickable surfaces in the desktop room, but the
 * floating-arc layout used in a headset has no room shell to click, so they
 * still need something physical to point at.
 */
function buildSwatch(color: number): Group {
  return group(
    box(0.5, 0.06, 0.5, color, 0, 0.03, 0),
    box(0.42, 0.02, 0.42, PALETTE.brass, 0, 0.07, 0),
  );
}

const BUILDERS: Record<string, () => Group> = {
  table: buildTable,
  couch: buildCouch,
  screen: buildScreen,
  lamp: buildLamp,
  plant: buildPlant,
  shelf: buildShelf,
  bed: buildBed,
  door: buildDoor,
  window: buildWindow,
  'wall art': buildWallArt,
  floor: () => buildSwatch(PALETTE.floor),
  ceiling: () => buildSwatch(PALETTE.ceiling),
  wall: () => buildSwatch(PALETTE.wall),
};

/** Semantic labels this module can build a prop for. */
export function knownPropLabels(): string[] {
  return Object.keys(BUILDERS);
}

/**
 * Build the prop for a semantic label, or `null` when there is no model for it.
 *
 * Returning `null` rather than a fallback cube is deliberate: a vocabulary pack
 * can name any label, and silently substituting a grey box would make a missing
 * model look like a deliberate one.
 */
export function buildProp(label: string): Group | null {
  const builder = BUILDERS[label];
  return builder ? builder() : null;
}

/**
 * Uniformly scale an object so its largest dimension is `maxSize` metres, then
 * drop it so its base sits on y = 0.
 *
 * Used by the floating-arc layout, where a 2 m bed and a 0.3 m plant pot have
 * to sit side by side at a readable size.
 */
export function fitTo(object: Object3D, maxSize: number): void {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest <= 0) return;
  const scale = maxSize / largest;
  object.scale.multiplyScalar(scale);
  object.position.y -= bounds.min.y * scale;
}

import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from '@iwsdk/core';

/**
 * Floating word labels drawn to a 2D canvas and shown as camera-facing sprites.
 *
 * IWSDK ships real in-world UI (`@pmndrs/uikit` via the `spatialUI` feature),
 * but this app deliberately builds with `spatialUI: false` — turning it on
 * pulls the MSDF font-atlas generator and every bundled typeface into the
 * build, which is where most of the current bundle weight comes from. A label
 * that only ever shows one short word does not need a full UI layout engine,
 * so it is drawn with `CanvasRenderingContext2D` instead.
 *
 * Sprites always face the camera, which is what we want here: the label has to
 * stay readable whether the learner is walking around a headset room or
 * orbiting the desktop camera.
 */

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 256;

/** Height of the sprite in metres. Width follows the canvas aspect ratio. */
const SPRITE_HEIGHT = 0.34;

export interface WordLabelOptions {
  /** The target-language word, e.g. 'mesa'. */
  word: string;
  /** Definite article shown before the word, e.g. 'la'. */
  article: string | null;
  /** The English semantic label, e.g. 'table'. */
  label: string;
}

/**
 * A label attached to one lesson target.
 *
 * Starts hidden behind a question mark and reveals the word once the learner
 * has answered correctly, so the room doubles as a progress readout: at a
 * glance you can see how much of it you have named.
 */
export class WordLabel {
  readonly sprite: Sprite;

  readonly #options: WordLabelOptions;
  readonly #context: CanvasRenderingContext2D;
  readonly #texture: CanvasTexture;

  #revealed = false;
  #highlighted = false;

  constructor(options: WordLabelOptions) {
    this.#options = options;

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('[spatial-lingo] 2D canvas context unavailable for word label');
    this.#context = context;

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    // The sprite is small on screen and never magnified much; linear filtering
    // without mipmaps keeps the text crisp and skips a mipmap chain per label.
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    this.#texture = texture;

    this.sprite = new Sprite(
      new SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    // depthTest is off so a label never disappears inside the prop it names.
    // That needs an explicit high render order, otherwise it draws in whatever
    // order the sprite happens to land in the transparent pass.
    this.sprite.renderOrder = 10;
    this.sprite.scale.set(SPRITE_HEIGHT * (CANVAS_WIDTH / CANVAS_HEIGHT), SPRITE_HEIGHT, 1);

    this.#draw();
  }

  /** Reveal the target-language word. Idempotent. */
  reveal(): void {
    if (this.#revealed) return;
    this.#revealed = true;
    this.#draw();
  }

  /** Toggle the hover treatment. Idempotent per state. */
  setHighlighted(highlighted: boolean): void {
    if (this.#highlighted === highlighted) return;
    this.#highlighted = highlighted;
    this.#draw();
  }

  /** Releases the canvas texture and sprite material. */
  dispose(): void {
    this.#texture.dispose();
    this.sprite.material.dispose();
  }

  #draw(): void {
    const context = this.#context;
    const { word, article, label } = this.#options;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const accent = this.#revealed ? '#7fd18b' : '#f2c14e';
    const background = this.#highlighted ? 'rgba(24,26,33,0.96)' : 'rgba(24,26,33,0.82)';

    roundedRect(context, 16, 40, CANVAS_WIDTH - 32, CANVAS_HEIGHT - 92, 28);
    context.fillStyle = background;
    context.fill();
    context.lineWidth = this.#highlighted ? 8 : 4;
    context.strokeStyle = accent;
    context.stroke();

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    if (this.#revealed) {
      const headline = article ? `${article} ${word}` : word;
      context.fillStyle = '#ffffff';
      context.font = 'bold 74px system-ui, sans-serif';
      context.fillText(headline, CANVAS_WIDTH / 2, 118, CANVAS_WIDTH - 80);
      context.fillStyle = 'rgba(255,255,255,0.62)';
      context.font = '38px system-ui, sans-serif';
      context.fillText(label, CANVAS_WIDTH / 2, 176, CANVAS_WIDTH - 80);
    } else {
      context.fillStyle = accent;
      context.font = 'bold 86px system-ui, sans-serif';
      context.fillText('?', CANVAS_WIDTH / 2, 112);
      context.fillStyle = 'rgba(255,255,255,0.72)';
      context.font = '38px system-ui, sans-serif';
      context.fillText(label, CANVAS_WIDTH / 2, 176, CANVAS_WIDTH - 80);
    }

    this.#texture.needsUpdate = true;
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

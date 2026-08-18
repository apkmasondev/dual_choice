/**
 * Extends the studio backdrop past the edges of the frame.
 *
 * A 96x54 canvas stretched over the stage is repainted from whichever film is
 * on screen. Because the source is the film itself, the light behind the frame
 * always matches the light inside it — which is what stops the video looking
 * like a rectangle pasted onto a page (plan sections 8.1 and 15.1).
 *
 * The bands are not the whole frame stretched — that would smear the subject
 * into a vertical streak. They are the frame's own *edge* rows or columns
 * extended outwards, so the colour on either side of the join is identical
 * and the seam disappears.
 *
 * The frame's position is measured from the element rather than taken from the
 * projection, so the wash follows the film through the reveal settle for free
 * instead of needing the transform plumbed through a second time.
 *
 * Cost: one layout read plus at most seven `drawImage` calls into ~5000 pixels,
 * about ten times a second. The softening happens inside the canvas rather
 * than as a CSS filter, because Chromium rasterises a filter at the composited
 * scale — blurring this element after it was stretched over the stage measured
 * 3.8 fps at 2560x1080.
 */
export class AmbientBackdrop {
  /** How many source pixels are sampled to build an extension band. */
  static readonly EDGE_SAMPLE = 8;

  readonly #canvas: HTMLCanvasElement;
  readonly #stage: HTMLElement;
  readonly #context: CanvasRenderingContext2D | null;
  #source: HTMLVideoElement | null = null;
  #still: HTMLImageElement | null = null;
  #lastPaint = 0;
  #enabled = false;
  #following = false;
  #minIntervalMs: number;

  constructor(
    canvas: HTMLCanvasElement,
    stage: HTMLElement,
    options: { minIntervalMs?: number } = {},
  ) {
    this.#canvas = canvas;
    this.#stage = stage;
    this.#minIntervalMs = options.minIntervalMs ?? 90;
    this.#context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (this.#context) {
      this.#context.filter = 'blur(1.8px)';
      this.#context.imageSmoothingEnabled = true;
      this.#context.imageSmoothingQuality = 'high';
    }
  }

  get available(): boolean {
    return this.#context !== null;
  }

  setSource(video: HTMLVideoElement | null): void {
    this.#source = video;
    this.#lastPaint = 0;
  }

  /** Reduced motion samples far less often; the wash then reads as static. */
  setMinInterval(ms: number): void {
    this.#minIntervalMs = ms;
  }

  /**
   * Paints every frame while the film is moving.
   *
   * The throttle is there because a film that only changes its *content* does
   * not need a wash repainted sixty times a second. A film that changes its
   * *position* does: at the reveal it settles over 760 ms, and the bands,
   * repainted on their own slower cadence, trailed behind it. Measured across
   * that settle, the wash's idea of where the frame was ran an average of
   * 21 px behind where it actually was; following brings that to 6 px.
   */
  setFollowing(following: boolean): void {
    this.#following = following;
  }

  /** Called from the single rAF loop. Returns true when it actually painted. */
  update(now: number): boolean {
    const context = this.#context;
    if (!context) return false;

    const element = this.#source ?? this.#still;
    if (!element) return false;
    if (!this.#following && now - this.#lastPaint < this.#minIntervalMs) return false;

    if (this.#source) {
      // HAVE_CURRENT_DATA: there is a frame to copy.
      if (this.#source.readyState < 2 || this.#source.videoWidth === 0) return false;
    } else if (!this.#still?.complete || this.#still.naturalWidth === 0) {
      return false;
    }

    this.#lastPaint = now;
    const width = this.#source?.videoWidth ?? this.#still?.naturalWidth ?? 0;
    const height = this.#source?.videoHeight ?? this.#still?.naturalHeight ?? 0;
    if (width === 0 || height === 0) return false;

    try {
      this.#paint(context, element, width, height);
    } catch {
      // A frame that is not yet decodable is not worth reporting; the CSS
      // gradient underneath is a complete fallback.
      return false;
    }
    this.#markEnabled();
    return true;
  }

  /** Fills the band from the poster, before any film has a frame to give. */
  useStill(image: HTMLImageElement | null): void {
    this.#still = image;
    this.#lastPaint = 0;
  }

  #markEnabled(): void {
    if (this.#enabled) return;
    this.#enabled = true;
    document.documentElement.dataset['ambient'] = 'on';
  }

  #paint(
    context: CanvasRenderingContext2D,
    element: HTMLVideoElement | HTMLImageElement,
    sourceWidth: number,
    sourceHeight: number,
  ): void {
    const { width: canvasWidth, height: canvasHeight } = this.#canvas;
    const stageBox = this.#stage.getBoundingClientRect();
    const frameBox = element.getBoundingClientRect();

    if (stageBox.width === 0 || stageBox.height === 0 || frameBox.width === 0) {
      context.drawImage(element, 0, 0, canvasWidth, canvasHeight);
      return;
    }

    // Where the frame sits inside the canvas, which maps 1:1 to the stage.
    const left = ((frameBox.x - stageBox.x) / stageBox.width) * canvasWidth;
    const top = ((frameBox.y - stageBox.y) / stageBox.height) * canvasHeight;
    const width = (frameBox.width / stageBox.width) * canvasWidth;
    const height = (frameBox.height / stageBox.height) * canvasHeight;

    // Let the veil's wash line up with where the frame really is.
    const style = this.#stage.style;
    style.setProperty('--frame-x', `${(frameBox.x - stageBox.x).toFixed(1)}px`);
    style.setProperty('--frame-y', `${(frameBox.y - stageBox.y).toFixed(1)}px`);
    style.setProperty('--frame-w', `${frameBox.width.toFixed(1)}px`);
    style.setProperty('--frame-h', `${frameBox.height.toFixed(1)}px`);

    const edge = Math.min(AmbientBackdrop.EDGE_SAMPLE, sourceHeight, sourceWidth);
    // A pixel of overlap on every join hides any rounding seam.
    const bleed = 1;

    if (top > 0.5) {
      context.drawImage(element, 0, 0, sourceWidth, edge, left, -bleed, width, top + bleed * 2);
    }
    if (top + height < canvasHeight - 0.5) {
      context.drawImage(
        element,
        0,
        sourceHeight - edge,
        sourceWidth,
        edge,
        left,
        top + height - bleed,
        width,
        canvasHeight - (top + height) + bleed * 2,
      );
    }
    if (left > 0.5) {
      context.drawImage(element, 0, 0, edge, sourceHeight, -bleed, top, left + bleed * 2, height);
      this.#mirror(context, element, sourceWidth, sourceHeight, left, top, width, height, 'left');
    }
    if (left + width < canvasWidth - 0.5) {
      context.drawImage(
        element,
        sourceWidth - edge,
        0,
        edge,
        sourceHeight,
        left + width - bleed,
        top,
        canvasWidth - (left + width) + bleed * 2,
        height,
      );
      this.#mirror(context, element, sourceWidth, sourceHeight, left, top, width, height, 'right');
    }

    context.drawImage(element, 0, 0, sourceWidth, sourceHeight, left, top, width, height);
  }

  /**
   * Continues the frame sideways by reflecting it about its own edge.
   *
   * A stretched edge column is seam-exact but flat, and on a wide desktop that
   * flatness is what made the side bands read as separate panels. A reflection
   * is seam-exact *and* keeps the studio's falloff going, so the light simply
   * carries on past the frame. Only ever used horizontally: the subject is
   * centred, so a band this size reflects nothing but backdrop. Vertically the
   * frame ends on the studio floor, where a reflection would read as a mirror.
   */
  #mirror(
    context: CanvasRenderingContext2D,
    element: HTMLVideoElement | HTMLImageElement,
    sourceWidth: number,
    sourceHeight: number,
    left: number,
    top: number,
    width: number,
    height: number,
    side: 'left' | 'right',
  ): void {
    const axis = side === 'left' ? left : left + width;
    context.save();
    context.translate(axis * 2, 0);
    context.scale(-1, 1);
    context.drawImage(element, 0, 0, sourceWidth, sourceHeight, left, top, width, height);
    context.restore();
  }
}

import { FOCUS_RECT, PRODUCT_SAFE_RECT, SOURCE_FRAME } from '../choice/hotspot-config.ts';
import { projectMedia, type MediaRect } from '../choice/mediaProjection.ts';
import { clamp } from '../utils/math.ts';
import type { Disposables } from '../utils/disposables.ts';

export interface StageGeometry {
  readonly box: { readonly width: number; readonly height: number };
  readonly rect: MediaRect;
  /** Empty stage above/below the rendered frame, in CSS px. */
  readonly spaceAbove: number;
  readonly spaceBelow: number;
  readonly placement: CopyPlacement;
}

/**
 * `below` — there is enough ambient band under the film to seat the copy on
 * clean space; `overlay` — the film fills the stage, so the copy sits on the
 * scrim in the area clear of the face, the hands and both objects.
 */
export type CopyPlacement = 'below' | 'overlay';

/** Minimum band under the film worth placing copy in. */
const MIN_BAND_FOR_COPY = 168;

/** Space the brand mark and sound toggle need at the top of the stage. */
const TOP_CHROME_CLEARANCE = 72;

/** Below this the product stops carrying the frame, so the stage veils instead. */
const MIN_REVEAL_ZOOM = 0.5;

/**
 * Air left between the bottom of the product and the top of the panel.
 *
 * Without it the fit puts the product exactly on the panel's edge, and a panel
 * that then grows by a line — a wrap that lands differently, a font that
 * arrives late — lands that line on the product.
 */
const PRODUCT_CLEARANCE = 16;

/**
 * How close the product itself may come to the top of the stage.
 *
 * Much smaller than the clearance the *frame* keeps, and deliberately so: the
 * wordmark and the sound control sit in the corners, while the product is
 * centred, so they never meet. This is the margin that lets a short phone
 * crop the empty wall above the product instead of shrinking the whole frame.
 */
const PRODUCT_TOP_CLEARANCE = 24;

/** Stage proportions from which the reveal composes as a card rather than a band. */
const LANDSCAPE_RATIO = 1.2;

export type GeometryListener = (geometry: StageGeometry) => void;

/**
 * Owns the stage's geometry.
 *
 * Measurement happens once per resize; the result is written to CSS custom
 * properties inside the animation frame, so the film and the hotspots move in
 * the same paint and a visitor can never see one chase the other.
 */
export class StageLayout {
  readonly #stage: HTMLElement;
  readonly #listeners = new Set<GeometryListener>();
  #geometry: StageGeometry | null = null;
  #pendingBox: { width: number; height: number } | null = null;

  constructor(stage: HTMLElement, disposables: Disposables) {
    this.#stage = stage;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const size = entry.borderBoxSize[0];
      this.#pendingBox = size
        ? { width: size.inlineSize, height: size.blockSize }
        : { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(stage);
    disposables.add(() => {
      observer.disconnect();
    });

    // visualViewport is a useful supplement on iOS, where the layout box can
    // lag behind the visible area during a pinch or a chrome transition.
    globalThis.visualViewport?.addEventListener(
      'resize',
      () => {
        this.invalidate();
      },
      { signal: disposables.signal },
    );

    this.#pendingBox = { width: stage.clientWidth, height: stage.clientHeight };
  }

  get geometry(): StageGeometry | null {
    return this.#geometry;
  }

  get isDirty(): boolean {
    return this.#pendingBox !== null;
  }

  /** Forces a recompute on the next flush (orientation change, state change). */
  invalidate(): void {
    this.#pendingBox = { width: this.#stage.clientWidth, height: this.#stage.clientHeight };
  }

  onChange(listener: GeometryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Call from the single rAF loop. Cheap and a no-op when nothing changed. */
  flush(): StageGeometry | null {
    const box = this.#pendingBox;
    if (!box) return null;
    this.#pendingBox = null;

    if (box.width <= 0 || box.height <= 0) return this.#geometry;

    const rect = projectMedia(SOURCE_FRAME, box, { focus: FOCUS_RECT });
    const spaceAbove = Math.max(0, rect.y);
    const spaceBelow = Math.max(0, box.height - (rect.y + rect.height));
    const placement: CopyPlacement = spaceBelow >= MIN_BAND_FOR_COPY ? 'below' : 'overlay';

    const geometry: StageGeometry = { box, rect, spaceAbove, spaceBelow, placement };
    this.#geometry = geometry;
    this.#apply(geometry);

    for (const listener of this.#listeners) listener(geometry);
    return geometry;
  }

  #apply(geometry: StageGeometry): void {
    const { rect } = geometry;
    const style = this.#stage.style;
    style.setProperty('--media-x', `${rect.x.toFixed(2)}px`);
    style.setProperty('--media-y', `${rect.y.toFixed(2)}px`);
    style.setProperty('--media-w', `${rect.width.toFixed(2)}px`);
    style.setProperty('--media-h', `${rect.height.toFixed(2)}px`);
    style.setProperty('--media-scale', rect.scale.toFixed(5));
    style.setProperty('--space-above-media', `${geometry.spaceAbove.toFixed(2)}px`);
    style.setProperty('--space-below-media', `${geometry.spaceBelow.toFixed(2)}px`);

    this.#stage.dataset['copyPlacement'] = geometry.placement;
  }

  /**
   * Settles the film at the reveal.
   *
   * On a landscape stage the film draws back into a *card*: scaled until it
   * fits inside the stage with a margin, so it stops being a full-bleed plate
   * and becomes a framed window with the sales copy underneath it. That is
   * both the more editorial composition and the one that guarantees the copy
   * never lands on the product.
   *
   * On a portrait stage the film is already a band with ambient above and
   * below, so it slides up instead of shrinking — scaling it there would make
   * the product tiny for no gain. The constraint is the bottom of
   * PRODUCT_SAFE_RECT, not the film box.
   *
   * Sliding is tried before scaling, and on a short phone that is the whole
   * difference. Above the product there is nothing but studio wall, so a crop
   * costs the composition nothing; scaling costs it twice, once in the size of
   * the product and again in the frame's cropped left and right edges, which
   * come on screen as two hard vertical lines the moment it stops being
   * full-bleed. Only when even a full slide cannot clear the panel does the
   * frame shrink.
   *
   * Transform only, applied with `transform-origin: 50% 0%` — no layout is
   * animated and the hotspots are long gone by the time this runs.
   */
  applyRevealTransform(panelHeight: number, gap = 24): void {
    const geometry = this.#geometry;
    if (!geometry || geometry.rect.height === 0) return;

    const { rect, box } = geometry;
    const panelTop = box.height - panelHeight - gap;
    const landscape = box.width / box.height >= LANDSCAPE_RATIO;
    // Leave room for the brand mark when the film starts flush with the top.
    const topMargin = landscape ? TOP_CHROME_CLEARANCE : Math.min(rect.y, TOP_CHROME_CLEARANCE);

    let ideal: number;
    if (landscape) {
      const margin = clamp(box.width * 0.05, 24, 96);
      ideal = Math.min((box.width - margin * 2) / rect.width, (panelTop - topMargin) / rect.height);
    } else {
      const productTop = rect.y + (PRODUCT_SAFE_RECT.y / SOURCE_FRAME.height) * rect.height;
      const productBottom =
        rect.y +
        ((PRODUCT_SAFE_RECT.y + PRODUCT_SAFE_RECT.height) / SOURCE_FRAME.height) * rect.height;

      const needed = panelTop - PRODUCT_CLEARANCE - productBottom;
      if (needed >= 0) {
        this.clearRevealTransform();
        return;
      }

      // A slide alone, if the product's own top can take it.
      if (needed >= PRODUCT_TOP_CLEARANCE - productTop) {
        this.#writeRevealTransform(1, needed, rect, box, topMargin);
        return;
      }

      const span = productBottom - rect.y;
      ideal = span > 0 ? (panelTop - topMargin - PRODUCT_CLEARANCE) / span : 1;
    }

    const zoom = clamp(Math.min(ideal, 1), MIN_REVEAL_ZOOM, 1);
    const shift = topMargin - rect.y * zoom;

    /*
      Nothing to do only when there is nothing to scale *and* nothing to slide.

      This used to return as soon as `ideal` reached 1, and on a portrait phone
      that is the common case rather than the rare one: the film needs no
      shrinking, it needs to move up. Bailing out here left the frame exactly
      where it was and dropped the slide with it, so the sales copy was printed
      across the product on every phone wide enough not to need the scale —
      165 px of overlap on a 390x844 screen, 84 px on a 430x932.
    */
    if (zoom >= 0.999 && Math.abs(shift) < 0.5) {
      this.clearRevealTransform();
      return;
    }

    this.#writeRevealTransform(zoom, shift, rect, box, topMargin, ideal);
  }

  #writeRevealTransform(
    zoom: number,
    shift: number,
    rect: MediaRect,
    box: { readonly width: number; readonly height: number },
    topMargin: number,
    ideal = zoom,
  ): void {
    const style = this.#stage.style;
    style.setProperty('--reveal-zoom', zoom.toFixed(4));
    style.setProperty('--reveal-shift', `${shift.toFixed(2)}px`);

    // `card`    — the film now sits wholly inside the stage, so the stylesheet
    //             rounds its corners and floats it on the studio wash.
    // `shifted` — it only slid; its edges still meet the ambient extension.
    // `crowded` — not even the smallest allowed scale clears the panel, so the
    //             stylesheet veils the stage to keep the copy legible.
    const fitsInside =
      rect.width * zoom <= box.width - 1 && topMargin + rect.height * zoom <= box.height + 1;
    this.#stage.dataset['revealFit'] =
      ideal < MIN_REVEAL_ZOOM ? 'crowded' : fitsInside ? 'card' : 'shifted';
  }

  clearRevealTransform(): void {
    this.#stage.style.setProperty('--reveal-zoom', '1');
    this.#stage.style.setProperty('--reveal-shift', '0px');
    delete this.#stage.dataset['revealFit'];
  }
}

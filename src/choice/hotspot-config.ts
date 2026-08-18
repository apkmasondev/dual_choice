import type { SourceRect } from './mediaProjection.ts';

/**
 * Natural size of every delivered clip. All hotspot coordinates below are
 * fractions of this frame, never of the viewport.
 */
export const SOURCE_FRAME = { width: 1280, height: 720 } as const;

/**
 * The part of the frame that must never be cropped away.
 *
 * Measured from the CHOICE frame (the last frame of the intro): the crystal
 * occupies x 270..407 and the sphere x 830..990, so the band below keeps both
 * objects — plus a margin — on screen at every viewport ratio, including
 * 9:20 portrait. Full frame height is kept so the head and the hands stay in
 * shot. See docs in README, "Hotspot projection".
 */
export const FOCUS_RECT: SourceRect = { x: 236, y: 0, width: 808, height: 720 };

/**
 * The part of a branch's final frame the sales copy must never sit on.
 *
 * Measured from both reveal stills: the earbuds occupy x 460..800, y 180..480
 * and the ring x 555..735, y 215..455, with their stands just below. The union
 * plus a margin is what the reveal layout keeps clear.
 */
export const PRODUCT_SAFE_RECT: SourceRect = { x: 420, y: 150, width: 450, height: 370 };

export type BranchId = 'blue' | 'red';

export interface HotspotDefinition {
  readonly id: BranchId;
  /** Centre of the object, as a fraction of the source frame. */
  readonly x: number;
  readonly y: number;
  /** Visual radius of the object in source pixels (measured, not guessed). */
  readonly sourceRadius: number;
  /** Hit area radius in source pixels; always larger than the visible ring. */
  readonly hitRadius: number;
  /**
   * Where the label sits relative to the object centre, in source pixels.
   * Chosen so the label lands on empty studio backdrop and never covers the
   * face, the hands or the object itself.
   */
  readonly labelOffsetY: number;
}

/**
 * Calibrated against the encoded CHOICE frame by thresholding the object
 * against the studio backdrop:
 *
 *   crystal  bbox x[270,407] y[278,415] -> centre (338.5, 346.5) r 68.5
 *   sphere   bbox x[857,990] y[288,425] -> centre (923.0, 352.0) r 68.0
 *
 * Re-check with `?calibrate=1` in a dev build after any re-encode.
 */
export const CHOICE_HOTSPOTS: readonly HotspotDefinition[] = [
  {
    id: 'blue',
    x: 338.5 / SOURCE_FRAME.width,
    y: 346.5 / SOURCE_FRAME.height,
    sourceRadius: 69,
    hitRadius: 96,
    labelOffsetY: -128,
  },
  {
    id: 'red',
    x: 923 / SOURCE_FRAME.width,
    y: 352 / SOURCE_FRAME.height,
    sourceRadius: 68,
    hitRadius: 96,
    labelOffsetY: -128,
  },
];

/** Smallest accessible touch target, per WCAG 2.2 target size (minimum). */
export const MIN_TOUCH_TARGET_PX = 44;

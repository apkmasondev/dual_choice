/**
 * The single geometry authority for the stage.
 *
 * Both the <video> element and the hotspot layer are positioned from the rect
 * this module returns, so a hotspot can never drift away from the object it
 * marks: there is no CSS `object-fit` running its own, slightly different,
 * version of the same maths anywhere in the project.
 *
 * Coordinates come in as fractions of the *source frame* (0..1 of 1280x720),
 * never as percentages of the viewport.
 */

export interface SourceSize {
  readonly width: number;
  readonly height: number;
}

export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle expressed in source-frame pixels. */
export interface SourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `cover`   — fill the box, crop whatever falls outside it.
 * `contain` — show the whole frame, leave empty space on one axis.
 * `focus`   — fill the box but never crop into `focus`; the compromise between
 *             the two, and the default for this project.
 */
export type FitMode = 'cover' | 'contain' | 'focus';

export interface MediaRect {
  /** Offset of the rendered frame's top-left corner inside the box, in CSS px. */
  readonly x: number;
  readonly y: number;
  /** Size of the whole rendered frame in CSS px (may exceed the box). */
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly mode: FitMode;
  /** True when the rendered frame does not fill the box on at least one axis. */
  readonly hasLetterbox: boolean;
}

export interface ProjectionOptions {
  readonly mode?: FitMode;
  /** Region of the frame that must stay fully visible in `focus` mode. */
  readonly focus?: SourceRect;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const EPSILON = 0.01;

function clampRectToSource(rect: SourceRect, source: SourceSize): SourceRect {
  const x = Math.max(0, Math.min(rect.x, source.width));
  const y = Math.max(0, Math.min(rect.y, source.height));
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, source.width - x)),
    height: Math.max(1, Math.min(rect.height, source.height - y)),
  };
}

function axisOffset(boxLength: number, renderedLength: number, desiredCentre: number): number {
  if (renderedLength <= boxLength) {
    // Frame is smaller than the box: centre it and let the backdrop fill the rest.
    return (boxLength - renderedLength) / 2;
  }
  // Frame overflows: honour the requested centre but never expose an edge.
  const raw = boxLength / 2 - desiredCentre;
  return Math.min(0, Math.max(boxLength - renderedLength, raw));
}

/**
 * Maps the source frame onto a box.
 *
 * `focus` mode picks the largest scale that still keeps the focus rect inside
 * the box, capped at the `cover` scale so the frame is never scaled up beyond
 * what the box needs.
 */
export function projectMedia(
  source: SourceSize,
  box: BoxSize,
  options: ProjectionOptions = {},
): MediaRect {
  const mode = options.mode ?? 'focus';
  const boxWidth = Math.max(0, box.width);
  const boxHeight = Math.max(0, box.height);

  if (source.width <= 0 || source.height <= 0 || boxWidth === 0 || boxHeight === 0) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 0, mode, hasLetterbox: true };
  }

  const coverScale = Math.max(boxWidth / source.width, boxHeight / source.height);
  const containScale = Math.min(boxWidth / source.width, boxHeight / source.height);

  let scale: number;
  let centre: Point;

  if (mode === 'cover') {
    scale = coverScale;
    centre = { x: source.width / 2, y: source.height / 2 };
  } else if (mode === 'contain') {
    scale = containScale;
    centre = { x: source.width / 2, y: source.height / 2 };
  } else {
    const focus = clampRectToSource(
      options.focus ?? { x: 0, y: 0, width: source.width, height: source.height },
      source,
    );
    const focusScale = Math.min(boxWidth / focus.width, boxHeight / focus.height);
    scale = Math.min(focusScale, coverScale);
    centre = { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 };
  }

  const width = source.width * scale;
  const height = source.height * scale;

  return {
    x: axisOffset(boxWidth, width, centre.x * scale),
    y: axisOffset(boxHeight, height, centre.y * scale),
    width,
    height,
    scale,
    mode,
    hasLetterbox: width < boxWidth - EPSILON || height < boxHeight - EPSILON,
  };
}

/**
 * Projects a normalised source coordinate (0..1) to a CSS-pixel position
 * inside the box. This is the function that keeps a hotspot on the crystal.
 */
export function projectPoint(rect: MediaRect, normalisedX: number, normalisedY: number): Point {
  return {
    x: rect.x + normalisedX * rect.width,
    y: rect.y + normalisedY * rect.height,
  };
}

/** Scales a length measured in source pixels into CSS pixels. */
export function projectLength(rect: MediaRect, sourceLength: number): number {
  return sourceLength * rect.scale;
}

/** True when a normalised source point currently falls inside the visible box. */
export function isPointVisible(
  rect: MediaRect,
  box: BoxSize,
  normalisedX: number,
  normalisedY: number,
): boolean {
  const point = projectPoint(rect, normalisedX, normalisedY);
  return point.x >= 0 && point.y >= 0 && point.x <= box.width && point.y <= box.height;
}

/** Inverse of {@link projectPoint} — used by the dev calibration overlay. */
export function unprojectPoint(rect: MediaRect, clientX: number, clientY: number): Point {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: (clientX - rect.x) / rect.width,
    y: (clientY - rect.y) / rect.height,
  };
}

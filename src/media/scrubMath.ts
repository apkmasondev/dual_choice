import { clamp, clamp01 } from '../utils/math.ts';

/**
 * Pure maths behind the scroll-driven intro.
 *
 * Kept free of DOM so the awkward parts — refresh-rate independence, the
 * catch-up limit, the safe end frame — are unit tested rather than eyeballed
 * on one machine.
 */

export interface ScrubTuning {
  /**
   * Time constant of the exponential smoother, in seconds. Larger = heavier.
   * 0.13 s reads as "expensive camera" without feeling laggy.
   */
  readonly tau: number;
  /** Duration of one source frame, in seconds (1/24 here). */
  readonly frameDuration: number;
  /**
   * Hard cap on a single step, expressed in source frames. Stops a flick
   * gesture from teleporting the film; it catches up over a few frames instead.
   */
  readonly maxFrameStep: number;
  /**
   * Cap on catch-up speed as a multiple of real time. Without it the per-step
   * cap alone would let a 144 Hz display advance the film twice as fast as a
   * 60 Hz one for the same gesture.
   */
  readonly maxCatchUpRate: number;
}

export const DEFAULT_SCRUB_TUNING: ScrubTuning = {
  tau: 0.13,
  frameDuration: 1 / 24,
  maxFrameStep: 2.25,
  maxCatchUpRate: 6,
};

/** Normalised 0..1 position inside the scroll section. */
export function scrollProgress(scrollY: number, sectionStart: number, scrollRange: number): number {
  if (scrollRange <= 0) return 0;
  return clamp01((scrollY - sectionStart) / scrollRange);
}

/**
 * Frame-rate independent smoothing factor.
 * `alpha = 1 - e^(-dt/tau)` converges at the same wall-clock rate at 60, 120
 * or 144 Hz, unlike the usual `current += (target - current) * 0.1`.
 */
export function smoothingAlpha(dt: number, tau: number): number {
  if (tau <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, dt) / tau);
}

/**
 * Advances the smoothed playhead one animation frame towards `target`.
 * Returns the new smoothed time; never overshoots.
 */
export function scrubStep(
  current: number,
  target: number,
  dt: number,
  tuning: ScrubTuning = DEFAULT_SCRUB_TUNING,
): number {
  if (dt <= 0) return current;
  const delta = target - current;
  if (delta === 0) return current;

  const eased = delta * smoothingAlpha(dt, tuning.tau);
  const maxStep = Math.min(tuning.maxFrameStep * tuning.frameDuration, tuning.maxCatchUpRate * dt);
  const limited = clamp(eased, -maxStep, maxStep);

  // Never step past the target, whichever limit was active.
  return Math.abs(limited) >= Math.abs(delta) ? target : current + limited;
}

/**
 * Last timestamp that is safe to sit on.
 *
 * Seeking exactly to `duration` makes several browsers show a blank or
 * rounded-off frame, so hold half a frame short of the end instead.
 */
export function safeEndTime(duration: number, frameDuration: number): number {
  return Math.max(0, duration - frameDuration * 0.5);
}

/** True when two timestamps land on the same source frame, so no seek is needed. */
export function isSameFrame(a: number, b: number, frameDuration: number): boolean {
  return Math.floor(a / frameDuration) === Math.floor(b / frameDuration);
}

/**
 * The intro only hands over to CHOICE when the visitor has scrolled to the end
 * *and* the decoder has actually reached the final frame — otherwise hotspots
 * could appear over a frame where the objects are still moving.
 */
export function hasReachedChoice(
  progress: number,
  videoTime: number,
  endTime: number,
  frameDuration: number,
  progressThreshold = 0.985,
): boolean {
  return progress >= progressThreshold && endTime - videoTime <= frameDuration * 2;
}

/** Hysteresis so a pixel of scroll jitter cannot flicker CHOICE on and off. */
export function hasLeftChoice(progress: number, progressThreshold = 0.94): boolean {
  return progress < progressThreshold;
}

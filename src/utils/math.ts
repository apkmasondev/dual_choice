export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Maps `value` from one range to another and clamps the result to 0..1. */
export function normalise(value: number, from: number, to: number): number {
  if (to === from) return 0;
  return clamp01((value - from) / (to - from));
}

/** Smoothstep-ish ease used for opacity ramps that must not look linear. */
export function easeOutCubic(t: number): number {
  const clamped = clamp01(t);
  return 1 - (1 - clamped) ** 3;
}

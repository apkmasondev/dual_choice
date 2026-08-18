import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCRUB_TUNING,
  hasLeftChoice,
  hasReachedChoice,
  isSameFrame,
  safeEndTime,
  scrollProgress,
  scrubStep,
  smoothingAlpha,
} from '../../src/media/scrubMath.ts';

const FRAME = 1 / 24;

/** Runs the smoother for `seconds` of wall clock at a given refresh rate. */
function simulate(target: number, seconds: number, hz: number, start = 0): number {
  const dt = 1 / hz;
  let current = start;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    current = scrubStep(current, target, dt);
  }
  return current;
}

describe('scrollProgress', () => {
  it('clamps to 0..1', () => {
    expect(scrollProgress(-500, 0, 2000)).toBe(0);
    expect(scrollProgress(0, 0, 2000)).toBe(0);
    expect(scrollProgress(1000, 0, 2000)).toBe(0.5);
    expect(scrollProgress(2000, 0, 2000)).toBe(1);
    expect(scrollProgress(9999, 0, 2000)).toBe(1);
  });

  it('accounts for the section offset', () => {
    expect(scrollProgress(1500, 1000, 2000)).toBeCloseTo(0.25, 9);
  });

  it('returns 0 rather than Infinity for a zero-length range', () => {
    expect(scrollProgress(100, 0, 0)).toBe(0);
  });
});

describe('smoothingAlpha', () => {
  it('is 0 for no elapsed time and approaches 1 for long frames', () => {
    expect(smoothingAlpha(0, 0.13)).toBe(0);
    expect(smoothingAlpha(10, 0.13)).toBeCloseTo(1, 6);
  });

  it('is monotonic in dt', () => {
    expect(smoothingAlpha(1 / 144, 0.13)).toBeLessThan(smoothingAlpha(1 / 60, 0.13));
    expect(smoothingAlpha(1 / 60, 0.13)).toBeLessThan(smoothingAlpha(1 / 30, 0.13));
  });
});

describe('scrubStep — refresh rate independence', () => {
  it('converges to the same place at 60, 120 and 144 Hz', () => {
    const target = 3;
    const at60 = simulate(target, 1.2, 60);
    const at120 = simulate(target, 1.2, 120);
    const at144 = simulate(target, 1.2, 144);
    // Within a tenth of a source frame of each other.
    expect(Math.abs(at60 - at120)).toBeLessThan(FRAME * 0.1);
    expect(Math.abs(at120 - at144)).toBeLessThan(FRAME * 0.1);
  });

  it('never overshoots the target', () => {
    let current = 0;
    for (let i = 0; i < 500; i++) current = scrubStep(current, 2, 1 / 60);
    expect(current).toBeLessThanOrEqual(2);
    expect(current).toBeCloseTo(2, 4);
  });

  it('works the same going backwards', () => {
    const back = simulate(0, 1.2, 60, 5);
    expect(back).toBeGreaterThanOrEqual(0);
    // Within a single source frame of the target after 1.2 s of catching up.
    expect(back).toBeLessThan(FRAME);
  });
});

describe('scrubStep — catch-up limit', () => {
  it('does not teleport on a huge scroll jump', () => {
    const afterOneFrame = scrubStep(0, 10, 1 / 60);
    const maxStep = Math.min(
      DEFAULT_SCRUB_TUNING.maxFrameStep * FRAME,
      DEFAULT_SCRUB_TUNING.maxCatchUpRate * (1 / 60),
    );
    expect(afterOneFrame).toBeLessThanOrEqual(maxStep + 1e-9);
    expect(afterOneFrame).toBeGreaterThan(0);
  });

  it('caps a single step at ~2.25 source frames even on a slow frame', () => {
    const step = scrubStep(0, 10, 1 / 15);
    expect(step).toBeLessThanOrEqual(DEFAULT_SCRUB_TUNING.maxFrameStep * FRAME + 1e-9);
  });

  it('caps catch-up speed so a 144 Hz display is not six times faster', () => {
    const seconds = 0.5;
    const at60 = simulate(10, seconds, 60);
    const at144 = simulate(10, seconds, 144);
    expect(Math.abs(at144 - at60)).toBeLessThan(0.35);
  });

  it('still catches up rather than stalling', () => {
    const caught = simulate(9, 4, 60);
    expect(caught).toBeGreaterThan(8.9);
  });

  it('is a no-op for a non-positive dt', () => {
    expect(scrubStep(1, 5, 0)).toBe(1);
    expect(scrubStep(1, 5, -1)).toBe(1);
  });
});

describe('safeEndTime and frame dedup', () => {
  it('holds half a frame short of the duration', () => {
    expect(safeEndTime(10.005, FRAME)).toBeCloseTo(10.005 - FRAME / 2, 9);
  });

  it('never returns a negative time', () => {
    expect(safeEndTime(0.001, FRAME)).toBe(0);
  });

  it('detects timestamps that land on the same source frame', () => {
    expect(isSameFrame(0.0, 0.04, FRAME)).toBe(true);
    expect(isSameFrame(0.0, 0.0417, FRAME)).toBe(false);
  });
});

describe('choice hand-over', () => {
  const endTime = safeEndTime(10.005, FRAME);

  it('waits for both the scroll and the decoder', () => {
    expect(hasReachedChoice(0.99, 5, endTime, FRAME)).toBe(false);
    expect(hasReachedChoice(0.5, endTime, endTime, FRAME)).toBe(false);
    expect(hasReachedChoice(0.99, endTime, endTime, FRAME)).toBe(true);
  });

  it('accepts being one or two frames short of the end', () => {
    expect(hasReachedChoice(1, endTime - FRAME * 1.5, endTime, FRAME)).toBe(true);
    expect(hasReachedChoice(1, endTime - FRAME * 4, endTime, FRAME)).toBe(false);
  });

  it('uses hysteresis so scroll jitter cannot flicker the hotspots', () => {
    expect(hasLeftChoice(0.99)).toBe(false);
    expect(hasLeftChoice(0.95)).toBe(false);
    expect(hasLeftChoice(0.9)).toBe(true);
  });
});

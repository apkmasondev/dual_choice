import { describe, expect, it } from 'vitest';
import {
  isPointVisible,
  projectLength,
  projectMedia,
  projectPoint,
  unprojectPoint,
  type BoxSize,
} from '../../src/choice/mediaProjection.ts';
import { CHOICE_HOTSPOTS, FOCUS_RECT, SOURCE_FRAME } from '../../src/choice/hotspot-config.ts';

const SOURCE = SOURCE_FRAME;
const TOLERANCE = 0.5;

/** Viewport matrix from plan sections 20, 21 and 25.1. */
const VIEWPORTS: readonly (BoxSize & { label: string })[] = [
  { label: 'desktop 1920x1080', width: 1920, height: 1080 },
  { label: 'laptop 1440x900', width: 1440, height: 900 },
  { label: 'laptop 1366x768', width: 1366, height: 768 },
  { label: 'ultrawide 2560x1080', width: 2560, height: 1080 },
  { label: 'phone 360x800', width: 360, height: 800 },
  { label: 'phone 390x844', width: 390, height: 844 },
  { label: 'phone 393x852', width: 393, height: 852 },
  { label: 'phone 430x932', width: 430, height: 932 },
  { label: 'phone landscape 844x390', width: 844, height: 390 },
  { label: 'tablet portrait 768x1024', width: 768, height: 1024 },
  { label: 'zoom 200% 720x450', width: 720, height: 450 },
];

describe('projectMedia — cover', () => {
  it('matches the reference formula for 1280x720 -> 1920x1080', () => {
    const rect = projectMedia(SOURCE, { width: 1920, height: 1080 }, { mode: 'cover' });
    expect(rect.scale).toBeCloseTo(1.5, 6);
    expect(rect.width).toBeCloseTo(1920, 6);
    expect(rect.height).toBeCloseTo(1080, 6);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expect(rect.hasLetterbox).toBe(false);
  });

  it('crops the sides on a 1440x900 box', () => {
    const rect = projectMedia(SOURCE, { width: 1440, height: 900 }, { mode: 'cover' });
    // scale = max(1440/1280, 900/720) = 1.25
    expect(rect.scale).toBeCloseTo(1.25, 6);
    expect(rect.width).toBeCloseTo(1600, 6);
    expect(rect.x).toBeCloseTo(-80, 6);
    expect(rect.y).toBeCloseTo(0, 6);
  });

  it('crops top and bottom hard on a 390x844 portrait box', () => {
    const rect = projectMedia(SOURCE, { width: 390, height: 844 }, { mode: 'cover' });
    expect(rect.scale).toBeCloseTo(844 / 720, 6);
    expect(rect.width).toBeCloseTo((844 / 720) * 1280, 6);
    expect(rect.hasLetterbox).toBe(false);
  });
});

describe('projectMedia — contain', () => {
  it('fits the whole frame with letterboxing on 390x844', () => {
    const rect = projectMedia(SOURCE, { width: 390, height: 844 }, { mode: 'contain' });
    expect(rect.scale).toBeCloseTo(390 / 1280, 6);
    expect(rect.width).toBeCloseTo(390, 6);
    expect(rect.height).toBeCloseTo(219.375, 6);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo((844 - 219.375) / 2, 6);
    expect(rect.hasLetterbox).toBe(true);
  });

  it('is identical to cover on an exactly 16:9 box', () => {
    const box = { width: 1600, height: 900 };
    const contain = projectMedia(SOURCE, box, { mode: 'contain' });
    const cover = projectMedia(SOURCE, box, { mode: 'cover' });
    expect(contain.scale).toBeCloseTo(cover.scale, 9);
    expect(contain.x).toBeCloseTo(cover.x, 9);
    expect(contain.y).toBeCloseTo(cover.y, 9);
  });
});

describe('projectMedia — focus (project default)', () => {
  it('degenerates to cover when the box ratio sits between focus and frame', () => {
    const box = { width: 1440, height: 900 };
    const focus = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
    const cover = projectMedia(SOURCE, box, { mode: 'cover' });
    expect(focus.scale).toBeCloseTo(cover.scale, 9);
    expect(focus.hasLetterbox).toBe(false);
  });

  it('never scales beyond cover on ultrawide, so the subject is not stretched', () => {
    const box = { width: 2560, height: 1080 };
    const rect = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
    expect(rect.scale).toBeCloseTo(1.5, 6);
    expect(rect.width).toBeCloseTo(1920, 6);
    expect(rect.height).toBeCloseTo(1080, 6);
    // Whole frame visible, ambient bands left and right.
    expect(rect.x).toBeCloseTo(320, 6);
    expect(rect.hasLetterbox).toBe(true);
  });

  it('shows exactly the focus band on a 9:19.5 portrait box', () => {
    const box = { width: 390, height: 844 };
    const rect = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
    expect(rect.scale).toBeCloseTo(390 / FOCUS_RECT.width, 6);

    // Left and right edges of the focus rect land on the box edges.
    const left = projectPoint(rect, FOCUS_RECT.x / SOURCE.width, 0);
    const right = projectPoint(rect, (FOCUS_RECT.x + FOCUS_RECT.width) / SOURCE.width, 0);
    expect(left.x).toBeCloseTo(0, 6);
    expect(right.x).toBeCloseTo(390, 6);
  });

  it('is taller than plain contain on portrait, which is the whole point', () => {
    const box = { width: 390, height: 844 };
    const focus = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
    const contain = projectMedia(SOURCE, box, { mode: 'contain' });
    expect(focus.height).toBeGreaterThan(contain.height * 1.5);
  });

  it('preserves the source aspect ratio at every viewport', () => {
    for (const box of VIEWPORTS) {
      const rect = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
      expect(rect.width / rect.height).toBeCloseTo(SOURCE.width / SOURCE.height, 6);
    }
  });

  it('never exposes an edge of the frame while the frame overflows the box', () => {
    for (const box of VIEWPORTS) {
      const rect = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
      if (rect.width > box.width) {
        expect(rect.x).toBeLessThanOrEqual(0 + TOLERANCE);
        expect(rect.x + rect.width).toBeGreaterThanOrEqual(box.width - TOLERANCE);
      }
      if (rect.height > box.height) {
        expect(rect.y).toBeLessThanOrEqual(0 + TOLERANCE);
        expect(rect.y + rect.height).toBeGreaterThanOrEqual(box.height - TOLERANCE);
      }
    }
  });
});

describe('projectPoint — hotspots stay on their objects', () => {
  it('places each hotspot, plus its full radius, inside every tested viewport', () => {
    for (const box of VIEWPORTS) {
      const rect = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
      for (const hotspot of CHOICE_HOTSPOTS) {
        const point = projectPoint(rect, hotspot.x, hotspot.y);
        const radius = projectLength(rect, hotspot.sourceRadius);
        expect(
          point.x - radius,
          `${hotspot.id} left edge off-screen at ${box.label}`,
        ).toBeGreaterThanOrEqual(-TOLERANCE);
        expect(
          point.x + radius,
          `${hotspot.id} right edge off-screen at ${box.label}`,
        ).toBeLessThanOrEqual(box.width + TOLERANCE);
        expect(
          point.y - radius,
          `${hotspot.id} top edge off-screen at ${box.label}`,
        ).toBeGreaterThanOrEqual(-TOLERANCE);
        expect(
          point.y + radius,
          `${hotspot.id} bottom edge off-screen at ${box.label}`,
        ).toBeLessThanOrEqual(box.height + TOLERANCE);
        expect(isPointVisible(rect, box, hotspot.x, hotspot.y)).toBe(true);
      }
    }
  });

  it('keeps the two hotspots apart by at least a touch target at every viewport', () => {
    const [blue, red] = CHOICE_HOTSPOTS;
    if (!blue || !red) throw new Error('expected two hotspots');
    for (const box of VIEWPORTS) {
      const rect = projectMedia(SOURCE, box, { focus: FOCUS_RECT });
      const a = projectPoint(rect, blue.x, blue.y);
      const b = projectPoint(rect, red.x, red.y);
      expect(Math.hypot(b.x - a.x, b.y - a.y), `too close at ${box.label}`).toBeGreaterThan(44);
    }
  });

  it('reproduces the documented cover formula exactly', () => {
    const box = { width: 1440, height: 900 };
    const rect = projectMedia(SOURCE, box, { mode: 'cover' });
    const hotspot = CHOICE_HOTSPOTS[0];
    if (!hotspot) throw new Error('expected a hotspot');

    const scale = Math.max(box.width / SOURCE.width, box.height / SOURCE.height);
    const renderedW = SOURCE.width * scale;
    const renderedH = SOURCE.height * scale;
    const expectedX = (box.width - renderedW) / 2 + hotspot.x * renderedW;
    const expectedY = (box.height - renderedH) / 2 + hotspot.y * renderedH;

    const point = projectPoint(rect, hotspot.x, hotspot.y);
    expect(Math.abs(point.x - expectedX)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(point.y - expectedY)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('round-trips through unprojectPoint', () => {
    const rect = projectMedia(SOURCE, { width: 393, height: 852 }, { focus: FOCUS_RECT });
    for (const hotspot of CHOICE_HOTSPOTS) {
      const point = projectPoint(rect, hotspot.x, hotspot.y);
      const back = unprojectPoint(rect, point.x, point.y);
      expect(back.x).toBeCloseTo(hotspot.x, 9);
      expect(back.y).toBeCloseTo(hotspot.y, 9);
    }
  });
});

describe('projectMedia — degenerate input', () => {
  it('returns an empty rect rather than NaN for a zero-sized box', () => {
    const rect = projectMedia(SOURCE, { width: 0, height: 0 }, { focus: FOCUS_RECT });
    expect(rect.width).toBe(0);
    expect(rect.scale).toBe(0);
    expect(Number.isNaN(rect.x)).toBe(false);
  });

  it('clamps a focus rect that reaches outside the frame', () => {
    const rect = projectMedia(
      SOURCE,
      { width: 400, height: 900 },
      { focus: { x: -200, y: -50, width: 4000, height: 4000 } },
    );
    expect(Number.isFinite(rect.scale)).toBe(true);
    expect(rect.scale).toBeGreaterThan(0);
  });
});

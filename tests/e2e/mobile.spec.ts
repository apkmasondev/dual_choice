import { expect, test } from '@playwright/test';
import {
  chooseBranch,
  expectHotspotOnObject,
  reachChoice,
  resizeStage,
  skipToReveal,
} from './helpers.ts';

test.describe('mobile', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'projection probe needs Chromium');

  test('keeps both objects in frame on a tall phone @smoke', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachChoice(page);

    await expectHotspotOnObject(page, 'blue');
    await expectHotspotOnObject(page, 'red');

    const geometry = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('#film-intro');
      const rect = video?.getBoundingClientRect();
      return rect
        ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            vh: globalThis.innerHeight,
          }
        : null;
    });
    expect(geometry).not.toBeNull();

    // A blind full-screen `cover` would have scaled the frame to the viewport
    // height (1.17x) and cropped the objects off the sides. The focus fit
    // keeps the whole 808 px band, so the frame is wider than the screen only
    // by the part of the studio nobody needs.
    expect(geometry!.height).toBeLessThan(geometry!.vh * 0.55);
    expect(geometry!.height).toBeGreaterThan(geometry!.vh * 0.3);
    expect(geometry!.width / geometry!.height).toBeCloseTo(1280 / 720, 2);
  });

  test('survives portrait -> landscape -> portrait at CHOICE', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachChoice(page);

    for (const viewport of [
      { width: 844, height: 390 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 360, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await resizeStage(page, viewport);
      await expect(page.locator('html')).toHaveAttribute('data-state', 'choice');
      await expectHotspotOnObject(page, 'blue');
      await expectHotspotOnObject(page, 'red');
    }
  });

  test('every control meets the 44px touch target minimum', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await reachChoice(page);

    for (const selector of ['#hotspot-blue', '#hotspot-red', '#sound-toggle']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} has no box`).not.toBeNull();
      expect(box!.width, `${selector} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${selector} height`).toBeGreaterThanOrEqual(44);
    }

    await chooseBranch(page, 'blue');
    await skipToReveal(page, 'blue');

    for (const name of ['START A PROJECT', 'VIEW MORE WORK', 'CHOOSE AGAIN']) {
      const box = await page
        .getByRole(name === 'CHOOSE AGAIN' ? 'button' : 'link', { name })
        .boundingBox();
      expect(box, `${name} has no box`).not.toBeNull();
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('never overflows horizontally and keeps the CTA inside the safe area', async ({ page }) => {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 393, height: 852 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(viewport);
      await reachChoice(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);

      await chooseBranch(page, 'red');
      await skipToReveal(page, 'red');

      const fits = await page.evaluate(() => {
        const reveal = document.getElementById('reveal');
        if (!reveal) return null;
        const box = reveal.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, vh: globalThis.innerHeight };
      });
      expect(fits, 'reveal panel missing').not.toBeNull();
      expect(fits!.top, `reveal clipped at top on ${viewport.width}`).toBeGreaterThanOrEqual(-1);
      expect(fits!.bottom, `reveal clipped at bottom on ${viewport.width}`).toBeLessThanOrEqual(
        fits!.vh + 1,
      );
    }
  });
});

import { expect, test } from '@playwright/test';
import {
  chooseBranch,
  enterMuted,
  expectHotspotOnObject,
  gotoExperience,
  reachChoice,
  resizeStage,
  skipToReveal,
  waitForRevealSettled,
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

  /*
    The one thing the reveal must never do on a phone.

    There is no room to draw the film back into a card on a portrait screen,
    so it slides up instead — and if that slide is dropped, or is not enough,
    the sales copy is printed straight across the product. That is exactly
    what happened: the fit returned early whenever the frame needed no
    scaling, which on a phone is the common case, and left 165 px of overlap
    on a 390x844 screen. Nothing in this suite noticed, because nothing
    measured it.
  */
  test('the product clears the sales copy on every phone', async ({ page }) => {
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      await reachChoice(page);
      await chooseBranch(page, 'red');
      await skipToReveal(page, 'red');
      await waitForRevealSettled(page);

      const clearance = await page.evaluate(() => {
        const film = document.querySelector<HTMLVideoElement>('.film[data-active="true"]');
        const panel = document.getElementById('reveal');
        if (!film || !panel) return null;
        const frame = film.getBoundingClientRect();
        // Bottom of PRODUCT_SAFE_RECT: 150 + 370 of the 720 source rows.
        const productBottom = frame.y + (520 / 720) * frame.height;
        return panel.getBoundingClientRect().top - productBottom;
      });

      expect(clearance, `no reveal panel at ${viewport.width}x${viewport.height}`).not.toBeNull();
      expect(
        clearance!,
        `the copy sits on the product at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  /*
    The whole reason the phone stopped scrubbing.

    A coarse pointer gets the film played to it: no scroll map, no hint asking
    for a gesture that does nothing, and the choice arriving when the film
    ends rather than when a finger drags far enough.
  */
  test('the intro plays itself and hands over at the end', async ({ page }) => {
    await gotoExperience(page);
    await enterMuted(page);
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro', { timeout: 25_000 });

    const setup = await page.evaluate(() => ({
      drive: document.documentElement.dataset['drive'],
      scrollable: document.documentElement.scrollHeight - globalThis.innerHeight,
      playing: !document.querySelector<HTMLVideoElement>('#film-intro')?.paused,
    }));
    expect(setup.drive, 'a touch device should not be asked to scrub').toBe('playback');
    expect(setup.scrollable, 'there is nothing to scroll').toBeLessThanOrEqual(1);
    expect(setup.playing, 'the film should run under its own power').toBe(true);

    // SKIP is armed throughout, so nobody is held to the ten seconds.
    await expect(page.locator('#skip')).toHaveAttribute('data-visible', 'true', {
      timeout: 15_000,
    });

    // Left alone, the film reaches the end and hands over by itself.
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 25_000 });
    await expect(page.locator('#skip')).toBeHidden();
    await expect(page.locator('#hotspot-blue')).toHaveAttribute('tabindex', '0');

    // And it can do it a second time. The controller latches "this film has
    // ended" so a stray event cannot hand over twice; a replay that inherited
    // that latch ran to the end and handed over to nobody.
    await page.locator('#brand-home').click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro', { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 25_000 });
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

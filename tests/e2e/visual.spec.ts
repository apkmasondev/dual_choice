import { devices, test } from '@playwright/test';
import {
  advanceToChoice,
  chooseBranch,
  enterMuted,
  gotoExperience,
  reachChoice,
  skipToReveal,
} from './helpers.ts';

/**
 * Reference stills for review.
 *
 * Deliberately not pixel-diff assertions over a moving film: a frame grabbed
 * mid-playback is decoder-dependent and would fail for reasons that have
 * nothing to do with this project (plan section 27). These capture the states
 * that are genuinely stable — poster, choice, hover, focus and the final
 * frames — into test-results/visual/ for a human to look at.
 */

const OUT = 'test-results/visual';

test.describe('visual reference', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'reference shots are captured once');

  test('desktop states', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await gotoExperience(page);
    // The gate arrives over 900 ms and its rule draws itself in after that;
    // a still taken on `ready` catches the fade, not the composition.
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/desktop-01-entry.png` });

    await enterMuted(page);
    await page.evaluate(() => {
      globalThis.scrollTo(0, document.documentElement.scrollHeight * 0.45);
    });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/desktop-02-intro-mid.png` });

    await page.evaluate(() => {
      globalThis.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForFunction(() => document.documentElement.dataset['state'] === 'choice', null, {
      timeout: 20_000,
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/desktop-03-choice.png` });

    await page.locator('#hotspot-blue').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/desktop-04-hover-blue.png` });

    await page.locator('#hotspot-red').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/desktop-05-hover-red.png` });

    // Focused by keyboard, not by .focus(): the ring is drawn by
    // :focus-visible, which only matches when the last input was a key. The
    // pointer is parked off both objects first, or the shot shows a hover.
    await page.mouse.move(720, 870);
    await page.evaluate(() => {
      document.body.focus();
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/desktop-06-focus-blue.png` });

    await chooseBranch(page, 'blue');
    await skipToReveal(page, 'blue');
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/desktop-07-blue-reveal.png` });

    await page.getByRole('button', { name: 'CHOOSE AGAIN' }).click();
    await page.waitForFunction(() => document.documentElement.dataset['state'] === 'choice', null, {
      timeout: 15_000,
    });
    await chooseBranch(page, 'red');
    await skipToReveal(page, 'red');
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/desktop-08-red-reveal.png` });

    // The card lights its signature while the call to action is attended to.
    await page.getByRole('link', { name: 'START A PROJECT' }).hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/desktop-09-cta-hover.png` });
  });

  test('ultrawide choice', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1080 });
    await reachChoice(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/ultrawide-choice.png` });
  });

  /*
    Taken through a real touch context, not merely at a phone-sized viewport.
    A coarse pointer gets the intro played rather than scrubbed, and these
    stills are supposed to show what a phone shows.
  */
  test('mobile states', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();

    await gotoExperience(page);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/mobile-01-entry.png` });

    await enterMuted(page);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/mobile-02-intro-playing.png` });

    await advanceToChoice(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/mobile-03-choice-portrait.png` });

    await chooseBranch(page, 'red');
    await skipToReveal(page, 'red');
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/mobile-04-red-reveal.png` });

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/mobile-05-reveal-landscape.png` });
    await context.close();
  });

  test('mobile landscape choice', async ({ browser }) => {
    const context = await browser.newContext({
      ...devices['Pixel 7 landscape'],
    });
    const page = await context.newPage();
    await reachChoice(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/mobile-06-choice-landscape.png` });
    await context.close();
  });
});

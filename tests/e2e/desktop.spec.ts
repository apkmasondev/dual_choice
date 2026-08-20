import { expect, test } from '@playwright/test';
import {
  chooseBranch,
  collectConsoleErrors,
  enterMuted,
  expectHotspotOnObject,
  gotoExperience,
  reachChoice,
  resizeStage,
  scrollToChoice,
  skipToReveal,
} from './helpers.ts';

test.describe('desktop journey', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'projection probe needs Chromium');

  test('runs the whole story from entry to CTA @smoke', async ({ page }) => {
    const problems = await collectConsoleErrors(page);

    await gotoExperience(page);
    await expect(page.getByRole('heading', { name: 'ENTER EXPERIENCE' })).toBeVisible();
    await enterMuted(page);
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro');

    await scrollToChoice(page);
    await expect(page.getByRole('heading', { name: 'CHOOSE YOUR REALITY.' })).toBeVisible();

    // Both hotspots are real buttons with names that do not rely on colour.
    const blue = page.getByRole('button', { name: /CONTROL/ });
    const red = page.getByRole('button', { name: /DESIRE/ });
    await expect(blue).toBeVisible();
    await expect(red).toBeVisible();
    await expect(blue).toHaveAccessibleName(/crystal/i);
    await expect(red).toHaveAccessibleName(/sphere/i);

    await expectHotspotOnObject(page, 'blue');
    await expectHotspotOnObject(page, 'red');

    await chooseBranch(page, 'blue');
    await expect(page.locator('html')).toHaveAttribute('data-state', 'blue-playing', {
      timeout: 15_000,
    });

    // BLUE only ever starts BLUE.
    const playing = await page.evaluate(() => ({
      blue: !document.querySelector<HTMLVideoElement>('#film-blue')?.paused,
      red: !document.querySelector<HTMLVideoElement>('#film-red')?.paused,
    }));
    expect(playing.red, 'RED must not start when BLUE was chosen').toBe(false);
    expect(playing.blue).toBe(true);

    await skipToReveal(page, 'blue');
    await expect(page.getByRole('heading', { name: 'KNOW EVERY DETAIL.' })).toBeVisible();
    await expect(page.getByText('YOUR PRODUCT COULD BE NEXT.')).toBeVisible();

    // Choose again returns without a reload, and RED then works.
    await page.getByRole('button', { name: 'CHOOSE AGAIN' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 15_000 });
    await expectHotspotOnObject(page, 'red');

    await chooseBranch(page, 'red');
    await skipToReveal(page, 'red');
    await expect(page.getByRole('heading', { name: 'FEEL EVERYTHING.' })).toBeVisible();

    const contact = page.getByRole('link', { name: 'START A PROJECT' });
    await expect(contact).toHaveAttribute('href', 'https://example.com/contact');
    await expect(contact).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByRole('link', { name: 'VIEW MORE WORK' })).toHaveAttribute(
      'href',
      'https://example.com/work',
    );

    expect(problems, `console output: ${problems.join(' | ')}`).toEqual([]);
  });

  test('a double click cannot start two films', async ({ page }) => {
    await reachChoice(page);

    const blue = page.locator('#hotspot-blue');
    await blue.dblclick();

    const state = await page.evaluate(() => document.documentElement.dataset['state'] ?? '');
    expect(['branch-loading', 'blue-playing']).toContain(state);

    const redPaused = await page.evaluate(
      () => document.querySelector<HTMLVideoElement>('#film-red')?.paused ?? true,
    );
    expect(redPaused).toBe(true);
  });

  test('clicking the other object after committing is ignored', async ({ page }) => {
    await reachChoice(page);
    await chooseBranch(page, 'red');
    await page.locator('#hotspot-blue').click({ force: true });

    await expect(page.locator('html')).toHaveAttribute('data-branch', 'red');
    const bluePaused = await page.evaluate(
      () => document.querySelector<HTMLVideoElement>('#film-blue')?.paused ?? true,
    );
    expect(bluePaused).toBe(true);
  });

  test('the wordmark winds the experience back to the first frame', async ({ page }) => {
    await reachChoice(page);
    await chooseBranch(page, 'red');
    await skipToReveal(page, 'red');

    await page.getByRole('link', { name: /back to the beginning/i }).click();

    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro', { timeout: 15_000 });
    await expect(page.locator('#reveal')).toBeHidden();
    expect(await page.evaluate(() => globalThis.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.dataset['branch'])).toBeUndefined();

    // And the story runs again from there, rather than merely looking reset.
    await scrollToChoice(page);
    await expectHotspotOnObject(page, 'blue');
  });

  test('the wordmark takes SKIP away with the film it winds back', async ({ page }) => {
    await reachChoice(page);
    await chooseBranch(page, 'red');
    await expect(page.locator('#skip')).toHaveAttribute('data-visible', 'true', {
      timeout: 15_000,
    });

    await page.getByRole('link', { name: /back to the beginning/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro', { timeout: 15_000 });

    // SKIP belongs to a film that is playing, and there is no longer one. It
    // used to survive this route and then sit over the scrub and the choice
    // for the rest of the session, which looked random because it depended on
    // having tapped the wordmark during a film.
    await expect(page.locator('#skip')).toBeHidden();
    await scrollToChoice(page);
    await expect(page.locator('#skip')).toBeHidden();
  });

  test('the wordmark also winds back a film that is still playing', async ({ page }) => {
    await reachChoice(page);
    await chooseBranch(page, 'red');
    await expect(page.locator('html')).toHaveAttribute('data-state', 'red-playing', {
      timeout: 15_000,
    });

    await page.getByRole('link', { name: /back to the beginning/i }).click();

    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro', { timeout: 15_000 });
    const playing = await page.evaluate(
      () => !document.querySelector<HTMLVideoElement>('#film-red')?.paused,
    );
    expect(playing, 'the branch film must not be left running').toBe(false);
  });

  test('hotspots stay glued to their objects across resizes', async ({ page }) => {
    await reachChoice(page);

    const viewports = [
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 2560, height: 1080 },
      { width: 1024, height: 1366 },
      { width: 1440, height: 900 },
    ];

    for (const viewport of viewports) {
      await resizeStage(page, viewport);
      await expectHotspotOnObject(page, 'blue');
      await expectHotspotOnObject(page, 'red');
    }
  });

  test('the frame keeps its aspect ratio and never crops the objects away', async ({ page }) => {
    await reachChoice(page);

    for (const viewport of [
      { width: 2560, height: 1080 },
      { width: 1440, height: 900 },
      { width: 900, height: 1400 },
    ]) {
      await resizeStage(page, viewport);
      const box = await page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('#film-intro');
        const rect = video?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
      });
      expect(box).not.toBeNull();
      expect(box!.width / box!.height).toBeCloseTo(1280 / 720, 2);
    }
  });

  /*
    A range change mid-scrub must not move the page.

    Anything that changes `scrollHeight - innerHeight` while the film is being
    scrubbed — a window resized by hand here, an address bar sliding away on a
    device that still scrubbed — used to be answered by pulling the page back
    to the position that preserved the film's progress. That is 21 px of page
    moving under a pointer that is mid-gesture. The film absorbs the change
    instead, and its own smoothing spreads it over about 200 ms.
  */
  test('a resize during the scrub does not move the page', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await gotoExperience(page);
    await enterMuted(page);
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro', { timeout: 20_000 });

    await page.evaluate(() => {
      const track = document.getElementById('scroll-track');
      if (track) track.style.blockSize = `${track.getBoundingClientRect().height}px`;
      const range = document.documentElement.scrollHeight - globalThis.innerHeight;
      globalThis.scrollTo(0, range * 0.25);
    });
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => Math.round(globalThis.scrollY));

    await page.setViewportSize({ width: 1200, height: 984 });
    await page.waitForTimeout(600);

    expect(await page.evaluate(() => Math.round(globalThis.scrollY))).toBe(before);
  });

  test('there is no horizontal overflow at any tested width', async ({ page }) => {
    await reachChoice(page);
    for (const width of [2560, 1920, 1440, 1366, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('sound', () => {
  test('starts only after the entry gesture, and the toggle turns it off', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('glass-thread')) requests.push(request.url());
    });

    await gotoExperience(page);
    // Nothing is fetched, and no context exists, until the visitor asks for it.
    expect(requests).toHaveLength(0);

    await page.getByRole('button', { name: 'ENTER WITH SOUND' }).click();
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-sound', 'on');

    const toggle = page.getByRole('button', { name: /Turn sound off/ });
    await toggle.click();
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-sound', 'off');
  });

  test('CONTINUE MUTED never touches the network', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('glass-thread')) requests.push(request.url());
    });
    await gotoExperience(page);
    await enterMuted(page);
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro');
    await page.waitForTimeout(1500);
    expect(requests, 'muted entry must not download the soundtrack').toHaveLength(0);
  });
});

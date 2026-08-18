import { expect, test } from '@playwright/test';
import { gotoExperience, scrollToChoice } from './helpers.ts';

async function focusedId(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? '');
}

test.describe('keyboard only', () => {
  test('the whole story is reachable without a pointer @smoke', async ({ page }) => {
    await gotoExperience(page);

    // The modal entry dialog takes focus and contains it: nothing behind it
    // is reachable with Tab. Focus opens on the panel rather than the first
    // button, so a visitor who arrived with a mouse is not shown a focus ring
    // before they have touched a key; Tab still walks both buttons.
    await expect(page.locator('#entry .entry__panel')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'ENTER WITH SOUND' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'CONTINUE MUTED' })).toBeFocused();
    // Tabbing past the last button hands focus back to browser chrome (so
    // activeElement becomes <body>); what must never happen is focus reaching
    // page UI behind the dialog.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const escapee = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) return null;
        return document.getElementById('entry')?.contains(active) === true
          ? null
          : active.id || active.tagName;
      });
      expect(escapee, 'focus reached page UI behind the modal entry dialog').toBeNull();
    }

    await page.getByRole('button', { name: 'CONTINUE MUTED' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro');

    // Paging down drives the film exactly like a wheel gesture.
    for (let i = 0; i < 14; i++) await page.keyboard.press('PageDown');
    await scrollToChoice(page);

    // Tab order at CHOICE: BLUE, RED, the wordmark, then sound. The objects
    // come first deliberately — the chrome sits after them in the DOM, so the
    // choice is reachable before anything that frames it.
    await page.evaluate(() => {
      document.body.focus();
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await focusedId(page)).toBe('hotspot-blue');
    await page.keyboard.press('Tab');
    expect(await focusedId(page)).toBe('hotspot-red');
    await page.keyboard.press('Tab');
    expect(await focusedId(page)).toBe('brand-home');
    await page.keyboard.press('Tab');
    expect(await focusedId(page)).toBe('sound-toggle');

    // A focused hotspot is visibly focused, not just technically focusable.
    await page.locator('#hotspot-blue').focus();
    const ringShadow = await page.evaluate(() => {
      const ring = document.querySelector('#hotspot-blue .hotspot__ring');
      return ring ? getComputedStyle(ring).boxShadow : '';
    });
    expect(ringShadow).not.toBe('none');

    // Enter chooses.
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-state', 'blue-playing', {
      timeout: 15_000,
    });

    // SKIP is reachable and operable.
    await expect(page.locator('#skip')).toHaveAttribute('data-visible', 'true', {
      timeout: 15_000,
    });
    await page.locator('#skip').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-state', 'blue-reveal', {
      timeout: 15_000,
    });

    // Focus lands on the heading that just appeared, not somewhere arbitrary.
    expect(await focusedId(page)).toBe('reveal-headline');

    // Space activates CHOOSE AGAIN.
    await page.getByRole('button', { name: 'CHOOSE AGAIN' }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 15_000 });
    expect(await focusedId(page)).toBe('hotspot-blue');
  });

  test('hotspots are not tab stops before the choice', async ({ page }) => {
    await gotoExperience(page);
    await page.getByRole('button', { name: 'CONTINUE MUTED' }).click();
    const tabIndexes = await page.evaluate(() =>
      ['hotspot-blue', 'hotspot-red'].map((id) => document.getElementById(id)?.tabIndex ?? null),
    );
    expect(tabIndexes).toEqual([-1, -1]);
  });

  test('the skip link is the first tab stop once the dialog has closed', async ({ page }) => {
    await gotoExperience(page);
    await page.getByRole('button', { name: 'CONTINUE MUTED' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'intro');
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the story' })).toBeFocused();
  });
});

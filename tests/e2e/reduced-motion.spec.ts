import { expect, test } from '@playwright/test';

/**
 * Reduced motion has to be a complete variant, not a fallback that quietly
 * drops the advertising: both objects, a real choice, the product copy and
 * the CTA all have to be reachable (plan section 14).
 */
test.describe('reduced motion', () => {
  test('reaches both objects, the product copy and the CTA without scrubbing @smoke', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

    await page.getByRole('button', { name: 'CONTINUE MUTED' }).click();

    // No scroll map at all — the choice frame arrives directly.
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 20_000 });
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight - globalThis.innerHeight,
    );
    expect(scrollable).toBeLessThanOrEqual(1);

    await expect(page.getByRole('heading', { name: 'CHOOSE YOUR REALITY.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /CONTROL/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /DESIRE/ })).toBeVisible();

    await page.locator('#hotspot-red').click();

    // Still and copy, no film forced on the visitor.
    await expect(page.locator('html')).toHaveAttribute('data-state', 'red-reveal', {
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'FEEL EVERYTHING.' })).toBeVisible();
    await expect(page.getByText('YOUR PRODUCT COULD BE NEXT.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'START A PROJECT' })).toBeVisible();

    // …but the film is available on request.
    const playFilm = page.getByRole('button', { name: /PLAY PRODUCT FILM/ });
    await expect(playFilm).toBeVisible();
    await playFilm.click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'red-playing', {
      timeout: 15_000,
    });
  });

  test('CHOOSE AGAIN still returns to the choice', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'CONTINUE MUTED' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 20_000 });
    await page.locator('#hotspot-blue').click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'blue-reveal', {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'CHOOSE AGAIN' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /DESIRE/ })).toBeEnabled();
  });

  test('the wordmark returns to the choice, which is where this variant starts', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'CONTINUE MUTED' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 20_000 });

    await page.locator('#hotspot-blue').click();
    await expect(page.locator('html')).toHaveAttribute('data-state', 'blue-reveal', {
      timeout: 20_000,
    });

    await page.getByRole('link', { name: /back to the beginning/i }).click();

    // There is no scrubbed intro to wind back to, so the way back ends at the
    // choice — and the objects have to be live again, not merely on screen.
    await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 15_000 });
    // Live means reachable, not merely visible: a pointer could still hit a
    // hotspot that had been dropped out of the tab order, so the tab order is
    // what this asserts.
    await expect(page.locator('#hotspot-blue')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#hotspot-red')).toHaveAttribute('tabindex', '0');
    await page.locator('#hotspot-blue').click();
    await expect(page.locator('html')).toHaveAttribute('data-branch', 'blue');
  });
});

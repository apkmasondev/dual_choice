import { expect, type Page } from '@playwright/test';

export type Branch = 'blue' | 'red';

/** Source-frame coordinates the hotspots are calibrated to (hotspot-config.ts). */
export const EXPECTED_SOURCE_POSITION: Record<Branch, { x: number; y: number }> = {
  blue: { x: 338.5 / 1280, y: 346.5 / 720 },
  red: { x: 923 / 1280, y: 352 / 720 },
};

export async function gotoExperience(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
}

/** Muted entry: headless browsers are not a fair test of the audio path. */
export async function enterMuted(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'CONTINUE MUTED' }).click();
}

export async function scrollToChoice(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect(page.locator('html')).toHaveAttribute('data-state', 'choice', { timeout: 20_000 });
}

export async function reachChoice(page: Page): Promise<void> {
  await gotoExperience(page);
  await enterMuted(page);
  await scrollToChoice(page);
}

export interface HotspotProbe {
  /** Where the button centre lands, back-projected through the video's own box. */
  readonly normalisedX: number;
  readonly normalisedY: number;
  /** Mean colour of the film under the button centre. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly luminance: number;
  readonly saturation: number;
  readonly buttonWidth: number;
  readonly buttonHeight: number;
}

/**
 * Reads the film's own pixels underneath a hotspot.
 *
 * This is the check that actually matters: it does not ask the projection
 * module where it thinks the crystal is, it measures the colour of the frame
 * where the button really sits. The studio backdrop is a neutral grey with a
 * mean saturation around 10, while the crystal reads B-R +34 and the sphere
 * R-B +79 — so a drifted hotspot cannot pass.
 */
export async function probeHotspot(page: Page, branch: Branch): Promise<HotspotProbe> {
  // A viewport change can leave the decoder a moment behind; the probe needs a
  // real frame, not a guess about timing.
  await page.waitForFunction(
    () =>
      (document.querySelector<HTMLVideoElement>('.film[data-active="true"]')?.readyState ?? 0) >= 2,
    null,
    { timeout: 15_000 },
  );

  return page.evaluate((id: string) => {
    const button = document.getElementById(`hotspot-${id}`);
    const video = document.querySelector<HTMLVideoElement>('.film[data-active="true"]');
    if (!button || !video) throw new Error('hotspot or active film missing');
    if (video.readyState < 2) throw new Error('film has no decoded frame');

    const buttonBox = button.getBoundingClientRect();
    const videoBox = video.getBoundingClientRect();
    const centreX = buttonBox.x + buttonBox.width / 2;
    const centreY = buttonBox.y + buttonBox.height / 2;
    const normalisedX = (centreX - videoBox.x) / videoBox.width;
    const normalisedY = (centreY - videoBox.y) / videoBox.height;

    const radius = 20;
    const canvas = document.createElement('canvas');
    canvas.width = radius * 2;
    canvas.height = radius * 2;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');
    context.drawImage(
      video,
      normalisedX * video.videoWidth - radius,
      normalisedY * video.videoHeight - radius,
      radius * 2,
      radius * 2,
      0,
      0,
      radius * 2,
      radius * 2,
    );

    const { data } = context.getImageData(0, 0, radius * 2, radius * 2);
    let red = 0;
    let green = 0;
    let blue = 0;
    let saturation = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      red += r;
      green += g;
      blue += b;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
    }

    return {
      normalisedX,
      normalisedY,
      red: red / pixels,
      green: green / pixels,
      blue: blue / pixels,
      luminance: (red + green + blue) / (pixels * 3),
      saturation: saturation / pixels,
      buttonWidth: buttonBox.width,
      buttonHeight: buttonBox.height,
    };
  }, branch);
}

/** Asserts a hotspot really sits on its object, by colour and by position. */
export async function expectHotspotOnObject(page: Page, branch: Branch): Promise<void> {
  const probe = await probeHotspot(page, branch);
  const expected = EXPECTED_SOURCE_POSITION[branch];

  expect(probe.normalisedX, `${branch} x drifted`).toBeCloseTo(expected.x, 2);
  expect(probe.normalisedY, `${branch} y drifted`).toBeCloseTo(expected.y, 2);

  if (branch === 'blue') {
    expect(probe.blue - probe.red, 'BLUE hotspot is not over the crystal').toBeGreaterThan(22);
  } else {
    expect(probe.red - probe.blue, 'RED hotspot is not over the sphere').toBeGreaterThan(30);
  }
  expect(probe.saturation, `${branch} hotspot sits on plain backdrop`).toBeGreaterThan(20);
}

export async function chooseBranch(page: Page, branch: Branch): Promise<void> {
  await page.locator(`#hotspot-${branch}`).click();
}

/** Skips to the end of the branch film instead of waiting out ten seconds. */
export async function skipToReveal(page: Page, branch: Branch): Promise<void> {
  const skip = page.locator('#skip');
  await expect(skip).toHaveAttribute('data-visible', 'true', { timeout: 15_000 });
  await skip.click();
  await expect(page.locator('html')).toHaveAttribute('data-state', `${branch}-reveal`, {
    timeout: 15_000,
  });
}

export async function collectConsoleErrors(page: Page): Promise<string[]> {
  const messages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') messages.push(message.text());
  });
  page.on('pageerror', (error) => messages.push(error.message));
  return Promise.resolve(messages);
}

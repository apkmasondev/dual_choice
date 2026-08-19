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
  /*
    Readiness and measurement happen in one evaluation, retried every frame
    until both hold at once.

    They used to be two steps — wait for `readyState >= 2`, then measure — and
    between the two the decoder can drop back below HAVE_CURRENT_DATA. Under
    four parallel video-heavy contexts that window opened roughly one run in
    ten, and the test failed with "film has no decoded frame": a real race in
    the probe, not in the page. A missing element is still thrown rather than
    retried, because no amount of waiting fixes it.
  */
  const handle = await page.waitForFunction(
    (id: string): HotspotProbe | null => {
      const button = document.getElementById(`hotspot-${id}`);
      const video = document.querySelector<HTMLVideoElement>('.film[data-active="true"]');
      if (!button || !video) throw new Error('hotspot or active film missing');
      if (video.readyState < 2) return null;

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
    },
    branch,
    { timeout: 15_000 },
  );

  // waitForFunction only resolves on a truthy value.
  return (await handle.jsonValue())!;
}

/** The geometry StageLayout publishes once it has measured the stage. */
const GEOMETRY_VARS = ['--media-x', '--media-y', '--media-w', '--media-h'];

async function stageGeometry(page: Page): Promise<string> {
  return page.evaluate((names: string[]) => {
    const stage = document.getElementById('stage');
    return names.map((name) => stage?.style.getPropertyValue(name) ?? '').join('|');
  }, GEOMETRY_VARS);
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}

/**
 * Waits for the film to stop moving at the reveal.
 *
 * Reaching `<branch>-reveal` only says the state changed. The fit is computed
 * a frame later and the frame then eases into place over 760 ms, so anything
 * measured on the state attribute alone is measuring mid-flight — which is a
 * difference of 151 px on a 375x667 screen, and looks exactly like the bug
 * this waits to let settle.
 */
export async function waitForRevealSettled(page: Page): Promise<void> {
  const read = async (): Promise<string> =>
    page.evaluate(() => {
      const film = document.querySelector<HTMLVideoElement>('.film[data-active="true"]');
      if (!film) return '';
      const rect = film.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height].map((n) => n.toFixed(1)).join('|');
    });

  await expect
    .poll(
      async () => {
        const first = await read();
        if (first === '') return false;
        await nextFrame(page);
        return (await read()) === first;
      },
      { message: 'the film never stopped moving at the reveal', timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Resizes the viewport and waits for the stage to finish reacting to it.
 *
 * Counting animation frames after a resize is a guess: the browser hands the
 * new size to the ResizeObserver when it is ready, StageLayout writes the
 * geometry in a frame of its own, and under load those two can land several
 * frames apart. This waits for the geometry itself — first to change, which
 * proves the resize was seen, then to hold still for a frame, which proves
 * the write is finished.
 *
 * It therefore expects the new size to produce a different projected rect.
 * Consecutive viewports in a test must differ; resizing to the size the page
 * already has is a no-op and returns immediately.
 */
export async function resizeStage(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  // The size the page itself reports, not the one Playwright was asked for:
  // it is what the ResizeObserver will see, and it is never null.
  const current = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const sameSize = current.width === viewport.width && current.height === viewport.height;
  const before = sameSize ? null : await stageGeometry(page);

  await page.setViewportSize(viewport);
  if (before === null) return;

  await expect
    .poll(
      async () => {
        const first = await stageGeometry(page);
        if (first === before) return false;
        await nextFrame(page);
        return (await stageGeometry(page)) === first;
      },
      {
        message: `stage geometry never settled at ${viewport.width}x${viewport.height}`,
        timeout: 10_000,
      },
    )
    .toBe(true);
}

/** Movement below this is the frame at rest, not the frame still arriving. */
const AT_REST = 5e-4;

/**
 * Probes a hotspot once the film has stopped moving.
 *
 * The film's box is animated whenever the reveal settles or unsettles — 760 ms
 * in the stylesheet — and CHOOSE AGAIN sends it straight back. A position
 * sampled mid-flight cannot be compared with a fixed expectation, and the
 * assertion below allows about four source pixels, so a frame caught halfway
 * home fails on a difference that is not drift at all. Two reads a frame
 * apart that agree mean the frame has arrived.
 */
async function probeSettledHotspot(page: Page, branch: Branch): Promise<HotspotProbe> {
  let probe = await probeHotspot(page, branch);

  await expect
    .poll(
      async () => {
        const previous = probe;
        await nextFrame(page);
        probe = await probeHotspot(page, branch);
        return (
          Math.abs(probe.normalisedX - previous.normalisedX) < AT_REST &&
          Math.abs(probe.normalisedY - previous.normalisedY) < AT_REST
        );
      },
      { message: `the ${branch} frame never came to rest`, timeout: 10_000 },
    )
    .toBe(true);

  return probe;
}

/** Asserts a hotspot really sits on its object, by colour and by position. */
export async function expectHotspotOnObject(page: Page, branch: Branch): Promise<void> {
  const probe = await probeSettledHotspot(page, branch);
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

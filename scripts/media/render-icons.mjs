/**
 * Rasterises public/favicon.svg into the PNG/ICO fallbacks.
 *
 * Chromium (already a dev dependency via Playwright) is used as the renderer so
 * the bitmaps are pixel-identical to what a browser paints from the SVG — no
 * second, hand-maintained copy of the artwork.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PUBLIC_DIR, formatBytes, isMain, relative } from './lib/media.mjs';

const PNG_TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, background: '#0E1114' },
  { file: 'icon-192.png', size: 192, background: 'transparent' },
  { file: 'icon-512.png', size: 512, background: 'transparent' },
];

/** Sizes packed into favicon.ico. PNG payloads are valid in ICO since Vista. */
const ICO_SIZES = [16, 32, 48];

async function renderSvg(page, svg, size, background) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;background:${background};}
       svg{display:block;width:${String(size)}px;height:${String(size)}px;}
     </style>${svg}`,
    { waitUntil: 'load' },
  );
  return page.screenshot({ omitBackground: background === 'transparent', type: 'png' });
}

/** Minimal ICO container around already-encoded PNG payloads. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

export async function renderIcons() {
  const svg = await readFile(path.join(PUBLIC_DIR, 'favicon.svg'), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    console.log('Rendering icons…');

    for (const target of PNG_TARGETS) {
      const png = await renderSvg(page, svg, target.size, target.background);
      const output = path.join(PUBLIC_DIR, target.file);
      await writeFile(output, png);
      console.log(
        `  ${target.file.padEnd(22)} ${relative(output).padEnd(30)} ${formatBytes(png.length).padStart(9)}`,
      );
    }

    const icoImages = [];
    for (const size of ICO_SIZES) {
      icoImages.push({ size, data: await renderSvg(page, svg, size, 'transparent') });
    }
    const ico = buildIco(icoImages);
    const icoPath = path.join(PUBLIC_DIR, 'favicon.ico');
    await writeFile(icoPath, ico);
    console.log(
      `  ${'favicon.ico'.padEnd(22)} ${relative(icoPath).padEnd(30)} ${formatBytes(ico.length).padStart(9)}` +
        `  (${ICO_SIZES.join(', ')} px)`,
    );
  } finally {
    await browser.close();
  }
}

if (isMain(import.meta.url)) await renderIcons();

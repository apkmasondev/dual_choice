/**
 * Composes the 1200x630 Open Graph card from the CHOICE poster.
 *
 * Deliberately only three elements: the frame, the APK mark and the headline.
 * Small type is unreadable in a social preview, so none is added.
 */
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  OG_OUT,
  POSTER_OUT,
  ensureDirs,
  ffmpeg,
  fileSize,
  formatBytes,
  isMain,
  relative,
} from './lib/media.mjs';

const WIDTH = 1200;
const HEIGHT = 630;
const OG_BUDGET = 300 * 1024;

export async function renderOg() {
  await ensureDirs(OG_OUT);
  const posterPath = path.join(POSTER_OUT, 'choice.jpg');
  const poster = await readFile(posterPath);
  const dataUri = `data:image/jpeg;base64,${poster.toString('base64')}`;

  const browser = await chromium.launch();
  const pngPath = path.join(OG_OUT, 'dual-choice-og.png');
  const jpgPath = path.join(OG_OUT, 'dual-choice-og.jpg');

  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{
          width:${String(WIDTH)}px;height:${String(HEIGHT)}px;position:relative;overflow:hidden;
          background:#b3b8be;
          font-family:ui-sans-serif,"Segoe UI",Inter,Helvetica,Arial,sans-serif;
          color:#0E1114;
        }
        img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 46%}
        .scrim{
          position:absolute;inset:0;
          background:linear-gradient(180deg,rgba(240,242,244,.34) 0%,rgba(240,242,244,0) 26%,
            rgba(232,235,238,0) 52%,rgba(226,229,233,.82) 84%,rgba(222,226,230,.96) 100%);
        }
        .mark{
          position:absolute;top:44px;left:56px;display:flex;align-items:center;gap:14px;
          font-size:26px;font-weight:600;letter-spacing:.34em;
        }
        .mark svg{display:block;width:36px;height:36px;border-radius:8px}
        h1{
          position:absolute;left:56px;bottom:56px;
          font-size:82px;line-height:.96;font-weight:600;letter-spacing:-.022em;
          max-width:900px;
        }
        .rule{
          position:absolute;left:56px;bottom:172px;width:132px;height:5px;border-radius:3px;
          background:linear-gradient(90deg,#63AEC4 0 50%,#C6414A 50% 100%);
        }
      </style>
      <img src="${dataUri}" alt="">
      <div class="scrim"></div>
      <div class="mark">
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" rx="14" fill="#0E1114"/>
          <path d="M19 45 32 14 45 45" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M23.5 37H40.5" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/>
          <rect x="19" y="51" width="12" height="4" rx="2" fill="#63AEC4"/>
          <rect x="33" y="51" width="12" height="4" rx="2" fill="#C6414A"/>
        </svg>
        <span>APK</span>
      </div>
      <div class="rule"></div>
      <h1>CHOOSE YOUR REALITY.</h1>`,
      { waitUntil: 'load' },
    );
    await page.screenshot({ path: pngPath, type: 'png' });
  } finally {
    await browser.close();
  }

  await ffmpeg(['-y', '-i', pngPath, '-q:v', '4', '-map_metadata', '-1', jpgPath]);
  await unlink(pngPath);

  const size = await fileSize(jpgPath);
  console.log(
    `  ${'open graph'.padEnd(22)} ${relative(jpgPath).padEnd(30)} ${formatBytes(size).padStart(9)}` +
      (size > OG_BUDGET ? `  !! over budget (${formatBytes(OG_BUDGET)})` : ''),
  );
  return { output: jpgPath, size };
}

if (isMain(import.meta.url)) await renderOg();

/**
 * Rebuilds every derived media asset from the masters in assets/.
 *
 *   npm run media
 *
 * Order matters: posters and the OG card are cut from the encoded videos, not
 * from the masters. Nothing here writes outside public/.
 */
import { hasBinary, isMain } from './lib/media.mjs';
import { encodeVideo } from './encode-video.mjs';
import { encodeAudio } from './encode-audio.mjs';
import { extractPosters } from './extract-posters.mjs';
import { renderIcons } from './render-icons.mjs';
import { renderOg } from './render-og.mjs';

export async function buildAll() {
  for (const binary of ['ffmpeg', 'ffprobe']) {
    if (!(await hasBinary(binary))) {
      console.error(`${binary} is required. Install FFmpeg and re-run \`npm run media\`.`);
      process.exitCode = 1;
      return;
    }
  }

  const started = Date.now();
  await encodeVideo('all');
  await encodeAudio();
  await extractPosters();
  await renderIcons();
  console.log('Rendering Open Graph card…');
  await renderOg();
  console.log(`\nMedia pipeline finished in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log('Run `npm run media:verify` to check the result against the quality gate.');
}

if (isMain(import.meta.url)) await buildAll();

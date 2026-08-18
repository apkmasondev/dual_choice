/**
 * Extracts the poster stills.
 *
 * Every poster is pulled from an *encoded* web variant rather than the master,
 * so the still the browser paints before the decoder is ready is exactly the
 * frame the decoder will produce. That is what removes the flash at the
 * poster -> video handover.
 */
import path from 'node:path';
import {
  POSTER_OUT,
  VIDEO_OUT,
  ensureDirs,
  ffmpeg,
  fileSize,
  formatBytes,
  isMain,
  relative,
} from './lib/media.mjs';
import { POSTERS, POSTER_FORMATS, VIDEO_PROFILES } from './profiles.mjs';

function sourceFileFor(profileId) {
  const profile = VIDEO_PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown video profile "${profileId}".`);
  return path.join(VIDEO_OUT, profile.out);
}

export async function extractPosters() {
  await ensureDirs(POSTER_OUT);
  console.log(`Extracting ${String(POSTERS.length)} posters…`);

  const results = [];
  for (const poster of POSTERS) {
    const input = sourceFileFor(poster.from);
    for (const format of POSTER_FORMATS) {
      const output = path.join(POSTER_OUT, `${poster.id}.${format.ext}`);
      await ffmpeg([
        '-y',
        '-i',
        input,
        '-vf',
        `select=eq(n\\,${String(poster.frame)})`,
        '-fps_mode',
        'passthrough',
        '-frames:v',
        '1',
        ...format.args,
        '-map_metadata',
        '-1',
        output,
      ]);
      const size = await fileSize(output);
      const overBudget = size > poster.budgetBytes;
      console.log(
        `  ${`${poster.id}.${format.ext}`.padEnd(20)} ${relative(output).padEnd(38)}` +
          ` ${formatBytes(size).padStart(9)}` +
          (overBudget ? `  !! over budget (${formatBytes(poster.budgetBytes)})` : ''),
      );
      results.push({ poster, format, output, size, overBudget });
    }
  }
  return results;
}

if (isMain(import.meta.url)) await extractPosters();

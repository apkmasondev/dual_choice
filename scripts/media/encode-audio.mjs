/**
 * Derives the two web soundtrack formats from the delivered master.
 *
 * The master itself never ships (plan section 13.1). Opus covers Chrome,
 * Firefox and Edge; AAC/M4A covers Safari. Both are 48 kHz stereo so the
 * Web Audio graph behaves identically whichever one the browser picks.
 *
 * `-vn` matters here: the master carries embedded cover art as an mjpeg
 * stream, which would otherwise be muxed into the .m4a.
 */
import path from 'node:path';
import {
  AUDIO_OUT,
  ensureDirs,
  ffmpeg,
  fileSize,
  formatBytes,
  isMain,
  relative,
  sourcePath,
} from './lib/media.mjs';
import { AUDIO_PROFILES } from './profiles.mjs';

export async function encodeAudio() {
  await ensureDirs(AUDIO_OUT);
  const input = await sourcePath('soundtrack');
  console.log(`Encoding ${String(AUDIO_PROFILES.length)} audio variants…`);

  const results = [];
  for (const profile of AUDIO_PROFILES) {
    const output = path.join(AUDIO_OUT, profile.out);
    const codecArgs =
      profile.codec === 'libopus'
        ? ['-c:a', 'libopus', '-b:a', profile.bitrate, '-vbr', 'on', '-application', 'audio']
        : ['-c:a', 'aac', '-b:a', profile.bitrate, '-movflags', '+faststart'];

    await ffmpeg([
      '-y',
      '-i',
      input,
      '-vn',
      '-map_metadata',
      '-1',
      '-ar',
      '48000',
      '-ac',
      '2',
      ...codecArgs,
      output,
    ]);

    const size = await fileSize(output);
    const overBudget = size > profile.budgetBytes;
    console.log(
      `  ${profile.id.padEnd(12)} ${relative(output).padEnd(44)} ${formatBytes(size).padStart(9)}` +
        (overBudget ? `  !! over budget (${formatBytes(profile.budgetBytes)})` : ''),
    );
    results.push({ profile, output, size, overBudget });
  }
  return results;
}

if (isMain(import.meta.url)) await encodeAudio();

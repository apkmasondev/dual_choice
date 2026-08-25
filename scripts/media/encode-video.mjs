/**
 * Encodes the web video ladder from the masters in assets/.
 *
 *   node scripts/media/encode-video.mjs            # everything
 *   node scripts/media/encode-video.mjs intro      # intro only
 *   node scripts/media/encode-video.mjs branches   # branches only
 *
 * The intro keeps a short GOP because scroll scrubbing seeks to arbitrary
 * frames and the keyint bounds what the decoder has to walk to reach one; the
 * branches keep a normal 2 s GOP because they only ever play forward. Both
 * numbers, and the measurements behind them, live in profiles.mjs.
 *
 * The intro also encodes without B-frames, because they reorder frames and the
 * scrub needs a seek to land where it was aimed. The branches keep theirs —
 * they are two thirds B-frames, and nothing ever seeks into them.
 *
 * Audio is stripped from every output.
 */
import path from 'node:path';
import {
  H264_COMMON,
  VIDEO_OUT,
  ensureDirs,
  ffmpeg,
  fileSize,
  formatBytes,
  isMain,
  relative,
  sourcePath,
} from './lib/media.mjs';
import { BRANCH_PROFILES, INTRO_PROFILES } from './profiles.mjs';

function x264Params(profile) {
  const keyint = String(profile.keyint);
  const parts = [`keyint=${keyint}`, `min-keyint=${keyint}`, 'scenecut=0'];
  // Omitted rather than set for the branches, so they keep the preset's own
  // B-frame decision and stay byte-identical to what already shipped.
  if (profile.bframes !== undefined) parts.push(`bframes=${String(profile.bframes)}`);
  return parts.join(':');
}

export async function encodeProfile(profile) {
  const input = await sourcePath(profile.source);
  const output = path.join(VIDEO_OUT, profile.out);
  const filters = [`scale=${String(profile.width)}:-2:flags=lanczos`];

  await ffmpeg([
    '-y',
    '-i',
    input,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    String(profile.crf),
    '-profile:v',
    'high',
    '-level:v',
    '4.0',
    '-x264-params',
    x264Params(profile),
    ...H264_COMMON,
    output,
  ]);

  const size = await fileSize(output);
  const overBudget = size > profile.budgetBytes;
  console.log(
    `  ${profile.id.padEnd(12)} ${relative(output).padEnd(40)} ${formatBytes(size).padStart(9)}` +
      `  GOP ${String(profile.keyint)}` +
      (overBudget ? `  !! over budget (${formatBytes(profile.budgetBytes)})` : ''),
  );
  return { profile, output, size, overBudget };
}

export async function encodeVideo(which = 'all') {
  await ensureDirs(VIDEO_OUT);
  const profiles = [
    ...(which === 'branches' ? [] : INTRO_PROFILES),
    ...(which === 'intro' ? [] : BRANCH_PROFILES),
  ];
  console.log(`Encoding ${String(profiles.length)} video variants…`);
  const results = [];
  for (const profile of profiles) results.push(await encodeProfile(profile));
  return results;
}

if (isMain(import.meta.url)) {
  await encodeVideo(process.argv[2] ?? 'all');
}

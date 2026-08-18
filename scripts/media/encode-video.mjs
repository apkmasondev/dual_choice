/**
 * Encodes the web video ladder from the masters in assets/.
 *
 *   node scripts/media/encode-video.mjs            # everything
 *   node scripts/media/encode-video.mjs intro      # intro only
 *   node scripts/media/encode-video.mjs branches   # branches only
 *
 * The intro is All-I (GOP=1) because scroll scrubbing seeks to arbitrary
 * frames; the branches keep a normal 2 s GOP because they only ever play
 * forward. Audio is stripped from every output.
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
import { BRANCH_KEYINT, BRANCH_PROFILES, INTRO_PROFILES } from './profiles.mjs';

function x264Params(profile) {
  return profile.allIntra
    ? 'keyint=1:min-keyint=1:scenecut=0:bframes=0'
    : `keyint=${String(BRANCH_KEYINT)}:min-keyint=${String(BRANCH_KEYINT)}:scenecut=0`;
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
    `  ${profile.id.padEnd(12)} ${relative(output).padEnd(44)} ${formatBytes(size).padStart(9)}` +
      `  ${profile.allIntra ? 'All-I' : `GOP ${String(BRANCH_KEYINT)}`}` +
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

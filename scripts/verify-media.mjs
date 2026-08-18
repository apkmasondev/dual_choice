/**
 * Quality gate for everything under public/media and public/posters.
 *
 *   npm run media:verify
 *
 * Fails the build when an encode has silently drifted: wrong dimensions or
 * frame rate, a stray audio track, an intro that is no longer All-I, a broken
 * faststart layout, a budget overrun, or a branch whose first frame no longer
 * matches the frame the intro ends on (plan sections 28 and 29).
 */
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AUDIO_OUT,
  POSTER_OUT,
  ROOT,
  VIDEO_OUT,
  ffmpeg,
  fileSize,
  formatBytes,
  frameTypes,
  hasBinary,
  isFaststart,
  isMain,
  probe,
  relative,
} from './media/lib/media.mjs';
import {
  AUDIO_PROFILES,
  BRANCH_KEYINT,
  CONTINUITY,
  POSTERS,
  POSTER_FORMATS,
  SOURCE,
  VIDEO_PROFILES,
} from './media/profiles.mjs';

const problems = [];
const warnings = [];
const report = {
  generatedAt: new Date().toISOString(),
  video: [],
  audio: [],
  posters: [],
  continuity: [],
};

const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function verifyVideo() {
  for (const profile of VIDEO_PROFILES) {
    const file = path.join(VIDEO_OUT, profile.out);
    if (!(await exists(file))) {
      fail(`${profile.out} is missing. Run \`npm run media\`.`);
      continue;
    }

    const data = await probe(file);
    const video = data.streams.find((stream) => stream.codec_type === 'video');
    const audio = data.streams.find((stream) => stream.codec_type === 'audio');
    const size = await fileSize(file);
    const expectedHeight = Math.round((profile.width * SOURCE.height) / SOURCE.width);

    if (!video) {
      fail(`${profile.out} has no video stream.`);
      continue;
    }
    if (audio) fail(`${profile.out} still carries an audio track (plan 7.3 requires -an).`);
    if (video.width !== profile.width || video.height !== expectedHeight) {
      fail(
        `${profile.out} is ${String(video.width)}x${String(video.height)}, expected ` +
          `${String(profile.width)}x${String(expectedHeight)}.`,
      );
    }
    if (video.r_frame_rate !== `${String(SOURCE.fps)}/1`) {
      fail(
        `${profile.out} runs at ${video.r_frame_rate ?? '?'} fps, expected ${String(SOURCE.fps)}/1.`,
      );
    }
    if (video.pix_fmt !== 'yuv420p')
      fail(`${profile.out} uses ${video.pix_fmt ?? '?'}, expected yuv420p.`);
    if (!(await isFaststart(file)))
      fail(`${profile.out} has its moov atom after mdat (faststart failed).`);

    const frames = await frameTypes(file);
    if (frames.total !== SOURCE.frames) {
      fail(`${profile.out} has ${String(frames.total)} frames, expected ${String(SOURCE.frames)}.`);
    }
    if (profile.allIntra && frames.intra !== frames.total) {
      fail(
        `${profile.out} is meant to be All-I but only ${String(frames.intra)}/${String(frames.total)} ` +
          'frames are intra-coded. Scroll scrubbing will stutter.',
      );
    }
    if (!profile.allIntra && frames.intra === frames.total) {
      warn(
        `${profile.out} is All-I although it is only ever played linearly — that wastes bandwidth ` +
          `(expected a keyframe roughly every ${String(BRANCH_KEYINT)} frames).`,
      );
    }
    if (size > profile.budgetBytes) {
      warn(
        `${profile.out} is ${formatBytes(size)}, over its ${formatBytes(profile.budgetBytes)} budget.`,
      );
    }

    report.video.push({
      id: profile.id,
      file: relative(file),
      bytes: size,
      width: video.width,
      height: video.height,
      allIntra: frames.intra === frames.total,
      intraFrames: frames.intra,
      totalFrames: frames.total,
      durationSeconds: Number(data.format.duration),
    });
  }
}

async function verifyAudio() {
  for (const profile of AUDIO_PROFILES) {
    const file = path.join(AUDIO_OUT, profile.out);
    if (!(await exists(file))) {
      fail(`${profile.out} is missing. Run \`npm run media\`.`);
      continue;
    }
    const data = await probe(file);
    const audio = data.streams.find((stream) => stream.codec_type === 'audio');
    const size = await fileSize(file);
    if (!audio) {
      fail(`${profile.out} has no audio stream.`);
      continue;
    }
    if (Number(audio.sample_rate) !== 48000) {
      fail(`${profile.out} is ${audio.sample_rate ?? '?'} Hz, expected 48000.`);
    }
    if (audio.channels !== 2)
      fail(`${profile.out} has ${String(audio.channels)} channels, expected 2.`);
    if (size > profile.budgetBytes) {
      warn(
        `${profile.out} is ${formatBytes(size)}, over its ${formatBytes(profile.budgetBytes)} budget.`,
      );
    }
    report.audio.push({
      id: profile.id,
      file: relative(file),
      bytes: size,
      codec: audio.codec_name,
      durationSeconds: Number(data.format.duration),
    });
  }

  // No uncompressed or master-format audio may reach the published tree.
  for (const stray of ['glass-thread.wav', 'glass-thread.mp3', 'glass-atelier.wav']) {
    if (await exists(path.join(AUDIO_OUT, stray))) {
      fail(`${stray} is an audio master and must not ship (plan 13.1).`);
    }
  }
}

async function verifyPosters() {
  for (const poster of POSTERS) {
    for (const format of POSTER_FORMATS) {
      const file = path.join(POSTER_OUT, `${poster.id}.${format.ext}`);
      if (!(await exists(file))) {
        fail(`poster ${poster.id}.${format.ext} is missing. Run \`npm run media\`.`);
        continue;
      }
      const size = await fileSize(file);
      const data = await probe(file);
      const image = data.streams.find((stream) => stream.codec_type === 'video');
      if (image && (image.width !== SOURCE.width || image.height !== SOURCE.height)) {
        fail(
          `poster ${poster.id}.${format.ext} is ${String(image.width)}x${String(image.height)}, ` +
            `expected ${String(SOURCE.width)}x${String(SOURCE.height)}.`,
        );
      }
      if (size > poster.budgetBytes) {
        warn(
          `poster ${poster.id}.${format.ext} is ${formatBytes(size)}, over its ` +
            `${formatBytes(poster.budgetBytes)} budget.`,
        );
      }
      report.posters.push({ id: `${poster.id}.${format.ext}`, file: relative(file), bytes: size });
    }
  }

  const og = path.join(ROOT, 'public', 'og', 'dual-choice-og.jpg');
  if (!(await exists(og))) fail('public/og/dual-choice-og.jpg is missing. Run `npm run media`.');

  for (const icon of [
    'favicon.svg',
    'favicon.ico',
    'apple-touch-icon.png',
    'icon-192.png',
    'icon-512.png',
  ]) {
    if (!(await exists(path.join(ROOT, 'public', icon)))) fail(`public/${icon} is missing.`);
  }
}

/**
 * Plan section 29: measures the branch first frame against the intro last
 * frame. A low score means the branch was generated from a different take —
 * something a crossfade must not be used to hide.
 */
async function verifyContinuity() {
  for (const pair of CONTINUITY.pairs) {
    const branchProfile = VIDEO_PROFILES.find((profile) => profile.id === pair.branch);
    const introProfile = VIDEO_PROFILES.find((profile) => profile.id === pair.intro);
    if (!branchProfile || !introProfile) continue;

    const branchFile = path.join(VIDEO_OUT, branchProfile.out);
    const introFile = path.join(VIDEO_OUT, introProfile.out);
    if (!(await exists(branchFile)) || !(await exists(introFile))) continue;

    const { stderr } = await ffmpeg(
      [
        '-loglevel',
        'info',
        '-i',
        branchFile,
        '-i',
        introFile,
        '-lavfi',
        `[0:v]select=eq(n\\,0),setpts=N/24/TB[b];` +
          `[1:v]select=eq(n\\,${String(SOURCE.frames - 1)}),setpts=N/24/TB[i];` +
          `[b][i]psnr`,
        '-f',
        'null',
        '-',
      ],
      { quiet: true },
    );

    const match = /average:([0-9.]+)/.exec(stderr);
    const psnr = match?.[1] ? Number(match[1]) : Number.NaN;
    const ok = Number.isFinite(psnr) && psnr >= CONTINUITY.minPsnrDb;
    if (!ok) {
      fail(
        `first-frame continuity ${pair.branch} -> ${pair.intro}: PSNR ` +
          `${Number.isFinite(psnr) ? psnr.toFixed(2) : '?'} dB, below the ` +
          `${String(CONTINUITY.minPsnrDb)} dB gate. The branch does not start on the CHOICE frame; ` +
          'fix the source, do not lengthen the crossfade.',
      );
    }
    report.continuity.push({ pair: `${pair.branch}->${pair.intro}`, psnrDb: psnr, pass: ok });
  }
}

export async function verifyMedia() {
  for (const binary of ['ffprobe', 'ffmpeg']) {
    if (!(await hasBinary(binary))) {
      console.error(`${binary} not found — cannot verify media. Install FFmpeg.`);
      process.exitCode = 1;
      return;
    }
  }

  await verifyVideo();
  await verifyAudio();
  await verifyPosters();
  await verifyContinuity();

  const totalBytes = [...report.video, ...report.audio, ...report.posters].reduce(
    (sum, entry) => sum + entry.bytes,
    0,
  );
  report.totalBytes = totalBytes;
  report.problems = problems;
  report.warnings = warnings;
  await writeFile(path.join(ROOT, 'media-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log('\nMedia verification');
  console.log('------------------');
  for (const entry of report.video) {
    console.log(
      `  video   ${entry.id.padEnd(12)} ${String(entry.width)}x${String(entry.height)}`.padEnd(34) +
        `${formatBytes(entry.bytes).padStart(9)}  ${entry.allIntra ? 'All-I' : 'GOP'}`,
    );
  }
  for (const entry of report.audio) {
    console.log(
      `  audio   ${entry.id.padEnd(12)} ${String(entry.codec)}`.padEnd(34) +
        formatBytes(entry.bytes).padStart(9),
    );
  }
  for (const entry of report.continuity) {
    console.log(
      `  cont.   ${entry.pair.padEnd(26)} ${entry.psnrDb.toFixed(2)} dB  ${entry.pass ? 'ok' : 'FAIL'}`,
    );
  }
  console.log(`  total shipped media: ${formatBytes(totalBytes)}`);

  for (const message of warnings) console.warn(`  warn: ${message}`);
  for (const message of problems) console.error(`  FAIL: ${message}`);

  if (problems.length > 0) {
    console.error(`\n${String(problems.length)} problem(s) found.`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nAll checks passed${warnings.length > 0 ? ` (${String(warnings.length)} warning(s))` : ''}.`,
    );
  }
}

if (isMain(import.meta.url)) await verifyMedia();

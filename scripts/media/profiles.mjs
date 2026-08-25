/**
 * Single source of truth for the encode ladder.
 *
 * Both the encoders and `scripts/verify-media.mjs` read this file, so the
 * quality gate can never drift away from what was actually produced.
 *
 * CRF was picked first, from a measured VMAF ladder against the masters
 * (10 s, 1280x720, 24 fps, 240 frames). The intro was still All-I at the time,
 * so the sizes in this first table are the ones keyint later halved:
 *
 *   intro 1280 All-I  crf 20 -> 5.6 MB / VMAF 96.4
 *                     crf 21 -> 4.9 MB / VMAF 95.9   <- chosen
 *                     crf 22 -> 4.3 MB / VMAF 95.4
 *                     crf 24 -> 3.4 MB / VMAF 94.1
 *   intro  960 All-I  crf 22 -> 2.4 MB / VMAF 93.1   <- chosen (mobile)
 *
 * The intro keyint was then measured the same way, at the CRF already chosen.
 * Halving the file costs 0.2 VMAF, which is an order of magnitude below the
 * threshold where anyone sees a difference:
 *
 *   intro 1280 crf 21   keyint 1 -> 4.86 MB / VMAF 95.96
 *                       keyint 2 -> 3.51 MB / VMAF 95.98
 *                       keyint 4 -> 2.49 MB / VMAF 95.76   <- chosen
 *                       keyint 8 -> 2.03 MB / VMAF 95.75
 *                       keyint 48 -> 1.61 MB / VMAF 95.62
 */

export const SOURCE = {
  width: 1280,
  height: 720,
  fps: 24,
  frames: 240,
  durationSeconds: 10.005,
};

/**
 * Intro is scroll-scrubbed, so what matters is the cost of an arbitrary seek:
 * the decoder has to walk from the previous keyframe to the frame asked for.
 * That cost is bounded by the keyint, not by the keyint being 1.
 *
 * Measured in a browser on the real encodes, fully buffered, timing
 * `currentTime` to `seeked` across 220 frame-quantised seeks per direction —
 * backward, which is the worst case, since scrolling up can never reuse the
 * decoder's forward progress:
 *
 *   keyint  1   p50 4.3 ms   p95 5.3 ms
 *   keyint  4   p50 4.6 ms   p95 6.5 ms   <- chosen
 *   keyint  8   p50 5.4 ms   p95 8.7 ms
 *   keyint 48   p50 16.7 ms  p95 32.5 ms
 *
 * The scrub asks for at most one seek per frame, so the budget is 41.7 ms.
 * keyint 4 spends 16% of it and keeps a 6x margin for slower machines, which
 * is what buys the halved file; keyint 48 spends 78% and would stutter.
 */
export const INTRO_KEYINT = 4;

export const INTRO_PROFILES = [
  {
    id: 'intro-1280',
    source: 'intro',
    out: 'intro-choice-1280.mp4',
    width: 1280,
    crf: 21,
    keyint: INTRO_KEYINT,
    bframes: 0,
    budgetBytes: 3 * 1024 * 1024,
  },
  {
    id: 'intro-960',
    source: 'intro',
    out: 'intro-choice-960.mp4',
    width: 960,
    crf: 22,
    keyint: INTRO_KEYINT,
    bframes: 0,
    budgetBytes: 1.75 * 1024 * 1024,
  },
];

/** Keyframe every 2 s for linear playback: fast enough for a seekable scrub bar. */
export const BRANCH_KEYINT = 48;

/**
 * Branches play back linearly and are never scrubbed, so a normal GOP is both
 * smaller and cheaper to decode. Section 7.2 of the plan.
 */
export const BRANCH_PROFILES = [
  {
    id: 'red-1280',
    source: 'red',
    out: 'red-desire-1280.mp4',
    width: 1280,
    crf: 21,
    keyint: BRANCH_KEYINT,
    budgetBytes: 4 * 1024 * 1024,
  },
  {
    id: 'red-960',
    source: 'red',
    out: 'red-desire-960.mp4',
    width: 960,
    crf: 23,
    keyint: BRANCH_KEYINT,
    budgetBytes: 2.5 * 1024 * 1024,
  },
  {
    id: 'blue-1280',
    source: 'blue',
    out: 'blue-control-1280.mp4',
    width: 1280,
    crf: 21,
    keyint: BRANCH_KEYINT,
    budgetBytes: 4 * 1024 * 1024,
  },
  {
    id: 'blue-960',
    source: 'blue',
    out: 'blue-control-960.mp4',
    width: 960,
    crf: 23,
    keyint: BRANCH_KEYINT,
    budgetBytes: 2.5 * 1024 * 1024,
  },
];

export const VIDEO_PROFILES = [...INTRO_PROFILES, ...BRANCH_PROFILES];

export const AUDIO_PROFILES = [
  {
    id: 'opus',
    out: 'glass-thread.opus',
    codec: 'libopus',
    bitrate: '96k',
    budgetBytes: 3.5 * 1024 * 1024,
    mime: 'audio/ogg; codecs=opus',
  },
  {
    id: 'aac',
    out: 'glass-thread.m4a',
    codec: 'aac',
    bitrate: '128k',
    budgetBytes: 4.5 * 1024 * 1024,
    mime: 'audio/mp4; codecs="mp4a.40.2"',
  },
];

/**
 * Stills pulled from the *encoded* videos (never from the masters), so a poster
 * is pixel-for-pixel the frame the decoder will show.
 */
export const POSTERS = [
  { id: 'intro-open', from: 'intro-1280', frame: 0, budgetBytes: 220 * 1024 },
  { id: 'choice', from: 'intro-1280', frame: 239, budgetBytes: 220 * 1024 },
  { id: 'red-final', from: 'red-1280', frame: 239, budgetBytes: 220 * 1024 },
  { id: 'blue-final', from: 'blue-1280', frame: 239, budgetBytes: 220 * 1024 },
];

export const POSTER_FORMATS = [
  {
    ext: 'avif',
    args: ['-c:v', 'libaom-av1', '-crf', '32', '-cpu-used', '4', '-still-picture', '1'],
  },
  { ext: 'webp', args: ['-c:v', 'libwebp', '-quality', '76', '-preset', 'picture'] },
  { ext: 'jpg', args: ['-c:v', 'mjpeg', '-q:v', '4'] },
];

/**
 * Continuity gate (plan section 29): a branch must start on the frame the
 * intro ends on. Measured on the delivered masters: PSNR 33.8 dB, so the
 * threshold sits just below with room for encoder drift.
 */
export const CONTINUITY = {
  minPsnrDb: 31,
  pairs: [
    { branch: 'red-1280', intro: 'intro-1280' },
    { branch: 'blue-1280', intro: 'intro-1280' },
  ],
};

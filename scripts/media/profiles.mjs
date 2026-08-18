/**
 * Single source of truth for the encode ladder.
 *
 * Both the encoders and `scripts/verify-media.mjs` read this file, so the
 * quality gate can never drift away from what was actually produced.
 *
 * CRF values were picked from a measured VMAF ladder against the masters
 * (10 s, 1280x720, 24 fps, 240 frames):
 *
 *   intro 1280 All-I  crf 20 -> 5.6 MB / VMAF 96.4
 *                     crf 21 -> 4.9 MB / VMAF 95.9   <- chosen
 *                     crf 22 -> 4.3 MB / VMAF 95.4
 *                     crf 24 -> 3.4 MB / VMAF 94.1
 *   intro  960 All-I  crf 22 -> 2.4 MB / VMAF 93.1   <- chosen (mobile)
 */

export const SOURCE = {
  width: 1280,
  height: 720,
  fps: 24,
  frames: 240,
  durationSeconds: 10.005,
};

/** Intro is scroll-scrubbed, so every frame must be independently decodable. */
export const INTRO_PROFILES = [
  {
    id: 'intro-1280',
    source: 'intro',
    out: 'intro-choice-1280-alli.mp4',
    width: 1280,
    crf: 21,
    allIntra: true,
    budgetBytes: 6 * 1024 * 1024,
  },
  {
    id: 'intro-960',
    source: 'intro',
    out: 'intro-choice-960-alli.mp4',
    width: 960,
    crf: 22,
    allIntra: true,
    budgetBytes: 3.5 * 1024 * 1024,
  },
];

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
    allIntra: false,
    budgetBytes: 4 * 1024 * 1024,
  },
  {
    id: 'red-960',
    source: 'red',
    out: 'red-desire-960.mp4',
    width: 960,
    crf: 23,
    allIntra: false,
    budgetBytes: 2.5 * 1024 * 1024,
  },
  {
    id: 'blue-1280',
    source: 'blue',
    out: 'blue-control-1280.mp4',
    width: 1280,
    crf: 21,
    allIntra: false,
    budgetBytes: 4 * 1024 * 1024,
  },
  {
    id: 'blue-960',
    source: 'blue',
    out: 'blue-control-960.mp4',
    width: 960,
    crf: 23,
    allIntra: false,
    budgetBytes: 2.5 * 1024 * 1024,
  },
];

export const VIDEO_PROFILES = [...INTRO_PROFILES, ...BRANCH_PROFILES];

/** Keyframe every 2 s for linear playback: fast enough for a seekable scrub bar. */
export const BRANCH_KEYINT = 48;

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

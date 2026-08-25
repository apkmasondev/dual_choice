/**
 * Shared helpers for the media pipeline.
 *
 * Every encode in scripts/media/ is reproducible: it reads only from `assets/`
 * (the untouched masters) and writes only into `public/`. No script ever
 * modifies a master.
 */
import { spawn } from 'node:child_process';
import { readdir, mkdir, open, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** True when the given module was started directly (`node thisFile.mjs`). */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  return !!entry && importMetaUrl === pathToFileURL(entry).href;
}

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const ASSETS_DIR = path.join(ROOT, 'assets');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const VIDEO_OUT = path.join(PUBLIC_DIR, 'media', 'video');
export const AUDIO_OUT = path.join(PUBLIC_DIR, 'media', 'audio');
export const POSTER_OUT = path.join(PUBLIC_DIR, 'posters');
export const OG_OUT = path.join(PUBLIC_DIR, 'og');

/**
 * Logical asset ids mapped to a case-insensitive filename fragment.
 * Names are resolved against the real directory listing so the pipeline is not
 * broken by the unicode ellipsis / timestamps in the delivered filenames.
 */
export const SOURCE_PATTERNS = {
  intro: 'person_kneeling',
  red: 'character_throwing_red',
  blue: 'character_throws_crystal',
  soundtrack: 'glass thread',
  referenceFrame: 'zapisana_klatka',
};

/** @type {Map<string, string>} */
let sourceCache;

export async function resolveSources() {
  if (sourceCache) return sourceCache;
  const entries = await readdir(ASSETS_DIR);
  const resolved = new Map();
  for (const [id, fragment] of Object.entries(SOURCE_PATTERNS)) {
    const match = entries.find((name) => name.toLowerCase().includes(fragment));
    if (!match) {
      throw new Error(
        `Missing source asset for "${id}" (looked for a filename containing "${fragment}" in assets/).`,
      );
    }
    resolved.set(id, path.join(ASSETS_DIR, match));
  }
  sourceCache = resolved;
  return resolved;
}

export async function sourcePath(id) {
  const sources = await resolveSources();
  const found = sources.get(id);
  if (!found) throw new Error(`Unknown source id "${id}".`);
  return found;
}

export function run(command, args, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

export const ffmpeg = (args, opts) =>
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], opts);
export const ffprobe = (args) => run('ffprobe', ['-hide_banner', '-v', 'error', ...args]);

export async function hasBinary(name) {
  try {
    await run(name, ['-version']);
    return true;
  } catch {
    return false;
  }
}

export async function probe(file) {
  const { stdout } = await ffprobe(['-show_format', '-show_streams', '-of', 'json', file]);
  return JSON.parse(stdout);
}

/**
 * Frame-type census of the first video stream.
 *
 * `maxGap` is the largest run of frames between one keyframe and the next —
 * the real number the scrub pays for, since it bounds how far the decoder has
 * to walk to reach an arbitrary frame. An All-I file has a `maxGap` of 1.
 */
export async function frameTypes(file) {
  const { stdout } = await ffprobe([
    '-select_streams',
    'v:0',
    '-show_entries',
    'frame=pict_type',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const types = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let maxGap = 0;
  let gap = 0;
  for (const type of types) {
    if (type === 'I') {
      maxGap = Math.max(maxGap, gap);
      gap = 1;
    } else {
      gap++;
    }
  }
  maxGap = Math.max(maxGap, gap);

  return {
    total: types.length,
    intra: types.filter((t) => t === 'I').length,
    bidirectional: types.filter((t) => t === 'B').length,
    maxGap,
  };
}

/**
 * True when the `moov` atom sits before `mdat` (i.e. `-movflags +faststart`
 * actually took effect), so the browser can start playing before the whole
 * file has arrived. ffprobe does not expose atom order, so walk the top-level
 * ISO-BMFF box list directly.
 */
export async function isFaststart(file) {
  const handle = await open(file, 'r');
  try {
    let offset = 0;
    const header = Buffer.alloc(16);
    for (let box = 0; box < 32; box++) {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) return false;
      let size = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (size === 1) size = Number(header.readBigUInt64BE(8));
      if (size === 0) return false;
      offset += size;
    }
    return false;
  } finally {
    await handle.close();
  }
}

export async function ensureDirs(...dirs) {
  for (const dir of dirs) await mkdir(dir, { recursive: true });
}

export async function fileSize(file) {
  const info = await stat(file);
  return info.size;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** Shared H.264 flags: web-safe pixel format, explicit BT.709 tagging, faststart. */
export const H264_COMMON = [
  '-pix_fmt',
  'yuv420p',
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
  '-movflags',
  '+faststart',
  '-map_metadata',
  '-1',
  // Deterministic output: no encoder SEI / muxer version strings, so
  // re-running the pipeline produces byte-identical files.
  '-flags',
  '+bitexact',
  '-fflags',
  '+bitexact',
  // Section 7.3: the web build never carries a soundtrack of its own.
  '-an',
];

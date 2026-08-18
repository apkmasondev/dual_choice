import type { BranchId } from '../choice/hotspot-config.ts';

/**
 * Where the encoded media lives and what shape it has.
 *
 * These numbers are asserted by `scripts/verify-media.mjs` against the real
 * files, so the runtime can trust them without probing at load time.
 */

export const INTRO_FPS = 24;
export const INTRO_FRAME_COUNT = 240;
export const INTRO_FRAME_DURATION = 1 / INTRO_FPS;
/** Container duration; the exact value is confirmed from metadata at runtime. */
export const INTRO_DURATION_HINT = 10.005;

export type VariantId = 'wide' | 'narrow';

interface VideoVariant {
  readonly wide: string;
  readonly narrow: string;
}

const VIDEO: Record<'intro' | BranchId, VideoVariant> = {
  intro: {
    wide: 'media/video/intro-choice-1280-alli.mp4',
    narrow: 'media/video/intro-choice-960-alli.mp4',
  },
  blue: {
    wide: 'media/video/blue-control-1280.mp4',
    narrow: 'media/video/blue-control-960.mp4',
  },
  red: {
    wide: 'media/video/red-desire-1280.mp4',
    narrow: 'media/video/red-desire-960.mp4',
  },
};

export type PosterId = 'intro-open' | 'choice' | 'red-final' | 'blue-final';

export const BRANCH_POSTER: Record<BranchId, PosterId> = {
  blue: 'blue-final',
  red: 'red-final',
};

/** Prefixes a public/ path with Vite's deployment base. */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\//, '')}`;
}

export function videoSource(id: 'intro' | BranchId, variant: VariantId): string {
  return asset(VIDEO[id][variant]);
}

export function posterSource(id: PosterId, ext: 'avif' | 'webp' | 'jpg'): string {
  return asset(`posters/${id}.${ext}`);
}

export const AUDIO_SOURCES = [
  { src: 'media/audio/glass-thread.opus', type: 'audio/ogg; codecs=opus' },
  { src: 'media/audio/glass-thread.m4a', type: 'audio/mp4; codecs="mp4a.40.2"' },
] as const;

/**
 * Picks the encode ladder rung.
 *
 * Phone-class viewports get the 960-wide encode: on a 390 CSS px screen the
 * frame renders about 618 px wide, so the extra 2.4 MB buys nothing a visitor
 * can see, and Save-Data always wins.
 */
export function pickVariant(
  viewport: { width: number; height: number },
  saveData: boolean,
): VariantId {
  if (saveData) return 'narrow';
  return Math.min(viewport.width, viewport.height) >= 700 ? 'wide' : 'narrow';
}

/**
 * Scroll map length as a multiple of the viewport height.
 *
 * Shorter on phones: a long scroll map is tiring on a small screen and
 * multiplies the number of seeks (plan section 6.1).
 */
export const SCROLL_LENGTH_VH = { desktop: 340, mobile: 280 } as const;

/** Progress at which the branches are promoted from `metadata` to full preload. */
export const BRANCH_PRELOAD_PROGRESS = 0.55;

import { isSameFrame } from './scrubMath.ts';
import type { Disposables } from '../utils/disposables.ts';

export type ReadyLevel = 'metadata' | 'data' | 'canplay' | 'canplaythrough';

const READY_STATE: Record<ReadyLevel, number> = {
  metadata: HTMLMediaElement.HAVE_METADATA,
  data: HTMLMediaElement.HAVE_CURRENT_DATA,
  canplay: HTMLMediaElement.HAVE_FUTURE_DATA,
  canplaythrough: HTMLMediaElement.HAVE_ENOUGH_DATA,
};

const READY_EVENT: Record<ReadyLevel, keyof HTMLMediaElementEventMap> = {
  metadata: 'loadedmetadata',
  data: 'loadeddata',
  canplay: 'canplay',
  canplaythrough: 'canplaythrough',
};

export interface VideoControllerOptions {
  readonly frameDuration: number;
  readonly disposables: Disposables;
  readonly onError?: (error: MediaError | null) => void;
}

/**
 * Thin, event-driven wrapper around one <video>.
 *
 * Readiness is always awaited through real media events (`loadedmetadata`,
 * `loadeddata`, `canplay`, `seeked`, `ended`) — never a hopeful `setTimeout`.
 */
export class VideoController {
  readonly #video: HTMLVideoElement;
  readonly #frameDuration: number;
  readonly #disposables: Disposables;
  readonly #endHandlers = new Set<() => void>();
  #failed = false;
  #lastSeekTarget = Number.NaN;
  #endFired = false;

  constructor(video: HTMLVideoElement, options: VideoControllerOptions) {
    this.#video = video;
    this.#frameDuration = options.frameDuration;
    this.#disposables = options.disposables;

    options.disposables.listen(video, 'error', () => {
      this.#failed = true;
      options.onError?.(video.error);
    });

    // `ended` is the primary signal; the `timeupdate` guard covers browsers
    // that occasionally stall a frame short of the duration instead of firing
    // it. Neither is a timeout — both are media-derived.
    options.disposables.listen(video, 'ended', () => {
      this.#fireEnded();
    });
    options.disposables.listen(video, 'timeupdate', () => {
      const { duration } = video;
      if (!Number.isFinite(duration) || duration === 0) return;
      if (duration - video.currentTime <= this.#frameDuration * 1.5) this.#fireEnded();
    });
  }

  #fireEnded(): void {
    if (this.#endFired) return;
    this.#endFired = true;
    for (const handler of this.#endHandlers) handler();
  }

  get element(): HTMLVideoElement {
    return this.#video;
  }

  get failed(): boolean {
    return this.#failed;
  }

  get duration(): number {
    const value = this.#video.duration;
    return Number.isFinite(value) ? value : 0;
  }

  get currentTime(): number {
    return this.#video.currentTime;
  }

  get readyState(): number {
    return this.#video.readyState;
  }

  setSource(src: string, preload: 'none' | 'metadata' | 'auto'): void {
    this.#failed = false;
    this.#video.preload = preload;
    if (this.#video.getAttribute('src') !== src) {
      this.#video.src = src;
    }
  }

  setPreload(preload: 'none' | 'metadata' | 'auto'): void {
    if (this.#video.preload === preload) return;
    this.#video.preload = preload;
    // `load()` would restart the fetch from scratch and drop buffered data;
    // simply raising the hint is enough for the browser to fetch more.
    if (preload === 'auto' && this.#video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      this.#video.load();
    }
  }

  isReady(level: ReadyLevel): boolean {
    return this.#video.readyState >= READY_STATE[level];
  }

  /** Resolves true when the level is reached, false if the element errored. */
  whenReady(level: ReadyLevel): Promise<boolean> {
    if (this.isReady(level)) return Promise.resolve(true);
    if (this.#failed || this.#disposables.signal.aborted) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, this.#disposables.signal]);
      const settle = (value: boolean): void => {
        controller.abort();
        resolve(value);
      };
      this.#video.addEventListener(
        READY_EVENT[level],
        () => {
          settle(true);
        },
        { signal },
      );
      this.#video.addEventListener(
        'error',
        () => {
          settle(false);
        },
        { signal },
      );
      this.#disposables.signal.addEventListener(
        'abort',
        () => {
          resolve(false);
        },
        { once: true },
      );
    });
  }

  /**
   * Seeks, skipping the request entirely when the target lands on the frame
   * that is already on screen — a 24 fps film does not need 120 seeks a second.
   */
  seekTo(time: number): boolean {
    const clamped = Math.max(0, time);
    if (
      !Number.isNaN(this.#lastSeekTarget) &&
      isSameFrame(clamped, this.#lastSeekTarget, this.#frameDuration)
    ) {
      return false;
    }
    if (this.#video.readyState < HTMLMediaElement.HAVE_METADATA) return false;
    this.#lastSeekTarget = clamped;
    this.#video.currentTime = clamped;
    return true;
  }

  /** Seeks and resolves once the decoder has actually shown that frame. */
  seekAndSettle(time: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.#video.readyState < HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, this.#disposables.signal]);
      const done = (): void => {
        controller.abort();
        resolve();
      };
      this.#video.addEventListener('seeked', done, { signal });
      this.#video.addEventListener('error', done, { signal });
      this.#lastSeekTarget = time;
      this.#video.currentTime = Math.max(0, time);
      if (!this.#video.seeking) done();
    });
  }

  async play(): Promise<boolean> {
    try {
      await this.#video.play();
      return true;
    } catch {
      // Autoplay refusals and interrupted plays are expected; the caller
      // decides what to do rather than the page throwing at the visitor.
      return false;
    }
  }

  pause(): void {
    this.#video.pause();
  }

  /** Rewinds and re-arms the end guard, so CHOOSE AGAIN can replay a branch. */
  reset(): void {
    this.#lastSeekTarget = Number.NaN;
    this.#endFired = false;
    this.#video.pause();
    if (this.#video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.#video.currentTime = 0;
    }
  }

  setActive(active: boolean): void {
    this.#video.dataset['active'] = active ? 'true' : 'false';
  }

  /** Fires once per playback when the film reaches its end. */
  onEnded(handler: () => void): void {
    this.#endHandlers.add(handler);
  }

  /** Diagnostics only — never used to drive logic. */
  playbackQuality(): { dropped: number; total: number } | null {
    const video = this.#video as HTMLVideoElement & {
      getVideoPlaybackQuality?: () => VideoPlaybackQuality;
    };
    if (typeof video.getVideoPlaybackQuality !== 'function') return null;
    const quality = video.getVideoPlaybackQuality();
    return { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
  }
}

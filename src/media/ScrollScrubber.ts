import {
  DEFAULT_SCRUB_TUNING,
  hasLeftChoice,
  hasReachedChoice,
  safeEndTime,
  scrollProgress,
  scrubStep,
  type ScrubTuning,
} from './scrubMath.ts';
import type { VideoController } from './VideoController.ts';
import type { Disposables } from '../utils/disposables.ts';

export interface ScrubberCallbacks {
  readonly onProgress: (progress: number) => void;
  readonly onReachChoice: () => void;
  readonly onLeaveChoice: () => void;
}

/**
 * Drives the intro from the scroll position.
 *
 * The scroll listener does nothing but record `scrollY` — no measuring, no
 * seeking, no style writes. Everything else happens once per animation frame,
 * which is what keeps the interaction off the main-thread critical path
 * (plan section 19.2).
 */
export class ScrollScrubber {
  readonly #video: VideoController;
  readonly #callbacks: ScrubberCallbacks;
  readonly #tuning: ScrubTuning;

  #scrollY = 0;
  #progress = 0;
  #smoothedTime = 0;
  #active = false;
  #atChoice = false;
  #scrubDuration = 0;
  #endTime = 0;
  #lastRange = 0;

  constructor(
    video: VideoController,
    callbacks: ScrubberCallbacks,
    disposables: Disposables,
    tuning: ScrubTuning = DEFAULT_SCRUB_TUNING,
  ) {
    this.#video = video;
    this.#callbacks = callbacks;
    this.#tuning = tuning;

    disposables.listen(
      globalThis.window,
      'scroll',
      () => {
        this.#scrollY = globalThis.scrollY;
      },
      { passive: true },
    );
    this.#scrollY = globalThis.scrollY;
  }

  get progress(): number {
    return this.#progress;
  }

  get smoothedTime(): number {
    return this.#smoothedTime;
  }

  get targetTime(): number {
    return this.#progress * this.#scrubDuration;
  }

  get endTime(): number {
    return this.#endTime;
  }

  /** Called once the intro's metadata is known, so the map uses the real duration. */
  setDuration(duration: number): void {
    this.#endTime = safeEndTime(duration, this.#tuning.frameDuration);
    this.#scrubDuration = this.#endTime;
  }

  start(): void {
    this.#active = true;
    this.#scrollY = globalThis.scrollY;
  }

  stop(): void {
    this.#active = false;
  }

  /** Snaps the playhead to the end and marks CHOICE as reached without a scroll. */
  jumpToEnd(): void {
    this.#progress = 1;
    this.#smoothedTime = this.#endTime;
    this.#atChoice = true;
  }

  /** Puts the document, and with it the playhead, back at the first frame. */
  scrollToStart(): void {
    globalThis.scrollTo({ top: 0, behavior: 'instant' });
    this.#scrollY = 0;
    this.#progress = 0;
    this.#smoothedTime = 0;
    this.#atChoice = false;
  }

  /** Puts the document back at the scroll position that corresponds to CHOICE. */
  scrollToChoiceAnchor(): void {
    const range = this.#scrollRange();
    globalThis.scrollTo({ top: range, behavior: 'instant' });
    this.#scrollY = range;
    this.#lastRange = range;
    this.jumpToEnd();
  }

  #scrollRange(): number {
    return Math.max(0, document.documentElement.scrollHeight - globalThis.innerHeight);
  }

  /**
   * Keeps the film where it was when the scrollable range changes.
   *
   * A window resize — or mobile browser chrome sliding away — changes
   * `scrollHeight - innerHeight` without the visitor scrolling at all. Left
   * alone, that silently re-reads the same scroll position as a different
   * progress and scrubs the film off the frame it was holding, which at CHOICE
   * would drag the objects out from under the hotspots. Re-anchoring
   * `scrollY` to the progress we already had makes the resize invisible.
   */
  #reanchor(range: number): void {
    if (this.#lastRange === 0 || Math.abs(range - this.#lastRange) <= 1) {
      this.#lastRange = range;
      return;
    }
    this.#lastRange = range;
    const target = this.#progress * range;
    if (Math.abs(target - globalThis.scrollY) < 1) return;
    globalThis.scrollTo({ top: target, behavior: 'instant' });
    this.#scrollY = target;
  }

  /** One step of the loop. `dt` is in seconds. */
  update(dt: number): void {
    if (!this.#active || this.#scrubDuration <= 0) return;

    const range = this.#scrollRange();
    this.#reanchor(range);

    const progress = scrollProgress(this.#scrollY, 0, range);
    if (progress !== this.#progress) {
      this.#progress = progress;
      this.#callbacks.onProgress(progress);
    }

    this.#smoothedTime = scrubStep(
      this.#smoothedTime,
      progress * this.#scrubDuration,
      dt,
      this.#tuning,
    );
    this.#video.seekTo(this.#smoothedTime);

    if (
      !this.#atChoice &&
      hasReachedChoice(progress, this.#smoothedTime, this.#endTime, this.#tuning.frameDuration)
    ) {
      this.#atChoice = true;
      this.#callbacks.onReachChoice();
      return;
    }

    if (this.#atChoice && hasLeftChoice(progress)) {
      this.#atChoice = false;
      this.#callbacks.onLeaveChoice();
    }
  }
}

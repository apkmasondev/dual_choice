import {
  BRANCH_PRELOAD_PROGRESS,
  BRANCH_POSTER,
  INTRO_FRAME_DURATION,
  pickVariant,
  posterSource,
  videoSource,
  type PosterId,
  type VariantId,
} from '../config/media.ts';
import { COPY } from '../content/copy.ts';
import { ExperienceMachine, isBranchReveal, type ExperienceState } from './ExperienceState.ts';
import { AmbientBackdrop } from '../media/AmbientBackdrop.ts';
import { AudioController } from '../media/AudioController.ts';
import { ScrollScrubber } from '../media/ScrollScrubber.ts';
import { VideoController } from '../media/VideoController.ts';
import { ChoiceHotspots } from '../choice/ChoiceHotspots.ts';
import { StageLayout } from '../stage/StageLayout.ts';
import { RevealPanel } from '../ui/RevealPanel.ts';
import { SoundToggle } from '../ui/SoundToggle.ts';
import { LiveRegion, requireElement, requireElementOf } from '../ui/dom.ts';
import { Disposables } from '../utils/disposables.ts';
import { isConstrainedNetwork, prefersReducedData, prefersReducedMotion } from '../utils/env.ts';
import { safeEndTime } from '../media/scrubMath.ts';
import type { BranchId } from '../choice/hotspot-config.ts';

/** SKIP appears once the film has genuinely started, not on a hopeful timer. */
const SKIP_REVEAL_AFTER_MS = 1200;

/**
 * How long the ambient wash tracks the film frame by frame after the film has
 * been told to move. A ceiling over the 760 ms settle in the stylesheet, not a
 * copy of it.
 */
const FILM_SETTLE_WINDOW_MS = 900;

/** Safety net in case a browser skips `transitionend` on a hidden element. */
const CROSSFADE_GUARD_MS = 700;

export class ExperienceController {
  readonly #disposables = new Disposables();
  readonly #machine: ExperienceMachine;
  readonly #layout: StageLayout;
  readonly #ambient: AmbientBackdrop;
  readonly #audio: AudioController;
  readonly #hotspots: ChoiceHotspots;
  readonly #reveal: RevealPanel;
  readonly #soundToggle: SoundToggle;
  readonly #live: LiveRegion;
  readonly #scrubber: ScrollScrubber;

  readonly #stage: HTMLElement;
  readonly #posterPicture: HTMLElement;
  readonly #posterImage: HTMLImageElement;
  readonly #skipButton: HTMLButtonElement;
  readonly #playFilmButton: HTMLButtonElement;
  readonly #entryDialog: HTMLDialogElement;

  readonly #intro: VideoController;
  readonly #branches: Record<BranchId, VideoController>;

  readonly #variant: VariantId;
  #lastFrameTime = 0;
  #rafHandle = 0;
  #branchesUpgraded = false;
  #cancelSkipReveal: (() => void) | null = null;
  #cancelFollow: (() => void) | null = null;

  constructor() {
    const reduced = prefersReducedMotion();
    this.#machine = new ExperienceMachine({
      motion: reduced ? 'reduced' : 'full',
      onInvalidTransition: (from, to) => {
        if (import.meta.env.DEV) console.warn(`[experience] blocked ${from} -> ${to}`);
      },
    });

    this.#stage = requireElement('stage');
    this.#posterPicture = requireElement('poster');
    this.#posterImage = requireElementOf('poster-image', HTMLImageElement);
    this.#skipButton = requireElementOf('skip', HTMLButtonElement);
    this.#playFilmButton = requireElementOf('play-film', HTMLButtonElement);
    this.#entryDialog = requireElementOf('entry', HTMLDialogElement);
    this.#live = new LiveRegion(requireElement('live-region'));

    document.documentElement.dataset['motion'] = reduced ? 'reduced' : 'full';

    this.#layout = new StageLayout(this.#stage, this.#disposables);
    this.#ambient = new AmbientBackdrop(
      requireElementOf('ambient', HTMLCanvasElement),
      this.#stage,
      { minIntervalMs: reduced ? 400 : 90 },
    );

    this.#variant = pickVariant(
      { width: globalThis.innerWidth, height: globalThis.innerHeight },
      prefersReducedData(),
    );

    const videoOptions = {
      frameDuration: INTRO_FRAME_DURATION,
      disposables: this.#disposables,
    };
    this.#intro = new VideoController(requireElementOf('film-intro', HTMLVideoElement), {
      ...videoOptions,
      onError: () => {
        this.#handleIntroFailure();
      },
    });
    this.#branches = {
      blue: new VideoController(requireElementOf('film-blue', HTMLVideoElement), videoOptions),
      red: new VideoController(requireElementOf('film-red', HTMLVideoElement), videoOptions),
    };

    this.#audio = new AudioController(this.#disposables, {
      onStateChange: (enabled) => {
        this.#soundToggle.setState(enabled);
      },
      onUnavailable: () => {
        this.#soundToggle.setUnavailable();
      },
    });

    this.#soundToggle = new SoundToggle(
      requireElementOf('sound-toggle', HTMLButtonElement),
      requireElement('sound-toggle-text'),
      () => {
        void this.#audio.toggle();
      },
      this.#disposables,
    );

    this.#hotspots = new ChoiceHotspots(
      this.#stage,
      {
        onSelect: (branch) => {
          void this.#select(branch);
        },
      },
      this.#disposables,
    );

    this.#reveal = new RevealPanel(
      {
        section: requireElement('reveal'),
        kicker: requireElement('reveal-kicker'),
        stamp: requireElement('reveal-stamp'),
        headline: requireElement('reveal-headline'),
        body: requireElement('reveal-body'),
        contact: requireElementOf('cta-contact', HTMLAnchorElement),
        portfolio: requireElementOf('cta-portfolio', HTMLAnchorElement),
        again: requireElementOf('cta-again', HTMLButtonElement),
        hint: requireElement('cta-hint'),
      },
      () => {
        this.#chooseAgain();
      },
      this.#disposables,
    );

    this.#scrubber = new ScrollScrubber(
      this.#intro,
      {
        onProgress: (progress) => {
          this.#onProgress(progress);
        },
        onReachChoice: () => {
          this.#enterChoice();
        },
        onLeaveChoice: () => {
          this.#leaveChoice();
        },
      },
      this.#disposables,
    );

    this.#layout.onChange((geometry) => {
      this.#hotspots.applyGeometry(geometry);
      // A rotation during the reveal changes both the frame and the panel, so
      // the settle has to be recomputed or the copy lands back on the product.
      if (isBranchReveal(this.#machine.state)) this.#refreshRevealFit();
    });

    this.#wireControls();
    this.#applyState('boot');
    this.#machine.subscribe(({ to }) => {
      this.#applyState(to);
    });
  }

  get machine(): ExperienceMachine {
    return this.#machine;
  }

  get layout(): StageLayout {
    return this.#layout;
  }

  get scrubber(): ScrollScrubber {
    return this.#scrubber;
  }

  get introVideo(): VideoController {
    return this.#intro;
  }

  /** Lets the dev-only overlays register their own cleanup in the same bag. */
  get disposables(): Disposables {
    return this.#disposables;
  }

  // ---------------------------------------------------------------- start-up

  start(): void {
    this.#intro.setSource(videoSource('intro', this.#variant), 'auto');
    for (const branch of ['blue', 'red'] as const) {
      this.#branches[branch].setSource(videoSource(branch, this.#variant), 'metadata');
    }

    // The poster is already on screen; seed the ambient wash from it so the
    // bands beside the frame are never a flat placeholder colour.
    this.#ambient.useStill(this.#posterImage);

    void this.#intro.whenReady('metadata').then((ok) => {
      if (ok) this.#scrubber.setDuration(this.#intro.duration);
    });

    this.#startLoop();
    this.#machine.transition('ready');
    this.#entryDialog.showModal();
  }

  dispose(): void {
    cancelAnimationFrame(this.#rafHandle);
    this.#disposables.dispose();
  }

  #wireControls(): void {
    const withSound = requireElementOf('entry-sound', HTMLButtonElement);
    const muted = requireElementOf('entry-muted', HTMLButtonElement);
    const entry = this.#entryDialog;

    // There is no valid "dismissed" state: the visitor picks sound or muted.
    entry.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
      },
      { signal: this.#disposables.signal },
    );

    this.#disposables.listen(withSound, 'click', () => {
      entry.close();
      void this.#audio.enable().finally(() => {
        void this.#enter();
      });
    });
    this.#disposables.listen(muted, 'click', () => {
      entry.close();
      this.#audio.declineSound();
      void this.#enter();
    });

    this.#disposables.listen(this.#skipButton, 'click', () => {
      void this.#skip();
    });
    this.#disposables.listen(this.#playFilmButton, 'click', () => {
      void this.#playBranchOnRequest();
    });
  }

  // ------------------------------------------------------------- entry / run

  async #enter(): Promise<void> {
    const ready = await this.#intro.whenReady('data');

    if (!ready) {
      this.#handleIntroFailure();
      return;
    }

    if (this.#machine.prefersReducedMotion) {
      // No scrubbing at all: dissolve straight to the frame where the choice
      // happens, then hand over. The end time is derived here rather than read
      // from a field, so it cannot depend on which readiness promise settled
      // first.
      await this.#intro.seekAndSettle(safeEndTime(this.#intro.duration, INTRO_FRAME_DURATION));
      this.#showFilm(this.#intro);
      this.#machine.transition('choice');
      this.#enterChoiceUi();
      return;
    }

    await this.#intro.seekAndSettle(0);
    this.#showFilm(this.#intro);
    this.#machine.transition('intro');
    this.#scrubber.start();
    this.#live.announce(COPY.intro.liveEnter);
  }

  #startLoop(): void {
    const step = (now: number): void => {
      const dt = this.#lastFrameTime === 0 ? 0 : (now - this.#lastFrameTime) / 1000;
      this.#lastFrameTime = now;

      // Layout first, so hotspots and film are repositioned in the same paint.
      this.#layout.flush();
      // Cap dt so a backgrounded tab does not resume with a huge jump.
      this.#scrubber.update(Math.min(dt, 0.1));
      this.#ambient.update(now);

      this.#rafHandle = requestAnimationFrame(step);
    };
    this.#rafHandle = requestAnimationFrame(step);
  }

  #onProgress(progress: number): void {
    this.#stage.style.setProperty('--intro-progress', progress.toFixed(4));
    if (!this.#branchesUpgraded && progress >= BRANCH_PRELOAD_PROGRESS) {
      this.#branchesUpgraded = true;
      void this.#upgradeBranchPreload();
    }
  }

  /**
   * Pulls the branches in one at a time so they do not fight the intro — or
   * each other — for bandwidth. Constrained connections keep `metadata` and
   * simply wait a moment longer after the choice.
   */
  async #upgradeBranchPreload(): Promise<void> {
    if (isConstrainedNetwork()) return;
    for (const branch of ['blue', 'red'] as const) {
      const video = this.#branches[branch];
      video.setPreload('auto');
      await video.whenReady('canplay');
    }
  }

  // ---------------------------------------------------------------- choice

  #enterChoice(): void {
    if (!this.#machine.transition('choice')) return;
    this.#enterChoiceUi();
  }

  #enterChoiceUi(): void {
    this.#hotspots.setInteractive(true);
    this.#live.announce(COPY.choice.live);
    void this.#upgradeBranchPreload();
  }

  #leaveChoice(): void {
    if (this.#machine.selectionCommitted) return;
    if (this.#machine.transition('intro')) this.#hotspots.setInteractive(false);
  }

  async #select(branch: BranchId): Promise<void> {
    if (!this.#machine.commitSelection(branch)) return;

    document.documentElement.dataset['branch'] = branch;
    this.#hotspots.markSelected(branch);
    this.#audio.playSelect(branch);
    this.#audio.duck();
    this.#live.announce(COPY.branches[branch].live);

    const video = this.#branches[branch];

    if (this.#machine.prefersReducedMotion) {
      this.#setPoster(BRANCH_POSTER[branch]);
      this.#showPoster();
      this.#openReveal(branch);
      this.#playFilmButton.dataset['visible'] = 'true';
      this.#playFilmButton.hidden = false;
      return;
    }

    if (!video.isReady('canplay')) this.#hotspots.setLoading(branch, true);
    video.setPreload('auto');
    const ready = await video.whenReady('canplay');
    this.#hotspots.setLoading(branch, false);

    if (!ready) {
      // The branch will not play. The still and the whole sales message still
      // arrive — the visitor never hits a dead end.
      this.#setPoster(BRANCH_POSTER[branch]);
      this.#showPoster();
      this.#openReveal(branch);
      return;
    }

    await video.seekAndSettle(0);
    // Fade the branch in *over* the intro rather than crossfading both, so the
    // backdrop can never show through the join. The two frames are the same
    // moment (measured PSNR 36.8 dB), so 140 ms reads as a cut.
    this.#showFilm(video, { keepPrevious: true });
    if (!this.#machine.beginPlayback()) return;
    await video.play();
    this.#intro.setActive(false);
    this.#armSkip();

    video.onEnded(() => {
      this.#completeBranch(branch);
    });
  }

  #completeBranch(branch: BranchId): void {
    this.#cancelSkipReveal?.();
    this.#hideSkip();
    if (!this.#machine.completePlayback(branch)) return;
    this.#openReveal(branch);
  }

  #openReveal(branch: BranchId): void {
    if (!isBranchReveal(this.#machine.state)) this.#machine.revealWithoutPlayback();
    this.#reveal.show(branch);
    // Focus moves in the same task as the reveal: the film may have been
    // skipped from a control that is now hidden, and focus must not be left
    // on <body> for even a frame.
    this.#reveal.focusHeadline();
    this.#refreshRevealFit();
  }

  /**
   * Keeps the ambient wash glued to the film while the film is moving.
   *
   * Only a ceiling: the settle itself is 760 ms in the stylesheet, and this
   * window merely has to outlast it. Nothing depends on the two numbers
   * matching, so they are not tied together.
   */
  #followFilm(): void {
    this.#ambient.setFollowing(true);
    this.#cancelFollow?.();
    this.#cancelFollow = this.#disposables.timeout(() => {
      this.#ambient.setFollowing(false);
    }, FILM_SETTLE_WINDOW_MS);
  }

  /** Measures the panel, then settles the film clear of it. */
  #refreshRevealFit(): void {
    // Measuring needs the panel in flow, so this waits one frame. The card
    // reveal then widens the panel to the settled film, which can rewrap the
    // copy — so the fit is measured a second time against the width it just
    // produced. Two passes, never a loop: the film is already easing over
    // 760 ms, so the correction is not something a visitor can see.
    requestAnimationFrame(() => {
      if (!isBranchReveal(this.#machine.state)) return;
      this.#layout.applyRevealTransform(this.#reveal.measure());
      this.#followFilm();

      requestAnimationFrame(() => {
        if (!isBranchReveal(this.#machine.state)) return;
        this.#layout.applyRevealTransform(this.#reveal.measure());
      });
    });
  }

  // ----------------------------------------------------------------- skip

  #armSkip(): void {
    this.#skipButton.hidden = false;
    this.#cancelSkipReveal = this.#disposables.timeout(() => {
      this.#skipButton.dataset['visible'] = 'true';
    }, SKIP_REVEAL_AFTER_MS);
  }

  #hideSkip(): void {
    delete this.#skipButton.dataset['visible'];
    this.#skipButton.hidden = true;
  }

  async #skip(): Promise<void> {
    const branch = this.#machine.branch;
    if (!branch) return;
    const video = this.#branches[branch];
    video.pause();
    await video.seekAndSettle(safeEndTime(video.duration, INTRO_FRAME_DURATION));
    this.#completeBranch(branch);
  }

  /** Reduced motion: the visitor asks for the film explicitly. */
  async #playBranchOnRequest(): Promise<void> {
    const branch = this.#machine.branch;
    if (!branch) return;
    const video = this.#branches[branch];

    this.#playFilmButton.hidden = true;
    delete this.#playFilmButton.dataset['visible'];

    video.setPreload('auto');
    const ready = await video.whenReady('canplay');
    if (!ready) return;

    await video.seekAndSettle(0);
    this.#showFilm(video, { keepPrevious: true });
    if (!this.#machine.beginPlayback()) return;
    this.#layout.clearRevealTransform();
    this.#followFilm();
    await video.play();
    this.#intro.setActive(false);

    video.onEnded(() => {
      this.#completeBranch(branch);
    });
  }

  // ------------------------------------------------------------ choose again

  #chooseAgain(): void {
    const branch = this.#machine.branch;
    if (!branch || !this.#machine.chooseAgain()) return;

    this.#reveal.hide();
    this.#layout.clearRevealTransform();
    this.#followFilm();
    this.#playFilmButton.hidden = true;
    delete document.documentElement.dataset['branch'];

    const branchVideo = this.#branches[branch];

    // The intro is stacked below the branch films, so reveal it by fading the
    // branch out on top of it — the CHOICE frame is already underneath.
    if (this.#machine.prefersReducedMotion) {
      this.#setPoster('choice');
    } else {
      this.#intro.setActive(true);
    }
    branchVideo.setActive(false);

    const finish = (): void => {
      cancelGuard();
      branchVideo.reset();
      if (!this.#machine.arriveAtChoice()) return;
      this.#hotspots.reset();
      this.#hotspots.setInteractive(true);
      this.#hotspots.focusFirst();
      this.#live.announce(COPY.choice.live);
      if (!this.#machine.prefersReducedMotion) this.#scrubber.scrollToChoiceAnchor();
    };

    const cancelGuard = this.#disposables.timeout(finish, CROSSFADE_GUARD_MS);
    branchVideo.element.addEventListener(
      'transitionend',
      (event) => {
        if (event.propertyName === 'opacity') finish();
      },
      { once: true, signal: this.#disposables.signal },
    );
  }

  // ------------------------------------------------------------ presentation

  #applyState(state: ExperienceState): void {
    document.documentElement.dataset['state'] = state;
    // A state change can move copy between the band and the overlay.
    this.#layout.invalidate();
  }

  #showFilm(video: VideoController, options: { keepPrevious?: boolean } = {}): void {
    if (!options.keepPrevious) {
      this.#intro.setActive(false);
      this.#branches.blue.setActive(false);
      this.#branches.red.setActive(false);
    }
    video.setActive(true);
    this.#ambient.setSource(video.element);
    document.documentElement.dataset['poster'] = 'hidden';
  }

  #showPoster(): void {
    this.#intro.setActive(false);
    this.#branches.blue.setActive(false);
    this.#branches.red.setActive(false);
    this.#ambient.setSource(null);
    this.#ambient.useStill(this.#posterImage);
    delete document.documentElement.dataset['poster'];
  }

  #setPoster(id: PosterId): void {
    const sources = this.#posterPicture.querySelectorAll('source');
    const formats = ['avif', 'webp'] as const;
    sources.forEach((source, index) => {
      const format = formats[index];
      if (format) source.srcset = posterSource(id, format);
    });
    this.#posterImage.src = posterSource(id, 'jpg');
  }

  /**
   * Without the intro there is no scrubbing, but the CHOICE still, both
   * hotspots and the entire sales path remain available.
   */
  #handleIntroFailure(): void {
    if (this.#machine.state === 'choice' || this.#machine.selectionCommitted) return;
    this.#scrubber.stop();
    this.#setPoster('choice');
    this.#showPoster();
    if (this.#machine.transition('choice')) this.#enterChoiceUi();
  }
}

import type { BranchId } from '../choice/hotspot-config.ts';

/**
 * The one and only source of truth for where the visitor is in the experience.
 *
 * Deliberately not a bag of booleans (`isPlaying`, `isChoice`, `isRed`…):
 * with ten states and a fixed transition table, "RED is playing while BLUE is
 * loading" is not merely discouraged, it is unrepresentable.
 */
export type ExperienceState =
  | 'boot'
  | 'ready'
  | 'intro'
  | 'choice'
  | 'branch-loading'
  | 'red-playing'
  | 'blue-playing'
  | 'red-reveal'
  | 'blue-reveal'
  | 'returning';

/**
 * Reduced motion is a *mode*, not a state.
 *
 * The plan sketches `'reduced-motion'` as a member of the state union, but
 * that would make it a dead end: a reduced-motion visitor still has to reach
 * choice, pick a branch, read the product copy and get to the CTA (plan
 * section 14). Modelling it orthogonally keeps that path complete and keeps
 * the transition table honest.
 */
export type MotionMode = 'full' | 'reduced';

export const BRANCH_PLAYING: Record<BranchId, ExperienceState> = {
  red: 'red-playing',
  blue: 'blue-playing',
};

export const BRANCH_REVEAL: Record<BranchId, ExperienceState> = {
  red: 'red-reveal',
  blue: 'blue-reveal',
};

const TRANSITIONS: Record<ExperienceState, readonly ExperienceState[]> = {
  boot: ['ready'],
  // Reduced motion goes straight to the still CHOICE frame.
  ready: ['intro', 'choice'],
  intro: ['choice'],
  // Scrolling back up before committing returns to the scrubbed intro.
  choice: ['branch-loading', 'intro'],
  // A branch that fails to load falls back to its reveal (poster + copy) or,
  // if even that is impossible, back to choice.
  'branch-loading': ['red-playing', 'blue-playing', 'red-reveal', 'blue-reveal', 'choice'],
  'red-playing': ['red-reveal'],
  'blue-playing': ['blue-reveal'],
  // reveal -> playing is the reduced-motion opt-in: the still and the sales
  // copy arrive without any movement, and "PLAY PRODUCT FILM" lets the visitor
  // ask for the film explicitly. Section 14 requires that escape hatch; the
  // plan's transition sketch simply did not have a state for it.
  'red-reveal': ['returning', 'red-playing'],
  'blue-reveal': ['returning', 'blue-playing'],
  returning: ['choice'],
};

export interface TransitionEvent {
  readonly from: ExperienceState;
  readonly to: ExperienceState;
  readonly branch: BranchId | null;
}

export type TransitionListener = (event: TransitionEvent) => void;

export interface MachineOptions {
  readonly motion?: MotionMode;
  readonly onInvalidTransition?: (from: ExperienceState, to: ExperienceState) => void;
}

export class ExperienceMachine {
  #state: ExperienceState = 'boot';
  #branch: BranchId | null = null;
  #selectionCommitted = false;
  readonly #listeners = new Set<TransitionListener>();
  readonly #motion: MotionMode;
  readonly #onInvalidTransition: ((from: ExperienceState, to: ExperienceState) => void) | undefined;

  constructor(options: MachineOptions = {}) {
    this.#motion = options.motion ?? 'full';
    this.#onInvalidTransition = options.onInvalidTransition;
  }

  get state(): ExperienceState {
    return this.#state;
  }

  get branch(): BranchId | null {
    return this.#branch;
  }

  /** Latched the moment a hotspot is activated, so a double tap cannot start two films. */
  get selectionCommitted(): boolean {
    return this.#selectionCommitted;
  }

  get motion(): MotionMode {
    return this.#motion;
  }

  get prefersReducedMotion(): boolean {
    return this.#motion === 'reduced';
  }

  can(next: ExperienceState): boolean {
    return TRANSITIONS[this.#state].includes(next);
  }

  subscribe(listener: TransitionListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  transition(next: ExperienceState): boolean {
    if (!this.can(next)) {
      this.#onInvalidTransition?.(this.#state, next);
      return false;
    }
    const from = this.#state;
    this.#state = next;
    const event: TransitionEvent = { from, to: next, branch: this.#branch };
    for (const listener of this.#listeners) listener(event);
    return true;
  }

  /**
   * Commits a branch choice. The second call is a no-op whatever it asks for,
   * which is what makes double taps and "click BLUE then RED" harmless.
   */
  commitSelection(branch: BranchId): boolean {
    if (this.#selectionCommitted) return false;
    if (!this.can('branch-loading')) return false;
    this.#selectionCommitted = true;
    this.#branch = branch;
    return this.transition('branch-loading');
  }

  /** branch-loading -> <branch>-playing, once the film can actually start. */
  beginPlayback(): boolean {
    const branch = this.#branch;
    if (!branch) return false;
    return this.transition(BRANCH_PLAYING[branch]);
  }

  /**
   * Moves to the reveal. `endedBranch` is checked against the committed branch
   * so a stray `ended` from the film that is *not* on screen is ignored.
   */
  completePlayback(endedBranch: BranchId): boolean {
    if (this.#branch !== endedBranch) return false;
    return this.transition(BRANCH_REVEAL[endedBranch]);
  }

  /** Fallback path: skip playback entirely and show the final still + copy. */
  revealWithoutPlayback(): boolean {
    const branch = this.#branch;
    if (!branch) return false;
    return this.transition(BRANCH_REVEAL[branch]);
  }

  chooseAgain(): boolean {
    return this.transition('returning');
  }

  /** returning -> choice, releasing the selection lock for another round. */
  arriveAtChoice(): boolean {
    const moved = this.transition('choice');
    if (moved) {
      this.#selectionCommitted = false;
      this.#branch = null;
    }
    return moved;
  }

  /** Used when a branch cannot be loaded at all. */
  abandonSelection(): boolean {
    const moved = this.transition('choice');
    if (moved) {
      this.#selectionCommitted = false;
      this.#branch = null;
    }
    return moved;
  }
}

export const isBranchPlaying = (state: ExperienceState): boolean =>
  state === 'red-playing' || state === 'blue-playing';

export const isBranchReveal = (state: ExperienceState): boolean =>
  state === 'red-reveal' || state === 'blue-reveal';

/** True while the stage should hold the exact CHOICE frame. */
export const holdsChoiceFrame = (state: ExperienceState): boolean =>
  state === 'choice' || state === 'branch-loading' || state === 'returning';

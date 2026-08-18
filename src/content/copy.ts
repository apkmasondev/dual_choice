import type { BranchId } from '../choice/hotspot-config.ts';

/**
 * Every user-visible string in one place. No copy lives inside a component.
 */

export const COPY = {
  document: {
    title: 'DUAL / CHOICE — Interactive Product Experience by APK',
    description:
      'An interactive product experience by APK combining cinematic motion, sound and responsive web interaction.',
  },

  brand: {
    wordmark: 'APK',
    /** No "APK /" prefix: it hangs directly under the wordmark. */
    eyebrow: 'INTERACTIVE PRODUCT EXPERIENCE',
  },

  entry: {
    title: 'ENTER EXPERIENCE',
    support: 'Best with sound. Runs entirely in your browser.',
    withSound: 'ENTER WITH SOUND',
    muted: 'CONTINUE MUTED',
  },

  intro: {
    scrollHint: 'SCROLL TO ENTER',
    /** Announced to assistive technology when the intro begins. */
    liveEnter: 'Introduction started. Scroll to move through the film.',
  },

  choice: {
    headline: 'CHOOSE YOUR REALITY.',
    support: 'Two objects. Two outcomes. One interaction.',
    keyboardHint: 'Press Enter to choose',
    live: 'Choice ready. Two objects are available: control, on the left, and desire, on the right.',
  },

  branches: {
    blue: {
      label: 'CONTROL',
      descriptor: 'Precision becomes presence.',
      /** Shape word, so colour is never the only carrier of meaning. */
      shape: 'crystal',
      accessibleName: 'Choose CONTROL — the blue crystal in the left hand',
      kicker: 'CONTROL',
      headline: 'KNOW EVERY DETAIL.',
      body: 'A product story shaped by precision, motion and interaction.',
      live: 'CONTROL selected. Playing the blue product film.',
    },
    red: {
      label: 'DESIRE',
      descriptor: 'Designed to be felt.',
      shape: 'sphere',
      accessibleName: 'Choose DESIRE — the red sphere in the right hand',
      kicker: 'DESIRE',
      headline: 'FEEL EVERYTHING.',
      body: 'A product story designed to create emotion before the first specification is read.',
      live: 'DESIRE selected. Playing the red product film.',
    },
  } satisfies Record<BranchId, BranchCopy>,

  final: {
    /* Right-hand end of the reveal rule: the studio's edition mark for this
       piece. Bump the number for the next realisation; the year is written
       out rather than computed, so it never changes on its own at midnight
       on New Year's Eve. */
    stamp: 'NO. 026 · 2026',
    headline: 'YOUR PRODUCT COULD BE NEXT.',
    body: 'APK creates interactive product experiences where film, sound and code become one seamless story.',
    supporting:
      "Have a launch, product or idea worth remembering? Let's build the moment people won't scroll past.",
    primaryCta: 'START A PROJECT',
    secondaryCta: 'VIEW MORE WORK',
    tertiaryCta: 'CHOOSE AGAIN',
    unconfiguredHint:
      'Set VITE_CONTACT_URL and VITE_PORTFOLIO_URL to enable the outbound calls to action.',
  },

  controls: {
    soundOn: 'Turn sound on',
    soundOff: 'Turn sound off',
    soundLabel: 'Sound',
    skip: 'SKIP',
    skipLabel: 'Skip to the end of the film',
    playFilm: 'PLAY PRODUCT FILM',
    playFilmLabel: 'Play the product film with motion',
  },

  fallback: {
    noscriptTitle: 'DUAL / CHOICE',
    noscriptBody:
      'This interactive product experience needs JavaScript. The film below is the moment of choice: a blue crystal and a red sphere, one interaction, two outcomes.',
    videoUnavailable: 'The film could not be loaded. The story continues below.',
  },
} as const;

export interface BranchCopy {
  readonly label: string;
  readonly descriptor: string;
  readonly shape: string;
  readonly accessibleName: string;
  readonly kicker: string;
  readonly headline: string;
  readonly body: string;
  readonly live: string;
}

export const branchCopy = (branch: BranchId): BranchCopy => COPY.branches[branch];

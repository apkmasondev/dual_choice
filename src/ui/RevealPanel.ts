import { COPY } from '../content/copy.ts';
import { EXTERNAL_LINK_REL, HAS_EXTERNAL_CTA, SITE } from '../config/site.ts';
import { isDev } from '../utils/env.ts';
import type { BranchId } from '../choice/hotspot-config.ts';
import type { Disposables } from '../utils/disposables.ts';

export interface RevealElements {
  readonly section: HTMLElement;
  readonly kicker: HTMLElement;
  readonly headline: HTMLElement;
  readonly body: HTMLElement;
  readonly contact: HTMLAnchorElement;
  readonly portfolio: HTMLAnchorElement;
  readonly again: HTMLButtonElement;
  readonly hint: HTMLElement;
}

/**
 * Product copy plus the APK call to action.
 *
 * A destination that is not configured produces no button. Rendering
 * "START A PROJECT" as a link to nowhere would look finished and be broken;
 * in development the panel names the exact environment variable instead.
 */
export class RevealPanel {
  readonly #elements: RevealElements;

  constructor(elements: RevealElements, onChooseAgain: () => void, disposables: Disposables) {
    this.#elements = elements;

    if (SITE.contactUrl) {
      elements.contact.href = SITE.contactUrl;
      elements.contact.target = '_blank';
      elements.contact.rel = EXTERNAL_LINK_REL;
      elements.contact.hidden = false;
    }

    if (SITE.portfolioUrl) {
      elements.portfolio.href = SITE.portfolioUrl;
      elements.portfolio.target = '_blank';
      elements.portfolio.rel = EXTERNAL_LINK_REL;
      elements.portfolio.hidden = false;
    }

    if (!HAS_EXTERNAL_CTA && isDev) {
      elements.hint.textContent = COPY.final.unconfiguredHint;
      elements.hint.hidden = false;
    }

    disposables.listen(elements.again, 'click', onChooseAgain);
  }

  show(branch: BranchId): void {
    const copy = COPY.branches[branch];
    this.#elements.kicker.textContent = copy.kicker;
    this.#elements.headline.textContent = copy.headline;
    this.#elements.body.textContent = copy.body;
    this.#elements.section.hidden = false;
  }

  hide(): void {
    this.#elements.section.hidden = true;
  }

  /** Height the panel needs, so the film can be scaled back to make room. */
  measure(): number {
    return this.#elements.section.getBoundingClientRect().height;
  }

  /** After a film ends, focus lands on the heading that just appeared. */
  focusHeadline(): void {
    this.#elements.headline.tabIndex = -1;
    this.#elements.headline.focus({ preventScroll: true });
  }
}

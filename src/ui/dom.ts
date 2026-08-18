/**
 * The markup ships in index.html — it is the no-JS fallback and it is what
 * makes first paint free of layout shift. These helpers fail loudly if the
 * contract between markup and behaviour is ever broken, instead of handing
 * back a silently mistyped node.
 */

export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
}

/** Same, but proves at runtime that the node really is the expected kind. */
export function requireElementOf<T extends HTMLElement>(
  id: string,
  type: abstract new (...args: never[]) => T,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Element #${id} is not a ${type.name}`);
  }
  return element;
}

/** Polite announcements for state changes an assistive user cannot see. */
export class LiveRegion {
  readonly #node: HTMLElement;
  #last = '';

  constructor(node: HTMLElement) {
    this.#node = node;
  }

  announce(message: string): void {
    if (message === this.#last) return;
    this.#last = message;
    this.#node.textContent = message;
  }
}

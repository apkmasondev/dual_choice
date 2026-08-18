import { COPY } from '../content/copy.ts';
import type { Disposables } from '../utils/disposables.ts';

/**
 * Real button, real `aria-pressed`, label that says what pressing it will do.
 * The page works fully without it: when audio proves unavailable the control
 * disables itself once, quietly, with no console noise.
 */
export class SoundToggle {
  readonly #button: HTMLButtonElement;
  readonly #text: HTMLElement;

  constructor(
    button: HTMLButtonElement,
    text: HTMLElement,
    onToggle: () => void,
    disposables: Disposables,
  ) {
    this.#button = button;
    this.#text = text;
    this.setState(false);
    disposables.listen(button, 'click', onToggle);
  }

  setState(enabled: boolean): void {
    this.#button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    this.#button.setAttribute(
      'aria-label',
      enabled ? COPY.controls.soundOff : COPY.controls.soundOn,
    );
    this.#text.textContent = COPY.controls.soundLabel;
  }

  setUnavailable(): void {
    this.#button.disabled = true;
    this.#button.setAttribute('aria-pressed', 'false');
    this.#button.setAttribute('aria-label', 'Sound is unavailable');
  }
}

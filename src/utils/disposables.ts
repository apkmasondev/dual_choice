/**
 * Every listener, observer and timer in the app is registered here, so nothing
 * survives a teardown. The controller owns one Disposables bag.
 */
export class Disposables {
  readonly #controller = new AbortController();
  readonly #teardowns: (() => void)[] = [];
  #disposed = false;

  /** AbortSignal to hand to `addEventListener`, `fetch`, observers and friends. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Registers arbitrary cleanup (observer.disconnect(), clearTimeout, …). */
  add(teardown: () => void): void {
    if (this.#disposed) {
      teardown();
      return;
    }
    this.#teardowns.push(teardown);
  }

  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options: AddEventListenerOptions = {},
  ): void {
    target.addEventListener(type, handler, { ...options, signal: this.#controller.signal });
  }

  /** A `setTimeout` that cannot outlive the component. */
  timeout(handler: () => void, delayMs: number): () => void {
    const id = globalThis.setTimeout(() => {
      handler();
    }, delayMs);
    const cancel = (): void => {
      globalThis.clearTimeout(id);
    };
    this.add(cancel);
    return cancel;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#controller.abort();
    while (this.#teardowns.length > 0) {
      const teardown = this.#teardowns.pop();
      teardown?.();
    }
  }
}

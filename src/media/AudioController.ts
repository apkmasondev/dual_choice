import { AUDIO_SOURCES, asset } from '../config/media.ts';
import type { BranchId } from '../choice/hotspot-config.ts';
import type { Disposables } from '../utils/disposables.ts';

/**
 * Sound for the experience.
 *
 * The soundtrack streams through an <audio> element into a Web Audio graph:
 * a 3.5-minute master decoded into memory would cost ~80 MB, while a media
 * element source streams and still gives us a gain node to duck.
 *
 * Nothing here tries to defeat autoplay policy. The context is created inside
 * the visitor's first gesture and never before.
 */

const MUSIC_LEVEL = 0.22;
const DUCK_LEVEL = 0.12; // ≈ -5.3 dB
const DUCK_ATTACK = 0.08;
const DUCK_RELEASE = 0.45;
const FADE = 0.5;

export interface AudioCallbacks {
  readonly onStateChange: (enabled: boolean) => void;
  readonly onUnavailable: () => void;
}

export class AudioController {
  readonly #disposables: Disposables;
  readonly #callbacks: AudioCallbacks;

  #element: HTMLAudioElement | null = null;
  #context: AudioContext | null = null;
  #musicGain: GainNode | null = null;
  #sfxGain: GainNode | null = null;
  #noise: AudioBuffer | null = null;
  #enabled = false;
  #unavailable = false;
  /** Remembers the visitor's choice across a tab switch. */
  #wantsSound = false;

  constructor(disposables: Disposables, callbacks: AudioCallbacks) {
    this.#disposables = disposables;
    this.#callbacks = callbacks;

    disposables.listen(document, 'visibilitychange', () => {
      this.#handleVisibility();
    });
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get unavailable(): boolean {
    return this.#unavailable;
  }

  /**
   * Must be called synchronously from a user gesture.
   * Returns false when audio cannot be started at all.
   */
  async enable(): Promise<boolean> {
    if (this.#unavailable) return false;
    this.#wantsSound = true;

    const context = this.#ensureContext();
    if (!context) return false;

    const element = this.#ensureElement();
    if (!element) return false;

    if (context.state === 'suspended') await context.resume();

    try {
      await element.play();
    } catch {
      // A refused play() here means the gesture was not accepted; the toggle
      // stays available so the visitor can try again.
      return false;
    }

    this.#enabled = true;
    this.#fadeMusic(MUSIC_LEVEL);
    document.documentElement.dataset['sound'] = 'on';
    this.#callbacks.onStateChange(true);
    return true;
  }

  disable(): void {
    this.#wantsSound = false;
    this.#enabled = false;
    this.#fadeMusic(0);
    const element = this.#element;
    const context = this.#context;
    if (element && context) {
      // Let the fade finish before the element stops.
      const stopAt = context.currentTime + FADE;
      const stop = (): void => {
        if (!this.#enabled) element.pause();
      };
      this.#disposables.timeout(stop, Math.ceil((stopAt - context.currentTime) * 1000));
    }
    document.documentElement.dataset['sound'] = 'off';
    this.#callbacks.onStateChange(false);
  }

  async toggle(): Promise<boolean> {
    if (this.#enabled) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  /** Marks the visitor's "continue muted" choice without touching the graph. */
  declineSound(): void {
    this.#wantsSound = false;
    this.#enabled = false;
    document.documentElement.dataset['sound'] = 'off';
    this.#callbacks.onStateChange(false);
  }

  #ensureContext(): AudioContext | null {
    if (this.#context) return this.#context;
    try {
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.#context = context;

      const music = context.createGain();
      music.gain.value = 0;
      music.connect(context.destination);
      this.#musicGain = music;

      const sfx = context.createGain();
      sfx.gain.value = 0.5;
      sfx.connect(context.destination);
      this.#sfxGain = sfx;

      this.#disposables.add(() => {
        void context.close();
      });
      return context;
    } catch {
      this.#markUnavailable();
      return null;
    }
  }

  #ensureElement(): HTMLAudioElement | null {
    if (this.#element) return this.#element;
    const context = this.#context;
    const musicGain = this.#musicGain;
    if (!context || !musicGain) return null;

    const element = document.createElement('audio');
    element.preload = 'auto';
    element.loop = true;
    element.crossOrigin = 'anonymous';
    for (const source of AUDIO_SOURCES) {
      const node = document.createElement('source');
      node.src = asset(source.src);
      node.type = source.type;
      element.append(node);
    }
    element.addEventListener(
      'error',
      () => {
        this.#markUnavailable();
      },
      { signal: this.#disposables.signal },
    );

    try {
      const node = context.createMediaElementSource(element);
      node.connect(musicGain);
    } catch {
      this.#markUnavailable();
      return null;
    }

    // A detached element would still play through the Web Audio graph, but
    // keeping it in the document is what browsers, extensions and the tests
    // expect to find.
    element.hidden = true;
    document.body.append(element);
    this.#disposables.add(() => {
      element.pause();
      element.remove();
    });

    this.#element = element;
    return element;
  }

  #markUnavailable(): void {
    if (this.#unavailable) return;
    this.#unavailable = true;
    this.#enabled = false;
    document.documentElement.dataset['sound'] = 'unavailable';
    this.#callbacks.onUnavailable();
  }

  #fadeMusic(target: number): void {
    const context = this.#context;
    const gain = this.#musicGain;
    if (!context || !gain) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + FADE);
  }

  #handleVisibility(): void {
    const context = this.#context;
    if (!context) return;
    if (document.hidden) {
      this.#fadeMusic(0);
      void context.suspend();
    } else if (this.#wantsSound && this.#enabled) {
      void context.resume().then(() => {
        this.#fadeMusic(MUSIC_LEVEL);
      });
    }
  }

  /** Pulls the music back for a moment so the selection cue has room. */
  duck(): void {
    const context = this.#context;
    const gain = this.#musicGain;
    if (!context || !gain || !this.#enabled) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK);
    gain.gain.setValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK + 0.22);
    gain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + DUCK_ATTACK + 0.22 + DUCK_RELEASE);
  }

  #createNoise(context: AudioContext): AudioBuffer {
    if (this.#noise) return this.#noise;
    const length = Math.floor(context.sampleRate * 0.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.#noise = buffer;
    return buffer;
  }

  /**
   * Selection cue, synthesised rather than shipped as another asset.
   * BLUE is glass: two clean partials with a bright shimmer.
   * RED is mass: a short sub pulse under a metallic transient.
   * Both under 500 ms, both deliberately not "game UI".
   */
  playSelect(branch: BranchId): void {
    const context = this.#context;
    const output = this.#sfxGain;
    if (!context || !output || !this.#enabled) return;

    const now = context.currentTime;

    if (branch === 'blue') {
      for (const [index, frequency] of [1174.66, 1760, 2637.02].entries()) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = index === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(frequency, now);
        const peak = 0.14 / (index + 1.4);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42 - index * 0.08);
        osc.connect(gain).connect(output);
        osc.start(now);
        osc.stop(now + 0.46);
      }

      const shimmer = context.createBufferSource();
      shimmer.buffer = this.#createNoise(context);
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(5200, now);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      shimmer.connect(filter).connect(gain).connect(output);
      shimmer.start(now);
      shimmer.stop(now + 0.32);
      return;
    }

    const sub = context.createOscillator();
    const subGain = context.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(96, now);
    sub.frequency.exponentialRampToValueAtTime(46, now + 0.3);
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.3, now + 0.012);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    sub.connect(subGain).connect(output);
    sub.start(now);
    sub.stop(now + 0.44);

    const transient = context.createBufferSource();
    transient.buffer = this.#createNoise(context);
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(2300, now);
    band.Q.setValueAtTime(6, now);
    const transientGain = context.createGain();
    transientGain.gain.setValueAtTime(0.16, now);
    transientGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    transient.connect(band).connect(transientGain).connect(output);
    transient.start(now);
    transient.stop(now + 0.2);
  }
}

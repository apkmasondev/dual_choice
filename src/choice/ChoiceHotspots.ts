import {
  CHOICE_HOTSPOTS,
  MIN_TOUCH_TARGET_PX,
  type BranchId,
  type HotspotDefinition,
} from './hotspot-config.ts';
import { projectLength, projectPoint } from './mediaProjection.ts';
import { COPY } from '../content/copy.ts';
import { clamp } from '../utils/math.ts';
import type { StageGeometry } from '../stage/StageLayout.ts';
import type { Disposables } from '../utils/disposables.ts';

interface HotspotView {
  readonly definition: HotspotDefinition;
  readonly button: HTMLButtonElement;
  readonly label: HTMLElement | null;
}

export interface HotspotCallbacks {
  readonly onSelect: (branch: BranchId) => void;
}

/** Roughly half the label block; keeps it clear of the top edge. */
const LABEL_HALF_HEIGHT = 30;

/** Minimum distance a label keeps from the left and right edge of the stage. */
const LABEL_EDGE_GUTTER = 14;

/**
 * The BLUE/RED buttons.
 *
 * Position comes from the projected media rect and is written straight to a
 * transform — never a percentage of the viewport, and never transitioned, so
 * a resize moves the anchor and the film together in one paint.
 */
export class ChoiceHotspots {
  readonly #views: HotspotView[] = [];
  #interactive = false;

  constructor(root: HTMLElement, callbacks: HotspotCallbacks, disposables: Disposables) {
    for (const definition of CHOICE_HOTSPOTS) {
      const button = root.querySelector<HTMLButtonElement>(`#hotspot-${definition.id}`);
      if (!button) continue;

      const copy = COPY.branches[definition.id];
      button.setAttribute('aria-label', copy.accessibleName);
      button.dataset['branch'] = definition.id;

      disposables.listen(button, 'pointerdown', () => {
        button.dataset['pressed'] = 'true';
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        disposables.listen(button, type, () => {
          delete button.dataset['pressed'];
        });
      }
      disposables.listen(button, 'click', () => {
        if (!this.#interactive) return;
        callbacks.onSelect(definition.id);
      });

      this.#views.push({
        definition,
        button,
        label: button.querySelector<HTMLElement>('.hotspot__label'),
      });
    }
  }

  /** Rewrites every anchor. Called inside the layout flush, never on scroll. */
  applyGeometry(geometry: StageGeometry): void {
    // Measured before any style is written, so this cannot thrash layout.
    const labelWidths = this.#views.map(({ label }) => label?.offsetWidth ?? 0);

    for (const [index, { definition, button }] of this.#views.entries()) {
      const point = projectPoint(geometry.rect, definition.x, definition.y);
      const ring = Math.max(24, projectLength(geometry.rect, definition.sourceRadius * 2));
      const hit = Math.max(
        MIN_TOUCH_TARGET_PX,
        projectLength(geometry.rect, definition.hitRadius * 2),
      );

      // Keep the label on stage even on very short viewports.
      const labelDy = clamp(
        projectLength(geometry.rect, definition.labelOffsetY),
        -(point.y - LABEL_HALF_HEIGHT),
        geometry.box.height - point.y - LABEL_HALF_HEIGHT,
      );

      // On a narrow stage a label centred on an object near the edge would run
      // off screen, so nudge it back inside while the ring stays put.
      const halfLabel = (labelWidths[index] ?? 0) / 2;
      const labelDx =
        halfLabel === 0
          ? 0
          : clamp(
              0,
              LABEL_EDGE_GUTTER + halfLabel - point.x,
              geometry.box.width - LABEL_EDGE_GUTTER - halfLabel - point.x,
            );

      const style = button.style;
      style.setProperty('--x', `${point.x.toFixed(2)}px`);
      style.setProperty('--y', `${point.y.toFixed(2)}px`);
      style.setProperty('--ring', `${ring.toFixed(2)}px`);
      style.setProperty('--hit', `${hit.toFixed(2)}px`);
      style.setProperty('--label-dy', `${labelDy.toFixed(2)}px`);
      style.setProperty('--label-dx', `${labelDx.toFixed(2)}px`);
    }
  }

  setInteractive(interactive: boolean): void {
    this.#interactive = interactive;
    for (const { button } of this.#views) {
      button.tabIndex = interactive ? 0 : -1;
      button.disabled = false;
    }
  }

  focusFirst(): void {
    this.#views[0]?.button.focus({ preventScroll: true });
  }

  /** Latches the visual commitment: chosen one pulses, the other steps back. */
  markSelected(branch: BranchId): void {
    for (const { definition, button } of this.#views) {
      if (definition.id === branch) {
        button.dataset['selected'] = 'true';
      } else {
        button.dataset['dimmed'] = 'true';
      }
      button.tabIndex = -1;
      button.disabled = definition.id !== branch;
    }
    this.#interactive = false;
  }

  setLoading(branch: BranchId, loading: boolean): void {
    for (const { definition, button } of this.#views) {
      if (definition.id !== branch) continue;
      if (loading) button.dataset['loading'] = 'true';
      else delete button.dataset['loading'];
    }
  }

  reset(): void {
    for (const { button } of this.#views) {
      delete button.dataset['selected'];
      delete button.dataset['dimmed'];
      delete button.dataset['loading'];
      delete button.dataset['pressed'];
      button.disabled = false;
    }
  }
}

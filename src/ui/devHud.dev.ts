import type { StageLayout } from '../stage/StageLayout.ts';
import type { ScrollScrubber } from '../media/ScrollScrubber.ts';
import type { VideoController } from '../media/VideoController.ts';
import type { ExperienceMachine } from '../app/ExperienceState.ts';
import type { Disposables } from '../utils/disposables.ts';

/**
 * Dev-only performance HUD: `?hud=1`.
 *
 * State, rAF frame rate, target vs actual playhead, dropped frames, fit mode
 * and the projected hotspot geometry — the numbers needed to tell "the film is
 * heavy" from "the smoother is mistuned". Dropped from production builds by
 * the `import.meta.env.DEV` guard around its dynamic import in main.ts.
 */
export function startHud(
  machine: ExperienceMachine,
  layout: StageLayout,
  scrubber: ScrollScrubber,
  intro: VideoController,
  disposables: Disposables,
): void {
  const node = document.createElement('pre');
  node.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:120;margin:0;padding:9px 12px;' +
    'background:rgba(10,12,16,.9);color:#dfe5ea;font:11px/1.55 ui-monospace,monospace;' +
    'border-radius:8px;pointer-events:none;white-space:pre';
  document.body.append(node);
  disposables.add(() => {
    node.remove();
  });

  let frames = 0;
  let fps = 0;
  let windowStart = performance.now();
  let raf = 0;

  const tick = (now: number): void => {
    frames += 1;
    if (now - windowStart >= 500) {
      fps = (frames * 1000) / (now - windowStart);
      frames = 0;
      windowStart = now;

      const geometry = layout.geometry;
      const quality = intro.playbackQuality();
      node.textContent = [
        `state      ${machine.state}${machine.branch ? ` (${machine.branch})` : ''}`,
        `motion     ${machine.motion}`,
        `rAF        ${fps.toFixed(0)} fps`,
        `progress   ${scrubber.progress.toFixed(4)}`,
        `target     ${scrubber.targetTime.toFixed(3)} s`,
        `smoothed   ${scrubber.smoothedTime.toFixed(3)} s`,
        `video      ${intro.currentTime.toFixed(3)} s   lag ${(scrubber.smoothedTime - intro.currentTime).toFixed(3)} s`,
        `frames     ${quality ? `${String(quality.dropped)} dropped / ${String(quality.total)}` : 'n/a'}`,
        geometry
          ? `fit        ${geometry.rect.mode} @ ${geometry.rect.scale.toFixed(4)}  copy ${geometry.placement}`
          : 'fit        —',
        geometry
          ? `media      ${geometry.rect.x.toFixed(0)},${geometry.rect.y.toFixed(0)} ` +
            `${geometry.rect.width.toFixed(0)}x${geometry.rect.height.toFixed(0)}`
          : 'media      —',
      ].join('\n');
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  disposables.add(() => {
    cancelAnimationFrame(raf);
  });
}

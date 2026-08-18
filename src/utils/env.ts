/**
 * Feature and preference detection. Everything is behind a guard so a missing
 * API degrades instead of throwing — none of these are required for the
 * experience to work.
 */

export const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const supportsHover = (): boolean =>
  globalThis.matchMedia('(hover: hover) and (pointer: fine)').matches;

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

function connection(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

export const prefersReducedData = (): boolean => connection()?.saveData === true;

/** True on connections where pulling two extra films ahead of time is rude. */
export function isConstrainedNetwork(): boolean {
  const info = connection();
  if (!info) return false;
  if (info.saveData === true) return true;
  return (
    info.effectiveType === 'slow-2g' || info.effectiveType === '2g' || info.effectiveType === '3g'
  );
}

/** `requestVideoFrameCallback` is used only for diagnostics, never for logic. */
export function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return (
    typeof (video as HTMLVideoElement & { requestVideoFrameCallback?: unknown })
      .requestVideoFrameCallback === 'function'
  );
}

export const isDev = import.meta.env.DEV;

/** `?calibrate=1` (dev only) opens the hotspot calibration overlay. */
export function wantsCalibration(): boolean {
  if (!isDev) return false;
  return new URLSearchParams(globalThis.location.search).get('calibrate') === '1';
}

/** `?hud=1` (dev only) opens the performance HUD. */
export function wantsHud(): boolean {
  if (!isDev) return false;
  return new URLSearchParams(globalThis.location.search).get('hud') === '1';
}

/**
 * Watches a media query and reports changes. Returns the current value plus a
 * teardown; used for reduced-motion, which visitors can flip mid-session.
 */
export function observeMediaQuery(
  query: string,
  onChange: (matches: boolean) => void,
  signal: AbortSignal,
): boolean {
  const list = globalThis.matchMedia(query);
  list.addEventListener(
    'change',
    (event) => {
      onChange(event.matches);
    },
    { signal },
  );
  return list.matches;
}

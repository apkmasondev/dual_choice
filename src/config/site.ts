/**
 * The only project inputs that cannot be derived from the assets.
 *
 * Nothing here is invented. When a destination is not configured the matching
 * call-to-action is simply not rendered, rather than pointing somewhere that
 * does not exist. Set the values in `.env` (see `.env.example`) or as
 * repository variables consumed by the Pages workflow.
 */

function readUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    // Accept absolute http(s) and mailto: targets only.
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return trimmed;
    }
    return null;
  } catch {
    return null;
  }
}

export const SITE = {
  name: 'APK',
  projectTitle: 'DUAL / CHOICE',
  language: 'en',

  /** Destination of the primary CTA, "START A PROJECT". */
  contactUrl: readUrl(import.meta.env.VITE_CONTACT_URL),
  /** Destination of the secondary CTA, "VIEW MORE WORK". */
  portfolioUrl: readUrl(import.meta.env.VITE_PORTFOLIO_URL),
  /** Absolute origin of the deployed site; drives canonical + og:image. */
  origin: readUrl(import.meta.env.VITE_SITE_ORIGIN),
} as const;

export const HAS_EXTERNAL_CTA = SITE.contactUrl !== null || SITE.portfolioUrl !== null;

/** External links always get the safe rel, never "just in case" target blanks. */
export const EXTERNAL_LINK_REL = 'noopener noreferrer';

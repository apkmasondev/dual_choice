/// <reference types="vite/client" />

/**
 * Only the values the app is allowed to read. Nothing secret ever goes in a
 * `VITE_*` variable — Vite inlines them into the client bundle.
 */
interface ImportMetaEnv {
  readonly VITE_CONTACT_URL?: string;
  readonly VITE_PORTFOLIO_URL?: string;
  readonly VITE_SITE_ORIGIN?: string;
}

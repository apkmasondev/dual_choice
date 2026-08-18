import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Deployment base path.
 *
 * GitHub Pages needs `/<repo>/` for project pages and `/` for user/org pages
 * or a custom domain. The value is never guessed here: the Pages workflow
 * derives it from the repository itself and passes it in as BASE_PATH.
 * Locally it defaults to `/`.
 */
function resolveBase(): string {
  const raw = process.env['BASE_PATH']?.trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * Absolute URLs for crawlers.
 *
 * Social scrapers do not resolve relative `og:image` values and do not run our
 * JavaScript, so the absolute form has to be baked in at build time. When no
 * origin is configured the tags stay base-relative rather than pointing at an
 * invented domain, and robots/sitemap are skipped entirely.
 */
function metadataPlugin(base: string, origin: string | null): Plugin {
  const absolute = (path: string): string => {
    const clean = path.replace(/^\//, '');
    if (!origin) return `${base}${clean}`;
    return new URL(`${base}${clean}`, origin).href;
  };

  return {
    name: 'apk-metadata',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        let out = html
          .replace(
            /(<meta property="og:image" content=")([^"]+)(")/,
            (_match, before: string, path: string, after: string) =>
              `${before}${absolute(path)}${after}`,
          )
          .replace(
            /(<meta name="twitter:image" content=")([^"]+)(")/,
            (_match, before: string, path: string, after: string) =>
              `${before}${absolute(path)}${after}`,
          );

        const canonical = origin ? new URL(base, origin).href : null;
        out = out.replace(
          '<!--#canonical-->',
          canonical
            ? `<link rel="canonical" href="${canonical}" />\n    <meta property="og:url" content="${canonical}" />`
            : '',
        );
        return out;
      },
    },
    generateBundle() {
      if (!origin) return;
      const home = new URL(base, origin).href;
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${new URL(`${base}sitemap.xml`, origin).href}\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          `  <url><loc>${home}</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n` +
          '</urlset>\n',
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const base = resolveBase();
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const rawOrigin = env['VITE_SITE_ORIGIN']?.trim().replace(/\/$/, '');
  const origin = rawOrigin !== undefined && rawOrigin.length > 0 ? rawOrigin : null;

  return {
    base,
    appType: 'mpa',
    plugins: [metadataPlugin(base, origin)],
    build: {
      target: 'es2022',
      cssTarget: 'chrome111',
      assetsInlineLimit: 2048,
      modulePreload: { polyfill: false },
      sourcemap: false,
      reportCompressedSize: true,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
    },
  };
});

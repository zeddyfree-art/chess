import { readdirSync, readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset path relative, so the build works both on
// GitHub Pages (https://<user>.github.io/chess/) and from any other folder.
// Shown on the About page, so a bug report can say which version it is about.
const commit = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';
const built = new Date().toISOString().slice(0, 10);
// The version people see ("What's new", About): package.json's version, raised by hand with each notable release.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __BUILD_DATE__: JSON.stringify(built),
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    // version.json lets an open tab notice that a newer version was published (see src/lib/version.ts).
    {
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit, built }) });
      },
    },
    // The service worker (pwa/sw.js), with a cache of its own for every build, so a new version replaces the old one.
    {
      name: 'service-worker',
      generateBundle(_options, bundle) {
        const build = `${commit}-${Date.now().toString(36)}`;
        // Saved at once when the service worker is installed, so even the first visit can start offline next time: the
        // app's own scripts and styles and its sounds. The big engine files (Maia's runtime, Stockfish) are saved the
        // first time they are used.
        const sounds = readdirSync(new URL('./public/sounds/sfx', import.meta.url)).map((f) => `sounds/sfx/${f}`);
        const precache = [...Object.keys(bundle).filter((f) => f.startsWith('assets/') && !f.endsWith('.wasm')), ...sounds];
        const source = readFileSync(new URL('./pwa/sw.js', import.meta.url), 'utf8')
          .replace('__BUILD__', build)
          .replace("'__PRECACHE__'", precache.map((f) => JSON.stringify(`./${f}`)).join(', '));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
    },
  ],
  test: {
    environment: 'node',
    // The browser smoke tests (e2e/) run with Playwright, not here.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});

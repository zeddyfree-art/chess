import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset path relative, so the build works both on
// GitHub Pages (https://<user>.github.io/chess/) and from any other folder.
// Shown on the About page, so a bug report can say which version it is about.
const commit = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';
const built = new Date().toISOString().slice(0, 10);

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __BUILD_DATE__: JSON.stringify(built),
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
  ],
  test: {
    environment: 'node',
  },
});

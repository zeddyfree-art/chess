import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset path relative, so the build works both on
// GitHub Pages (https://<user>.github.io/chess/) and from any other folder.
// Shown on the About page, so a bug report can say which version it is about.
const commit = (process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local';

export default defineConfig({
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [react()],
  test: {
    environment: 'node',
  },
});

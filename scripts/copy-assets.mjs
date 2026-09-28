// Copies runtime files that cannot be bundled into public/ so Vite serves them as-is:
// the single-threaded "lite" Stockfish WASM build (a Web Worker).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groups = [
  {
    from: join(root, 'node_modules', 'stockfish', 'bin'),
    to: join(root, 'public', 'stockfish'),
    files: ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'],
  },
];

for (const g of groups) {
  if (!existsSync(g.from)) {
    console.warn(`[copy-assets] ${g.from} not found, skipping`);
    continue;
  }
  mkdirSync(g.to, { recursive: true });
  for (const f of g.files) copyFileSync(join(g.from, f), join(g.to, f));
  console.log('[copy-assets] copied', g.files.join(', '));
}

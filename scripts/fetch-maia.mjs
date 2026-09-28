// Downloads the Maia-3 model (CSSLab, GPL-3.0) into public/maia3 so the site can serve it
// itself. Pinned to a commit and checked against its SHA-256. The app falls back to the
// same pinned URL on GitHub if the file is not there (e.g. during local development).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAIA_URL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/a6e52f5c811ee18863cb2f0e81f2433a5b9905de/public/maia3/maia3_simplified.onnx';
const SHA256 = '405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'maia3', 'maia3_simplified.onnx');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

if (existsSync(dest) && sha(readFileSync(dest)) === SHA256) {
  console.log('[fetch-maia] model already present');
  process.exit(0);
}
const res = await fetch(MAIA_URL);
if (!res.ok) throw new Error(`[fetch-maia] download failed: ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
if (sha(buf) !== SHA256) throw new Error('[fetch-maia] checksum mismatch');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, buf);
console.log(`[fetch-maia] saved ${(buf.length / 1e6).toFixed(1)} MB`);

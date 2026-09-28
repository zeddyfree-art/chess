// Runs the Maia-3 ONNX model off the main thread. The worker also downloads and caches
// the model itself, so the 45 MB never has to pass through (and be copied by) the page.
import * as ort from 'onnxruntime-web/wasm';
import { createStore, get, set } from 'idb-keyval';

let session: ort.InferenceSession | null = null;

type Msg =
  | { type: 'load'; key: string; urls: string[]; sha256: string; size: number }
  | { type: 'run'; id: number; tokens: ArrayBuffer; eloSelf: number; eloOppo: number };

const store = createStore('repertoire-models', 'models');

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(urls: string[], size: number): Promise<Uint8Array> {
  let res: Response | null = null;
  for (const url of urls) {
    res = await fetch(url).catch(() => null);
    // A dev server without the file answers with its HTML page instead.
    if (res?.ok && res.body && !(res.headers.get('content-type') ?? '').includes('text/html')) break;
    res = null;
  }
  if (!res?.body) throw new Error('Could not download Maia. Check your internet connection.');
  // One allocation of the expected size instead of collecting chunks and copying them.
  let buf = new Uint8Array(size);
  let at = 0;
  let reported = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > buf.length) {
      const bigger = new Uint8Array(Math.max(Math.ceil(buf.length * 1.25), at + value.length));
      bigger.set(buf.subarray(0, at));
      buf = bigger;
    }
    buf.set(value, at);
    at += value.length;
    const pct = Math.min(99, Math.floor((at / size) * 100));
    if (pct >= reported + 2) {
      reported = pct;
      postMessage({ type: 'progress', progress: pct });
    }
  }
  return at === buf.length ? buf : buf.slice(0, at);
}

async function readModel(msg: Extract<Msg, { type: 'load' }>): Promise<Uint8Array> {
  const cached = await get(msg.key, store).catch(() => undefined);
  if (cached instanceof Blob) return new Uint8Array(await cached.arrayBuffer());
  if (cached instanceof ArrayBuffer) return new Uint8Array(cached); // stored by an earlier app version
  postMessage({ type: 'status', status: 'downloading' });
  const model = await download(msg.urls, msg.size);
  if ((await sha256(model)) !== msg.sha256) throw new Error('The Maia download was incomplete. Please try again.');
  // A Blob lives on disk rather than in memory.
  await set(msg.key, new Blob([model as Uint8Array<ArrayBuffer>]), store).catch(() => {});
  return model;
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      // GitHub Pages cannot enable cross-origin isolation, so no threads. The .wasm file
      // itself is emitted by Vite next to this worker.
      ort.env.wasm.numThreads = 1;
      let model: Uint8Array | null = await readModel(msg);
      postMessage({ type: 'status', status: 'loading' });
      session = await ort.InferenceSession.create(model, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic',
        // Keep peak memory low (phones and tablets close tabs that use too much).
        enableCpuMemArena: false,
        enableMemPattern: false,
      });
      model = null;
      postMessage({ type: 'ready' });
      return;
    }
    if (!session) throw new Error('Maia is not loaded');
    const out = await session.run({
      tokens: new ort.Tensor('float32', new Float32Array(msg.tokens), [1, 64, 12]),
      elo_self: new ort.Tensor('float32', Float32Array.from([msg.eloSelf]), [1]),
      elo_oppo: new ort.Tensor('float32', Float32Array.from([msg.eloOppo]), [1]),
    });
    const move = new Float32Array(out.logits_move.data as Float32Array);
    const value = new Float32Array(out.logits_value.data as Float32Array);
    postMessage({ type: 'result', id: msg.id, move: move.buffer, value: value.buffer }, { transfer: [move.buffer, value.buffer] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: message || 'Maia failed' });
  }
};

// Maia-3: a human-like chess model (CSSLab, University of Toronto) that predicts which
// move a player of a given rating would make. One 45 MB model covers 600–2600.
// Downloaded once, cached in IndexedDB, run in a Web Worker with ONNX Runtime.
import { create } from 'zustand';
import { createStore, del, get as idbGet, set as idbSet } from 'idb-keyval';
import { keyToFen, posFromFen } from './chess';
import { decodePolicy, decodeValue, encodeBoard, legalMoves, type MovePrediction } from './maiaEncoding';

const MODEL_ID = 'maia3-405bf76c';
const LOCAL_URL = `${import.meta.env.BASE_URL}maia3/maia3_simplified.onnx`;
const FALLBACK_URL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/a6e52f5c811ee18863cb2f0e81f2433a5b9905de/public/maia3/maia3_simplified.onnx';
export const MAIA_DOWNLOAD_MB = 50; // model 45.7 MB + ONNX runtime (3.7 MB compressed)

export const MAIA_MIN = 600;
export const MAIA_MAX = 2600;

type Status = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export const useMaia = create<{ status: Status; progress: number; error: string | null }>()(() => ({
  status: 'idle',
  progress: 0,
  error: null,
}));

const store = typeof indexedDB !== 'undefined' ? createStore('repertoire-models', 'models') : undefined;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: { move: Float32Array; value: Float32Array }) => void; reject: (e: Error) => void }>();

export async function isMaiaDownloaded(): Promise<boolean> {
  if (useMaia.getState().status === 'ready') return true;
  if (!store) return false;
  return !!(await idbGet(MODEL_ID, store).catch(() => undefined));
}

async function fetchModel(): Promise<ArrayBuffer> {
  // Served by this site in production; a dev server without the file answers with its HTML page instead.
  let res = await fetch(LOCAL_URL).catch(() => null);
  if (!res?.ok || (res.headers.get('content-type') ?? '').includes('text/html')) res = await fetch(FALLBACK_URL);
  if (!res.ok || !res.body) throw new Error(`Could not download Maia (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 45_683_686;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    useMaia.setState({ progress: Math.min(99, Math.round((received / total) * 100)) });
  }
  const buf = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.length;
  }
  return buf.buffer;
}

/** Downloads (first time only) and starts Maia. Safe to call repeatedly. */
export function loadMaia(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    try {
      let model = store ? ((await idbGet(MODEL_ID, store).catch(() => undefined)) as ArrayBuffer | undefined) : undefined;
      if (!model) {
        useMaia.setState({ status: 'downloading', progress: 0, error: null });
        model = await fetchModel();
        if (store) await idbSet(MODEL_ID, model, store).catch(() => {});
      }
      useMaia.setState({ status: 'loading', progress: 100 });
      worker = new Worker(new URL('./maia.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'result') {
          pending.get(m.id)?.resolve({ move: new Float32Array(m.move), value: new Float32Array(m.value) });
          pending.delete(m.id);
        } else if (m.type === 'error' && m.id !== undefined) {
          pending.get(m.id)?.reject(new Error(m.message));
          pending.delete(m.id);
        }
      };
      await new Promise<void>((resolve, reject) => {
        const onInit = (e: MessageEvent) => {
          if (e.data.type === 'ready') resolve();
          else if (e.data.type === 'error') reject(new Error(e.data.message));
          worker!.removeEventListener('message', onInit);
        };
        worker!.addEventListener('message', onInit);
        worker!.onerror = (e) => reject(new Error(e.message || 'Maia worker failed'));
        worker!.postMessage({ type: 'init', model }, [model!]);
      });
      useMaia.setState({ status: 'ready', error: null });
    } catch (e) {
      ready = null;
      worker?.terminate();
      worker = null;
      useMaia.setState({ status: 'error', error: (e as Error).message });
      throw e;
    }
  })();
  return ready;
}

export async function removeMaia() {
  worker?.terminate();
  worker = null;
  ready = null;
  if (store) await del(MODEL_ID, store).catch(() => {});
  useMaia.setState({ status: 'idle', progress: 0 });
}

export interface MaiaResult {
  moves: MovePrediction[];
  /** Expected score for White, 0..1. */
  whiteWin: number;
}

/** What would a `eloSelf` player (facing an `eloOppo` player) play here? */
export async function maiaPredict(positionKey: string, eloSelf: number, eloOppo: number): Promise<MaiaResult> {
  await loadMaia();
  const pos = posFromFen(keyToFen(positionKey));
  const legal = legalMoves(pos);
  if (!legal.length) return { moves: [], whiteWin: 0.5 };
  const tokens = encodeBoard(pos);
  const id = ++seq;
  const out = await new Promise<{ move: Float32Array; value: Float32Array }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: 'run', id, tokens: tokens.buffer, eloSelf, eloOppo }, [tokens.buffer]);
  });
  return { moves: decodePolicy(pos, out.move, legal), whiteWin: decodeValue(pos, out.value) };
}

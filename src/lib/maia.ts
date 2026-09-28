// Maia-3: a human-like chess model (CSSLab, University of Toronto) that predicts which
// move a player of a given rating would make. One 45 MB model covers 600–2600.
// The worker downloads it once, caches it in IndexedDB and runs it with ONNX Runtime.
import { create } from 'zustand';
import { createStore, del, keys } from 'idb-keyval';
import { keyToFen, posFromFen } from './chess';
import { decodePolicy, decodeValue, encodeBoard, legalMoves, type MovePrediction } from './maiaEncoding';

const MODEL_ID = 'maia3-405bf76c';
const MODEL_SHA256 = '405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856';
const MODEL_SIZE = 45_683_686;
const LOCAL_URL = `${import.meta.env.BASE_URL}maia3/maia3_simplified.onnx`;
const FALLBACK_URL =
  'https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/a6e52f5c811ee18863cb2f0e81f2433a5b9905de/public/maia3/maia3_simplified.onnx';
export const MAIA_DOWNLOAD_MB = 50; // model 45.7 MB + ONNX runtime (3.7 MB compressed)
const TIMEOUT_MS = 30_000;

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
  return ((await keys(store).catch(() => [])) as IDBValidKey[]).includes(MODEL_ID);
}

/** Tear the worker down after a failure so the next call starts cleanly. */
function reset(message: string) {
  worker?.terminate();
  worker = null;
  ready = null;
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
  useMaia.setState({ status: 'error', error: message });
}

/** Downloads (first time only) and starts Maia. Safe to call repeatedly. */
export function loadMaia(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    useMaia.setState({ status: 'loading', progress: 0, error: null });
    const w = new Worker(new URL('./maia.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    let loaded = false;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') useMaia.setState({ progress: m.progress });
      else if (m.type === 'status') useMaia.setState({ status: m.status });
      else if (m.type === 'ready') {
        loaded = true;
        useMaia.setState({ status: 'ready', progress: 100, error: null });
        resolve();
      } else if (m.type === 'result') {
        pending.get(m.id)?.resolve({ move: new Float32Array(m.move), value: new Float32Array(m.value) });
        pending.delete(m.id);
      } else if (m.type === 'error') {
        if (m.id !== undefined) {
          pending.get(m.id)?.reject(new Error(m.message));
          pending.delete(m.id);
        } else if (!loaded) {
          reset(m.message);
          reject(new Error(m.message));
        }
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      const message = `Maia stopped working${e.message ? ` (${e.message})` : ''}. Please try again.`;
      reset(message);
      if (!loaded) reject(new Error(message));
    };
    w.postMessage({
      type: 'load',
      key: MODEL_ID,
      urls: [new URL(LOCAL_URL, location.href).href, FALLBACK_URL],
      sha256: MODEL_SHA256,
      size: MODEL_SIZE,
    });
  });
  return ready;
}

export async function removeMaia() {
  worker?.terminate();
  worker = null;
  ready = null;
  if (store) await del(MODEL_ID, store).catch(() => {});
  useMaia.setState({ status: 'idle', progress: 0, error: null });
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
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Maia did not answer in time. Please try again.'));
    }, TIMEOUT_MS);
    pending.set(id, {
      resolve: (r) => (clearTimeout(timer), resolve(r)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    worker!.postMessage({ type: 'run', id, tokens: tokens.buffer, eloSelf, eloOppo }, [tokens.buffer]);
  });
  return { moves: decodePolicy(pos, out.move, legal), whiteWin: decodeValue(pos, out.value) };
}

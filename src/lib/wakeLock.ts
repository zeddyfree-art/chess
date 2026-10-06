// Keeps the screen on while games are being analysed, if you ask for it. A phone pauses a web page when the
// screen locks or you switch apps; the analysis then carries on when you come back (finished games are kept).
import { useAnalysisQueue } from './analyzer';

const KEY = 'analysis-keep-awake';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

export function keepAwakeWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let lock: WakeLockSentinelLike | null = null;
let asking = false;

async function update() {
  const want = keepAwakeWanted() && useAnalysisQueue.getState().running && document.visibilityState === 'visible';
  if (want && !lock && !asking) {
    asking = true;
    try {
      const l = (await (navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock.request('screen')) as WakeLockSentinelLike;
      lock = l;
      l.addEventListener('release', () => {
        if (lock === l) lock = null;
      });
    } catch {
      /* not allowed now (e.g. battery saver); the analysis simply goes on while the screen is on */
    } finally {
      asking = false;
    }
  } else if (!want && lock) {
    const l = lock;
    lock = null;
    await l.release().catch(() => {});
  }
}

export function setKeepAwake(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  void update();
}

/** Call once: follows the analysis queue and the page's visibility (a hidden page loses its lock). */
export function initWakeLock() {
  if (!wakeLockSupported) return;
  useAnalysisQueue.subscribe((s, prev) => s.running !== prev.running && void update());
  document.addEventListener('visibilitychange', () => void update());
}

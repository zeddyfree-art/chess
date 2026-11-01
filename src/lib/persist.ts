// Lasting storage: by default a browser may clear a site's data (IndexedDB, where the repertoires live) when the
// device runs low on space, or Safari after weeks without a visit. Asking for persistent storage stops that.
// Chrome, Edge and Safari decide by themselves, without asking you (an installed app or a site you use often gets
// it); Firefox asks with a prompt, so there the app only asks when you press the button in Settings.
import { useEffect, useState } from 'react';

const supported = () => typeof navigator !== 'undefined' && !!navigator.storage?.persist && !!navigator.storage.persisted;
const asksFirst = () => typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Asks for lasting storage. `quietly`: only where the browser does not show a prompt for it. */
export async function keepStorage(quietly: boolean): Promise<boolean> {
  if (!supported()) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    if (quietly && asksFirst()) return false;
    const ok = await navigator.storage.persist();
    changed();
    return ok;
  } catch {
    return false;
  }
}

/** At start-up, and again once the app is installed (which makes browsers more willing). */
export function initPersistence() {
  void keepStorage(true);
  addEventListener('appinstalled', () => void keepStorage(true));
}

export interface StorageState {
  /** Null when the browser cannot tell. */
  persisted: boolean | null;
  /** Bytes this site uses on the device, when known. */
  usage?: number;
  /** Firefox: lasting storage needs your yes. */
  asks: boolean;
}

export function useStorageState(): [StorageState, () => void] {
  const [state, setState] = useState<StorageState>({ persisted: null, asks: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (!supported()) return;
    let alive = true;
    Promise.all([navigator.storage.persisted(), navigator.storage.estimate?.().catch(() => undefined)]).then(([p, est]) => {
      if (alive) setState({ persisted: p, usage: est?.usage, asks: asksFirst() });
    });
    return () => {
      alive = false;
    };
  }, [tick]);
  return [state, () => setTick((t) => t + 1)];
}

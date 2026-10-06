// A tab that stays open for days (typical on a phone) keeps running the version it loaded. Such an old version does
// not know newer data (for instance mistake cards) and cannot show it. So the app checks now and then whether a newer
// version was published, and offers to reload.
import { create } from 'zustand';

export const useUpdate = create<{ available: boolean }>()(() => ({ available: false }));

let lastCheck = 0;

export async function checkForUpdate(force = false): Promise<boolean> {
  if (__APP_COMMIT__ === 'local' || typeof fetch === 'undefined') return false;
  if (!force && Date.now() - lastCheck < 5 * 60_000) return useUpdate.getState().available;
  lastCheck = Date.now();
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const v = (await res.json()) as { commit?: string };
    const available = !!v.commit && v.commit !== __APP_COMMIT__;
    if (available) useUpdate.setState({ available });
    return available;
  } catch {
    return false;
  }
}

/** Call once: checks a little after start, whenever the app comes back to the foreground, and every half hour. */
export function initUpdateCheck() {
  setTimeout(() => void checkForUpdate(true), 5000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkForUpdate());
  setInterval(() => void checkForUpdate(), 30 * 60_000);
}

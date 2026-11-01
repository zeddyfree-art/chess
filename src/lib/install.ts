// Installing the app (a Progressive Web App): the browser offers it when the page has a manifest and a service worker.
// Chrome, Edge and Android announce that with "beforeinstallprompt", which we keep, so a button in Settings can open
// the browser's own install dialog. Safari (iPhone, iPad, Mac) has no such event: there it is Share, Add to Home
// Screen (or Add to Dock), which the app explains instead.
import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Starts listening (at start-up, before the browser fires its event) and registers the service worker. */
export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // no mini-infobar: the app offers it in Settings
    deferred = e as InstallPrompt;
    notify();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {
        /* no offline start then; everything else works */
      });
    });
  }
}

/** Running as the installed app (its own window), not in a browser tab. */
export const isInstalled = () =>
  installedNow ||
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Safari on an iPhone or iPad (also when it calls itself a Mac), where installing goes through the Share menu. */
export const isIosSafari = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);

export type InstallState = 'installed' | 'available' | 'ios' | 'unavailable';

function state(): InstallState {
  if (isInstalled()) return 'installed';
  if (deferred) return 'available';
  if (isIosSafari()) return 'ios';
  return 'unavailable';
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    state,
    () => 'unavailable',
  );
}

/** Opens the browser's install dialog. True when the app was installed. */
export async function installApp(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}

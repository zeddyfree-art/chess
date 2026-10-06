import { useEffect, useState } from 'react';
import { reconnectMessage, useSync, type SaveResult } from '../lib/sync';
import { flushLocal, useApp, useSaveState } from '../lib/store';
import { flushGames } from '../lib/gamesStore';
import { useUpdate } from '../lib/version';
import { Icon } from './Icon';

function ago(t: number | null): string {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Google gives a browser app one hour of access at a time, and asking again needs a tap. So when this device
 *  cannot sync (typically: a phone opened after a while), say so plainly: it may be showing old data. */
export function SyncBanner() {
  const status = useSync((s) => s.status);
  const lastSyncAt = useSync((s) => s.lastSyncAt);
  const showToast = useApp((s) => s.showToast);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (status === 'synced') setLater(false); // show again the next time it pauses
  }, [status]);
  if (later || status !== 'needs-auth') return null;

  const sync = async () => {
    setBusy(true);
    showToast(await reconnectMessage());
    setBusy(false);
  };
  return (
    <div className="sync-banner" role="status">
      <Icon name="cloud" size={18} />
      <div className="sync-banner-text">
        <b>Not synced with Google Drive{lastSyncAt ? ` since ${ago(lastSyncAt)}` : ''}.</b>{' '}
        <span className="muted">
          Changes from your other devices are not on this one yet (and the other way round). Google asks you to confirm about
          once an hour.
        </span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary sm" disabled={busy} onClick={sync}>
          <Icon name="refresh" size={14} /> {busy ? 'Syncing…' : 'Sync now'}
        </button>
        <button className="btn ghost sm" onClick={() => setLater(true)}>
          Later
        </button>
      </div>
    </div>
  );
}

/** A newer version of the app was published while this tab was open: reload to get it (what you did is saved first). */
export function UpdateBanner() {
  const available = useUpdate((s) => s.available);
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  const reload = async () => {
    setBusy(true);
    await Promise.all([flushLocal(), flushGames()]).catch(() => {});
    location.reload();
  };
  return (
    <div className="sync-banner update-banner" role="status">
      <Icon name="refresh" size={18} />
      <div className="sync-banner-text">
        <b>A new version of the app is available.</b>{' '}
        <span className="muted">This tab still runs an older one, which may not show everything your other devices have. Your work is saved first.</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary sm" disabled={busy} onClick={reload}>
          <Icon name="refresh" size={14} /> Reload
        </button>
      </div>
    </div>
  );
}

/** Small status in the top bar: everything is saved on this device, and how Google Drive is doing. */
export function SaveIndicator() {
  const save = useSaveState();
  const sync = useSync();
  const setView = useApp((s) => s.setView);

  if (save.status === 'error') {
    return (
      <button className="save-indicator bad" title={save.error ?? 'Could not save'} onClick={() => setView('settings')}>
        <Icon name="x" size={14} /> <span className="label">Not saved</span>
      </button>
    );
  }

  const drive =
    sync.status === 'off' || sync.status === 'unconfigured'
      ? ''
      : sync.status === 'synced'
        ? ` · Google Drive: synced ${ago(sync.lastSyncAt)}`.trimEnd()
        : sync.status === 'syncing'
          ? ' · Google Drive: syncing…'
          : sync.status === 'pending'
            ? ' · Google Drive: changes waiting to upload'
            : sync.status === 'needs-auth'
              ? ' · Google Drive: paused, click the cloud to reconnect'
              : ` · Google Drive: ${sync.error ?? 'sync error'}`;

  return (
    <span className={`save-indicator ${save.status}`} title={`Saved on this device automatically${drive}`} role="status">
      <Icon name="check" size={14} /> <span className="label">{save.status === 'saving' ? 'Saving…' : 'Saved'}</span>
    </span>
  );
}

/** Toast text after a save. */
export function saveMessage(r: SaveResult): string {
  if (!r.local) return 'Could not save on this device. Download a backup from Settings.';
  switch (r.drive) {
    case 'synced':
      return 'Progress saved and synced to Google Drive';
    case 'needs-auth':
      return 'Progress saved on this device. Google Drive sync is paused: reconnect with the cloud icon.';
    case 'error':
      return `Progress saved on this device. Google Drive sync failed${r.error ? `: ${r.error}` : ''}`;
    default:
      return 'Progress saved';
  }
}

/** Shown when a training session ends. The Google Drive part follows the live sync state, so it turns
 *  green as soon as a reconnect has uploaded the progress. */
export function SavedNote({ state }: { state: SaveResult | 'saving' | null }) {
  const showToast = useApp((s) => s.showToast);
  const live = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const [busy, setBusy] = useState(false);
  if (!state || state === 'saving') return <div className="small faint">Saving your progress…</div>;
  const drive = state.drive === 'off' || state.drive === 'unconfigured' ? 'off' : live;
  const reconnect = async () => {
    setBusy(true);
    showToast(await reconnectMessage());
    setBusy(false);
  };
  return (
    <div className="save-note small">
      <span className={state.local ? 'ok' : 'bad'}>
        {state.local ? '✓ Progress saved on this device' : '⚠ Could not save on this device (download a backup in Settings)'}
      </span>
      {drive === 'synced' && <span className="ok"> · synced to Google Drive</span>}
      {(drive === 'syncing' || drive === 'pending') && <span className="muted"> · syncing to Google Drive…</span>}
      {drive === 'error' && <span className="bad"> · Google Drive sync failed{error ? `: ${error}` : ''}</span>}
      {drive === 'needs-auth' && (
        <>
          <span className="warn"> · not synced to Google Drive yet </span>
          <button className="btn sm" disabled={busy} onClick={reconnect}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </>
      )}
    </div>
  );
}

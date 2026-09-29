import { reconnectDrive, useSync, type SaveResult } from '../lib/sync';
import { useApp, useSaveState } from '../lib/store';
import { Icon } from './Icon';

function ago(t: number | null): string {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
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

/** Shown when a training session ends. */
export function SavedNote({ state }: { state: SaveResult | 'saving' | null }) {
  const showToast = useApp((s) => s.showToast);
  if (!state || state === 'saving') return <div className="small faint">Saving your progress…</div>;
  return (
    <div className="save-note small">
      <span className={state.local ? 'ok' : 'bad'}>
        {state.local ? '✓ Progress saved on this device' : '⚠ Could not save on this device (download a backup in Settings)'}
      </span>
      {state.drive === 'synced' && <span className="ok"> · synced to Google Drive</span>}
      {state.drive === 'error' && (
        <span className="bad"> · Google Drive sync failed{state.error ? `: ${state.error}` : ''}</span>
      )}
      {state.drive === 'needs-auth' && (
        <>
          <span className="bad"> · Google Drive sync is paused </span>
          <button
            className="btn sm"
            onClick={() =>
              reconnectDrive().then(
                () => showToast('Synced to Google Drive'),
                (e) => showToast((e as Error).message),
              )
            }
          >
            Reconnect
          </button>
        </>
      )}
    </div>
  );
}

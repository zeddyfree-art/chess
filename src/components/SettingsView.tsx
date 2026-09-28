import { useEffect, useState } from 'react';
import { googleClientId, setClientIdOverride, type DriveFile } from '../lib/drive';
import { exportPgn, importPgn } from '../lib/pgn';
import { getLichessUser, getToken, logout, RATING_BUCKETS, ratingLabel, setToken, SPEED_LABELS, SPEEDS, startLogin, verifyToken } from '../lib/lichess';
import { isMaiaDownloaded, removeMaia } from '../lib/maia';
import { stats } from '../lib/repertoire';
import { connectDrive, disconnectDrive, driveBackups, loadDriveBackup, reconnectDrive, syncNow, useSync } from '../lib/sync';
import { activeRep, exportBackup, parseBackup, PROFILE_COLORS, profileRating, useApp, type AppData, type Profile } from '../lib/store';
import { ChoiceDialog, type Choice } from './Dialog';
import { Icon } from './Icon';

function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^\w\-. ]+/g, '_').trim() || 'repertoire';

export function timeAgo(t: number | null): string {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString('en-GB');
}

type DialogState = { title: string; body: React.ReactNode; choices: Choice[] } | null;

export function SettingsView() {
  const data = useApp((s) => s.data);
  const rep = useApp(activeRep);
  const { addProfile, updateProfile, deleteProfile, updateRep, renameRepertoire, deleteRepertoire, replaceData, markBackup, showToast } =
    useApp.getState();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);
  const [user, setUser] = useState(getLichessUser());
  const [hasToken, setHasToken] = useState(!!getToken());

  const saveToken = async () => {
    setTokenMsg('Checking…');
    try {
      const name = await verifyToken(tokenInput.trim());
      setToken(tokenInput.trim(), name);
      setUser(name);
      setHasToken(true);
      setTokenInput('');
      setTokenMsg(null);
      showToast(`Connected as ${name}`);
    } catch (e) {
      setTokenMsg((e as Error).message);
    }
  };

  const confirmRestore = (incoming: AppData, source: string) => {
    const moves = incoming.repertoires.reduce((a, r) => a + stats(r).moves, 0);
    setDialog({
      title: 'Restore backup?',
      body: (
        <>
          {source} contains {incoming.profiles.length} profile(s) and {incoming.repertoires.length} repertoire(s) with {moves}{' '}
          moves. <b>Everything currently in the app is replaced</b> (also on your other devices, if Drive sync is on).
        </>
      ),
      choices: [{ label: 'Replace', kind: 'danger', run: () => (replaceData(incoming), showToast('Backup restored')) }],
    });
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      confirmRestore(parseBackup(await file.text()), 'The file');
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const mergePgn = async (file: File | undefined) => {
    if (!file || !rep) return;
    const res = importPgn(rep, await file.text());
    updateRep(rep.id, () => res.rep, 'PGN import');
    showToast(`Added ${res.added} new moves${res.errors.length ? ` (${res.errors.length} warnings)` : ''}`);
  };

  return (
    <div className="stack" style={{ maxWidth: 860, margin: '0 auto', gap: 16 }}>
      <div className="card">
        <div className="section row">
          <h2>Players</h2>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() =>
              addProfile({
                name: 'New player',
                color: PROFILE_COLORS[data.profiles.length % PROFILE_COLORS.length],
                ratings: [1400, 1600, 1800],
                speeds: ['blitz', 'rapid', 'classical'],
                rating: 1500,
              })
            }
          >
            <Icon name="plus" size={16} /> Player
          </button>
        </div>
        {data.profiles.map((p) => (
          <ProfileEditor
            key={p.id}
            profile={p}
            repCount={data.repertoires.filter((r) => r.profileId === p.id).length}
            canDelete={data.profiles.length > 1}
            onChange={(patch) => updateProfile(p.id, patch)}
            onDelete={() =>
              setDialog({
                title: `Delete player ${p.name}?`,
                body: 'All repertoires of this player are deleted as well. Consider downloading a backup first.',
                choices: [{ label: 'Delete', kind: 'danger', run: () => deleteProfile(p.id) }],
              })
            }
          />
        ))}
      </div>

      <SyncCard onRestore={confirmRestore} />

      <div className="card">
        <div className="section">
          <h2>Lichess</h2>
        </div>
        <div className="section stack" style={{ gap: 10 }}>
          <div className="help">
            The Opening Explorer (what is played per rating group) requires a Lichess account since 2026. You log in on
            lichess.org itself (OAuth); this app never sees your password and asks for no extra permissions. The connection is
            stored in this browser only.
          </div>
          {hasToken ? (
            <div className="row">
              <span className="badge mine">
                <Icon name="check" size={12} /> connected{user ? ` as ${user}` : ''}
              </span>
              <span className="spacer" />
              <button
                className="btn"
                onClick={async () => {
                  await logout();
                  setHasToken(false);
                  setUser(null);
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div className="row">
                <button className="btn primary" onClick={() => startLogin()}>
                  Log in with Lichess
                </button>
              </div>
              <div className="field">
                <label>Or: paste a personal API token</label>
                <div className="row">
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    type="password"
                    placeholder="lip_…"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <button className="btn" disabled={!tokenInput.trim()} onClick={saveToken}>
                    Save
                  </button>
                </div>
                <div className="help">
                  Create one at{' '}
                  <a href="https://lichess.org/account/oauth/token/create?description=Repertoire%20trainer" target="_blank" rel="noreferrer">
                    lichess.org/account/oauth/token
                  </a>{' '}
                  — tick <i>no</i> permissions, none are needed.
                </div>
                {tokenMsg && <div className="small muted">{tokenMsg}</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {rep && (
        <div className="card">
          <div className="section">
            <h2>Repertoire: {rep.name}</h2>
          </div>
          <div className="section stack" style={{ gap: 10 }}>
            <div className="field">
              <label>Name</label>
              <input className="input" defaultValue={rep.name} onBlur={(e) => e.target.value.trim() && renameRepertoire(rep.id, e.target.value.trim())} />
            </div>
            <div className="row wrap">
              <button className="btn" onClick={() => download(`${safeName(rep.name)}.pgn`, exportPgn(rep), 'application/x-chess-pgn')}>
                <Icon name="download" size={16} /> Export PGN
              </button>
              <label className="btn">
                <Icon name="upload" size={16} /> Add PGN…
                <input type="file" accept=".pgn,text/plain" hidden onChange={(e) => mergePgn(e.target.files?.[0])} />
              </label>
              <span className="spacer" />
              <button
                className="btn danger"
                onClick={() =>
                  setDialog({
                    title: `Delete ${rep.name}?`,
                    body: `The whole repertoire (${stats(rep).moves} moves) and its training history are deleted.`,
                    choices: [{ label: 'Delete', kind: 'danger', run: () => deleteRepertoire(rep.id) }],
                  })
                }
              >
                <Icon name="trash" size={16} /> Delete
              </button>
            </div>
            <div className="help">
              The PGN export contains all lines as variations and can be loaded into Lichess studies, ChessBase or Chessbook.
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="section">
          <h2>Backup file</h2>
        </div>
        <div className="section stack" style={{ gap: 10 }}>
          <div className="help">
            Everything is stored in this browser (IndexedDB). A backup file contains all players, repertoires and training
            progress.
          </div>
          <div className="row wrap">
            <button
              className="btn"
              onClick={() => {
                download(`repertoire-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(data), 'application/json');
                markBackup();
              }}
            >
              <Icon name="download" size={16} /> Download backup
            </button>
            <label className="btn">
              <Icon name="upload" size={16} /> Restore backup…
              <input type="file" accept=".json,application/json" hidden onChange={(e) => importBackup(e.target.files?.[0])} />
            </label>
            <span className="small muted">Last downloaded: {timeAgo(data.lastBackupAt)}</span>
          </div>
        </div>
      </div>

      <MaiaCard />

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SyncCard({ onRestore }: { onRestore: (d: AppData, source: string) => void }) {
  const sync = useSync();
  const { showToast } = useApp.getState();
  const [backups, setBackups] = useState<DriveFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientInput, setClientInput] = useState('');
  const configured = !!googleClientId();
  const connected = sync.status !== 'off' && sync.status !== 'unconfigured';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="section row">
        <Icon name="cloud" />
        <h2>Sync &amp; automatic backup (Google Drive)</h2>
      </div>
      <div className="section stack" style={{ gap: 10 }}>
        <div className="help">
          Connect Google Drive on each device you use (computer, tablet, phone) and they all share the same repertoires and
          training progress. The app only sees its own folder <b>Repertoire app</b> in your Drive; once a day it also saves a
          dated backup there (the last 30 are kept).
        </div>
        {!configured ? (
          <div className="notice small stack" style={{ gap: 8 }}>
            <div>
              Drive sync is not set up for this site yet. The site owner creates a (free) Google OAuth client ID once — see{' '}
              <a href="https://github.com/zeddyfree-art/chess/blob/HEAD/docs/google-drive-setup.md" target="_blank" rel="noreferrer">
                the setup guide
              </a>
              .
            </div>
            <div className="row">
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Client ID (…apps.googleusercontent.com) — for this browser only"
                value={clientInput}
                onChange={(e) => setClientInput(e.target.value)}
              />
              <button
                className="btn"
                disabled={!clientInput.trim().endsWith('.apps.googleusercontent.com')}
                onClick={() => {
                  setClientIdOverride(clientInput);
                  location.reload();
                }}
              >
                Use
              </button>
            </div>
          </div>
        ) : !connected ? (
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => run(connectDrive)}>
              <Icon name="cloud" size={16} /> Connect Google Drive
            </button>
          </div>
        ) : (
          <>
            <div className="row wrap">
              <SyncBadge />
              {sync.account && <span className="small muted">{sync.account}</span>}
              <span className="small muted">· last sync {timeAgo(sync.lastSyncAt)}</span>
              <span className="spacer" />
              {sync.status === 'needs-auth' ? (
                <button className="btn primary" disabled={busy} onClick={() => run(reconnectDrive)}>
                  Reconnect
                </button>
              ) : (
                <button className="btn" disabled={busy || sync.status === 'syncing'} onClick={() => run(syncNow)}>
                  <Icon name="refresh" size={16} /> Sync now
                </button>
              )}
              <button className="btn ghost" disabled={busy} onClick={() => run(disconnectDrive)}>
                Disconnect
              </button>
            </div>
            {sync.error && <div className="notice error small">{sync.error}</div>}
            <div className="row">
              <button
                className="btn sm"
                disabled={busy || sync.status === 'needs-auth'}
                onClick={() => run(async () => setBackups(await driveBackups()))}
              >
                Show Drive backups
              </button>
            </div>
            {backups && (
              <div className="result-list">
                {backups.length === 0 && <div className="empty">No backups yet.</div>}
                {backups.map((b) => (
                  <div key={b.id} className="result-item" style={{ cursor: 'default' }}>
                    <span className="result-line">{b.name}</span>
                    <span className="small faint">{b.size ? `${Math.round(Number(b.size) / 1024)} KB` : ''}</span>
                    <button
                      className="btn sm"
                      disabled={busy}
                      onClick={() => run(async () => onRestore(await loadDriveBackup(b.id), `The backup ${b.name}`))}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="help">
              Google only hands out one-hour sessions to web apps, so after a break the app may ask you to click{' '}
              <b>Reconnect</b>; your changes are kept locally in the meantime and uploaded right after.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SyncBadge() {
  const status = useSync((s) => s.status);
  const map: Record<string, [string, string]> = {
    synced: ['mine', 'synced'],
    syncing: ['accent', 'syncing…'],
    pending: ['due', 'changes pending'],
    'needs-auth': ['due', 'paused — reconnect'],
    error: ['gap', 'sync error'],
    off: ['', 'not connected'],
    unconfigured: ['', 'not set up'],
  };
  const [cls, label] = map[status] ?? ['', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function MaiaCard() {
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => {
    isMaiaDownloaded().then(setCached);
  }, []);
  return (
    <div className="card">
      <div className="section">
        <h2>Human-like opponent (Maia-3)</h2>
      </div>
      <div className="section stack" style={{ gap: 10 }}>
        <div className="help">
          Practice games use Maia-3 by the CSSLab (University of Toronto): a neural network trained on human games that plays
          like a person of the chosen rating, mistakes included. It is downloaded once (±50 MB) and runs on your device.
        </div>
        <div className="row">
          <span className={`badge ${cached ? 'mine' : ''}`}>{cached ? 'downloaded' : 'not downloaded'}</span>
          <span className="spacer" />
          {cached && (
            <button className="btn sm ghost" onClick={() => removeMaia().then(() => setCached(false))}>
              Remove from this device
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileEditor({
  profile,
  repCount,
  canDelete,
  onChange,
  onDelete,
}: {
  profile: Profile;
  repCount: number;
  canDelete: boolean;
  onChange: (patch: Partial<Profile>) => void;
  onDelete: () => void;
}) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="section stack" style={{ gap: 10 }}>
      <div className="row wrap">
        <div className="avatar" style={{ background: profile.color, width: 28, height: 28, fontSize: 13 }}>
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
        <input className="input" defaultValue={profile.name} onBlur={(e) => e.target.value.trim() && onChange({ name: e.target.value.trim() })} />
        <div className="row" style={{ gap: 4 }}>
          {PROFILE_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => onChange({ color: c })}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: c,
                cursor: 'pointer',
                outline: c === profile.color ? '2px solid var(--text)' : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
        <span className="spacer" />
        <span className="small muted">{repCount} repertoire(s)</span>
        {canDelete && (
          <button className="btn sm icon ghost danger" onClick={onDelete} title="Delete player">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      <div className="field">
        <label className="small">Own rating (approximate)</label>
        <input
          className="input"
          type="number"
          min={400}
          max={3000}
          step={50}
          style={{ width: 120 }}
          defaultValue={profileRating(profile)}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v >= 400 && v <= 3000) onChange({ rating: v });
          }}
        />
      </div>
      <div className="field">
        <label className="small">Opponents' rating groups in the database (average rating of both players)</label>
        <div className="filter-row">
          {RATING_BUCKETS.map((r) => (
            <span key={r} className={`chip ${profile.ratings.includes(r) ? 'on' : ''}`} onClick={() => onChange({ ratings: toggle(profile.ratings, r).sort((a, b) => a - b) })}>
              {ratingLabel(r)}
            </span>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="small">Time controls</label>
        <div className="filter-row">
          {SPEEDS.map((s) => (
            <span key={s} className={`chip ${profile.speeds.includes(s) ? 'on' : ''}`} onClick={() => onChange({ speeds: toggle(profile.speeds, s) })}>
              {SPEED_LABELS[s]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

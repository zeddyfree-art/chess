import { useEffect, useState } from 'react';
import { googleClientId, preloadGoogle, setClientIdOverride, type DriveFile } from '../lib/drive';
import { downloadText, safeName } from '../lib/download';
import { exportPgn } from '../lib/pgn';
import { getLichessUser, getToken, logout, RATING_BUCKETS, ratingLabel, setToken, SPEED_LABELS, SPEEDS, startLogin, verifyToken } from '../lib/lichess';
import { isMaiaDownloaded, removeMaia } from '../lib/maia';
import { stats } from '../lib/repertoire';
import { playSound, setSoundSet, SOUND_SET_NAMES, SOUND_SETS, soundSet, type SoundSet } from '../lib/sound';
import { useOpeningNames } from '../lib/openings';
import { installApp, useInstall } from '../lib/install';
import { keepStorage, useStorageState } from '../lib/persist';
import { BOARD_THEMES, boardBackground, setBoardTheme, useBoardTheme, type BoardThemeName } from '../lib/boardTheme';
import { connectDrive, disconnectDrive, driveBackups, loadDriveBackup, reconnectDrive, syncNow, useSync } from '../lib/sync';
import { useGames } from '../lib/gamesStore';
import { activeRep, exportBackup, lichessRatingOf, parseBackup, PROFILE_COLORS, profileRating, useApp, type AppData, type Profile } from '../lib/store';
import { refreshLichessRating, useLichessRatingState } from '../lib/lichessRating';
import { formatDate } from '../lib/games';
import { ChoiceDialog, type Choice } from './Dialog';
import { Icon } from './Icon';
import { ImportPgnDialog } from './ImportPgnDialog';

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
  const { addProfile, updateProfile, deleteProfile, renameRepertoire, deleteRepertoire, restoreRepertoire, replaceData, markBackup, showToast } =
    useApp.getState();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [importing, setImporting] = useState(false);
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
              <button className="btn" onClick={() => downloadText(`${safeName(rep.name)}.pgn`, exportPgn(rep), 'application/x-chess-pgn')}>
                <Icon name="download" size={16} /> Export PGN
              </button>
              <button className="btn" onClick={() => setImporting(true)}>
                <Icon name="upload" size={16} /> Import PGN…
              </button>
              <span className="spacer" />
              <button
                className="btn danger"
                onClick={() =>
                  setDialog({
                    title: `Delete ${rep.name}?`,
                    body: `The whole repertoire (${stats(rep).moves} moves) and its training history are deleted.`,
                    choices: [
                      {
                        label: 'Delete',
                        kind: 'danger',
                        run: () => {
                          deleteRepertoire(rep.id);
                          showToast(`Deleted “${rep.name}”`, { label: 'Undo', run: () => restoreRepertoire(rep) });
                        },
                      },
                    ],
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
                downloadText(`repertoire-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(data), 'application/json');
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

      <InstallCard />
      <MaiaCard />
      <SoundCard />

      <div className="card">
        <div className="section">
          <h2>About</h2>
        </div>
        <div className="section stack" style={{ gap: 8 }}>
          <div className="help">
            Repertoire is free, open-source software (GPL-3.0). Built on Lichess’ chessground and chessops, Stockfish, Maia-3
            (CSSLab, University of Toronto), ONNX Runtime and FSRS. No account, no tracking: your data stays in your browser
            or in your own Google Drive.
          </div>
          <div className="row wrap small">
            <a href="#about">About this app</a>
            <a href="privacy.html">Privacy Policy</a>
            <a href="terms.html">Terms of Service</a>
            <a href="https://github.com/zeddyfree-art/chess" target="_blank" rel="noreferrer">
              Source code
            </a>
            <a href="https://github.com/zeddyfree-art/chess/issues" target="_blank" rel="noreferrer">
              Report a problem
            </a>
          </div>
        </div>
      </div>

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
      {importing && rep && <ImportPgnDialog rep={rep} onClose={() => setImporting(false)} />}
    </div>
  );
}

/** What this device holds, to compare devices at a glance (they should show the same after a sync). */
function DeviceSummary() {
  const data = useApp((s) => s.data);
  const games = useGames((s) => s.data.games.length);
  const reps = data.repertoires.length;
  const cards = (data.mistakes ?? []).length;
  return (
    <div className="small muted">
      On this device: {reps} {reps === 1 ? 'repertoire' : 'repertoires'}, {cards} mistake {cards === 1 ? 'card' : 'cards'}, {games}{' '}
      {games === 1 ? 'game' : 'games'} · app version {__APP_COMMIT__ === 'local' ? 'local' : __APP_COMMIT__} ({__BUILD_DATE__}). After a sync, your other
      devices should show the same numbers.
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
          training progress, mistake cards and games. The app only sees its own folder <b>Repertoire app</b> in your Drive (with
          the subfolders Sync and Backups); it also saves a dated backup there once a day (the last 30 are kept) and of your games
          once a week.
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
            <button className="btn primary" disabled={busy} onPointerEnter={preloadGoogle} onFocus={preloadGoogle} onClick={() => run(connectDrive)}>
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
            <DeviceSummary />
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

/** Install the app: its own icon and window, and it starts without a network. */
function InstallCard() {
  const state = useInstall();
  const showToast = useApp((s) => s.showToast);
  return (
    <div className="card">
      <div className="section">
        <h2>App and storage on this device</h2>
      </div>
      <div className="section stack" style={{ gap: 10 }}>
        {state === 'installed' ? (
          <div className="row" style={{ gap: 6 }}>
            <Icon name="check" size={16} /> Installed: you are using the app in its own window.
          </div>
        ) : state === 'available' ? (
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn primary" onClick={() => installApp().then((ok) => ok && showToast('Installed'))}>
              <Icon name="download" size={16} /> Install Repertoire
            </button>
            <span className="small muted">Its own icon and window, without the browser around it.</span>
          </div>
        ) : state === 'ios' ? (
          <div>
            On an iPhone or iPad: tap <b>Share</b> (the square with an arrow) and then <b>Add to Home Screen</b>. In Safari on a
            Mac: <b>File → Add to Dock</b>.
          </div>
        ) : (
          <div>
            Use your browser’s install option: in Chrome and Edge the install icon at the right of the address bar (or the
            menu ⋮ → <b>Install Repertoire</b> / <b>Cast, save and share → Install page as app</b>); on Android ⋮ → <b>Add to
            Home screen</b> or <b>Install app</b>. Firefox on a computer cannot install web apps.
          </div>
        )}
        <StorageLine />
        <div className="help">
          The installed app is the same as this site, with the same data on this device (and your Google Drive, when
          connected). It also starts without a network: building, training and playing against Maia work offline; the
          Lichess database, games and syncing need a connection. Updates arrive by themselves.
        </div>
      </div>
    </div>
  );
}

/** Whether the browser keeps this device's data for good, or may clear it when space runs low. */
function StorageLine() {
  const [st, refresh] = useStorageState();
  const showToast = useApp((s) => s.showToast);
  if (st.persisted === null) return null;
  const mb = st.usage !== undefined ? ` (${Math.max(0.1, Math.round(st.usage / 1e5) / 10).toLocaleString()} MB)` : '';
  if (st.persisted)
    return (
      <div className="row small" style={{ gap: 6 }}>
        <Icon name="check" size={14} /> Storage on this device{mb} is lasting: the browser will not clear it to make room.
      </div>
    );
  const ask = () =>
    keepStorage(false).then((ok) => {
      refresh();
      showToast(ok ? 'Storage on this device is now lasting' : 'The browser did not allow it (yet): installing the app usually helps');
    });
  return (
    <div className="row wrap small" style={{ gap: 8 }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        Storage on this device{mb} is not yet lasting: when space runs low, the browser may clear it.{' '}
        {st.asks ? 'Your browser asks before keeping it.' : 'Installing the app, or using it often, usually makes the browser keep it.'} With Google
        Drive sync on, nothing is lost either way.
      </span>
      <button className="btn sm" onClick={ask}>
        Keep my data
      </button>
    </div>
  );
}

/** The board's colours, for every board in the app; kept on this device. */
function BoardThemePicker() {
  const current = useBoardTheme();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small muted">Board</span>
      <div className="board-swatches" role="radiogroup" aria-label="Board colours">
        {(Object.keys(BOARD_THEMES) as BoardThemeName[]).map((name) => {
          const t = BOARD_THEMES[name];
          return (
            <button
              key={name}
              role="radio"
              aria-checked={current === name}
              className={`board-swatch ${current === name ? 'on' : ''}`}
              onClick={() => setBoardTheme(name)}
              title={t.label}
            >
              <span className="board-swatch-squares" style={{ backgroundImage: boardBackground(t) }} />
              <span className="small">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Sound for moves and games: the free SFX set from Lichess, or none. Per device. */
function SoundCard() {
  const [set, setSet] = useState<SoundSet>(soundSet);
  const names = useOpeningNames((s) => s.on);
  const setNames = useOpeningNames((s) => s.set);
  const choose = (s: SoundSet) => {
    setSet(s);
    setSoundSet(s);
    if (s !== 'off') {
      playSound('Move', s);
      setTimeout(() => playSound('Capture', s), 450);
    }
  };
  return (
    <div className="card">
      <div className="section">
        <h2>Sound and display</h2>
      </div>
      <div className="section stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {[...SOUND_SETS, 'off' as const].map((s) => (
            <span key={s} className={`chip ${set === s ? 'on' : ''}`} onClick={() => choose(s)}>
              {SOUND_SET_NAMES[s]}
            </span>
          ))}
          {set !== 'off' && (
            <button className="btn sm ghost" onClick={() => choose(set)} title="Hear a move and a capture">
              <Icon name="play" size={14} /> Listen
            </button>
          )}
        </div>
        <div className="help">
          Moves, captures and checks while you play and train, the start and end of a practice game, and a warning when
          your clock runs low. SFX was made by Enigmahack for Lichess (AGPL-3.0); Wood is made in your browser, with no sound files (from Rookahead, GPL-3.0); Lichess' own default sounds are
          not free to reuse, so they are not here. This choice is kept on this device.
        </div>
        <BoardThemePicker />
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
          Show opening names (Tree, Build, training, games)
        </label>
      </div>
    </div>
  );
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

/** The player's own rating, for the analysis and the opponent's starting level: from Lichess (rapid) when there is a
 *  username, or typed in. */
function OwnRating({ profile, onChange }: { profile: Profile; onChange: (patch: Partial<Profile>) => void }) {
  const state = useLichessRatingState((s) => s[profile.id]);
  const fromLichess = !!profile.lichess && !profile.ratingManual;
  const lr = lichessRatingOf(profile);
  const speed = lr ? (SPEED_LABELS as Record<string, string>)[lr.speed]?.toLowerCase() ?? lr.speed : '';
  return (
    <div className="field">
      <label className="small">Own rating (used by the analysis and as the opponent's level in Play)</label>
      {profile.lichess && (
        <label className="row small" style={{ cursor: 'pointer', fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={fromLichess}
            onChange={(e) => {
              onChange({ ratingManual: e.target.checked ? undefined : true });
              if (e.target.checked) void refreshLichessRating(profile.id, true);
            }}
          />
          From Lichess ({profile.lichess}), rapid
        </label>
      )}
      {fromLichess ? (
        <div className="row wrap small" style={{ gap: 8 }}>
          {lr ? (
            <>
              <b className="num" style={{ fontSize: 16 }}>
                {lr.rating}
                {lr.provisional ? '?' : ''}
              </b>
              <span className="muted">
                Lichess {speed}
                {lr.speed !== 'rapid' ? ' (no rapid games)' : ''} · {lr.games} {lr.games === 1 ? 'game' : 'games'} · updated {formatDate(lr.at)}
              </span>
            </>
          ) : (
            <span className="muted">
              {state === 'loading'
                ? 'Fetching from Lichess…'
                : state === 'none'
                  ? `No rated games found for ${profile.lichess} on Lichess; using ${profileRating(profile)}.`
                  : state === 'error'
                    ? `Lichess could not be reached; using ${profileRating(profile)} for now.`
                    : `Using ${profileRating(profile)} until the Lichess rating is in.`}
            </span>
          )}
          <button className="btn sm ghost" disabled={state === 'loading'} onClick={() => void refreshLichessRating(profile.id, true)}>
            <Icon name="refresh" size={13} /> Refresh
          </button>
        </div>
      ) : (
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
      )}
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
      <OwnRating profile={profile} onChange={onChange} />
      <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="field">
          <label className="small">Lichess username (to fetch your games and rating)</label>
          <input
            className="input"
            style={{ width: 200 }}
            defaultValue={profile.lichess ?? ''}
            placeholder="optional"
            onBlur={(e) => e.target.value.trim() !== (profile.lichess ?? '') && onChange({ lichess: e.target.value.trim() || undefined })}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label className="small">Your names in PGN files of your games (other sites, clubs), comma-separated</label>
          <input
            className="input"
            defaultValue={(profile.aliases ?? []).join(', ')}
            placeholder="optional"
            onBlur={(e) => {
              const aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
              if (aliases.join(',') !== (profile.aliases ?? []).join(',')) onChange({ aliases: aliases.length ? aliases : undefined });
            }}
          />
        </div>
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

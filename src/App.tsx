import { useMemo, useState } from 'react';
import { AuditView } from './components/AuditView';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BuildView } from './components/BuildView';
import { HomeView, NewRepertoireDialog } from './components/HomeView';
import { Icon, type IconName } from './components/Icon';
import { PlayView } from './components/PlayView';
import { SettingsView } from './components/SettingsView';
import { TrainView } from './components/TrainView';
import { TreeView } from './components/TreeView';
import { googleClientId, preloadGoogle } from './lib/drive';
import { useKey } from './lib/hooks';
import { counts } from './lib/srs';
import { activeRep, PROFILE_COLORS, useApp, type View } from './lib/store';
import { connectDrive, reconnectDrive, syncNow, useSync } from './lib/sync';

const NAV: { view: View; label: string; icon: IconName; needsRep: boolean }[] = [
  { view: 'home', label: 'Overview', icon: 'home', needsRep: false },
  { view: 'build', label: 'Build', icon: 'board', needsRep: true },
  { view: 'tree', label: 'Tree', icon: 'tree', needsRep: true },
  { view: 'train', label: 'Train', icon: 'train', needsRep: true },
  { view: 'play', label: 'Play', icon: 'play', needsRep: false },
  { view: 'audit', label: 'Check', icon: 'audit', needsRep: true },
];

export function App() {
  const loaded = useApp((s) => s.loaded);
  const hasProfiles = useApp((s) => s.data.profiles.length > 0);
  const view = useApp((s) => s.view);
  const rep = useApp(activeRep);
  const toast = useApp((s) => s.toast);
  const { undoLast, redoLast, hideToast } = useApp.getState();

  useKey(
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) undoLast();
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) redoLast();
      else return;
      e.preventDefault();
    },
    [],
  );

  if (!loaded) return null;
  if (!hasProfiles) return <Onboarding />;

  const needsRep = NAV.find((n) => n.view === view)?.needsRep;
  let content;
  if (needsRep && !rep) content = <HomeView />;
  else if (view === 'build') content = <BuildView key={rep!.id} />;
  else if (view === 'tree') content = <TreeView key={rep!.id} />;
  else if (view === 'train') content = <TrainView key={rep!.id} />;
  else if (view === 'audit') content = <AuditView key={rep!.id} />;
  else if (view === 'play') content = <PlayView />;
  else if (view === 'settings') content = <SettingsView />;
  else content = <HomeView />;

  return (
    <div className="app">
      <TopBar />
      <main>
        <ErrorBoundary key={view} onReset={() => useApp.getState().setView('home')}>
          {content}
        </ErrorBoundary>
      </main>
      <Footer />
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="btn sm"
              onClick={() => {
                toast.action!.run();
                hideToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="btn sm icon ghost" style={{ color: 'inherit', border: 0 }} onClick={hideToast} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function SyncButton() {
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const setView = useApp((s) => s.setView);
  const showToast = useApp((s) => s.showToast);
  if (status === 'unconfigured' || status === 'off') return null;
  const color =
    status === 'synced' ? 'var(--mine)' : status === 'error' ? 'var(--gap)' : status === 'syncing' ? 'var(--accent)' : 'var(--due)';
  const title =
    status === 'synced'
      ? 'Synced with Google Drive'
      : status === 'syncing'
        ? 'Syncing…'
        : status === 'pending'
          ? 'Changes waiting to sync'
          : status === 'needs-auth'
            ? 'Sync paused — click to reconnect Google Drive'
            : `Sync error: ${error ?? ''}`;
  const click = () => {
    if (status === 'needs-auth') reconnectDrive().catch((e) => showToast((e as Error).message));
    else if (status === 'error') setView('settings');
    else syncNow();
  };
  return (
    <button className="btn icon ghost" onClick={click} title={title} style={{ color }}>
      <Icon name={status === 'syncing' ? 'refresh' : 'cloud'} />
    </button>
  );
}

function TopBar() {
  const data = useApp((s) => s.data);
  const view = useApp((s) => s.view);
  const rep = useApp(activeRep);
  const canUndo = useApp((s) => s.undo.length > 0);
  const canRedo = useApp((s) => s.redo.length > 0);
  const { setView, setActiveProfile, setActiveRep, undoLast, redoLast } = useApp.getState();
  const [creating, setCreating] = useState(false);
  const reps = data.repertoires.filter((r) => r.profileId === data.activeProfileId);
  const due = useMemo(() => (rep ? counts(rep).due : 0), [rep]);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">♞</div>
        <span>Repertoire</span>
      </div>

      {data.profiles.length > 1 && (
        <div className="profile-switch">
          {data.profiles.map((p) => (
            <button key={p.id} className={`profile-pill ${p.id === data.activeProfileId ? 'on' : ''}`} onClick={() => setActiveProfile(p.id)}>
              <span className="avatar" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <select
        className="input rep-select"
        value={rep?.id ?? ''}
        onChange={(e) => {
          if (e.target.value === '__new') setCreating(true);
          else {
            setActiveRep(e.target.value);
            if (view === 'home' || view === 'settings') setView('build');
          }
        }}
      >
        {!rep && <option value="">Choose a repertoire…</option>}
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.side === 'white' ? '♔' : '♚'} {r.name}
          </option>
        ))}
        <option value="__new">+ New repertoire…</option>
      </select>

      <nav className="nav">
        {NAV.map((n) => (
          <button key={n.view} className={view === n.view ? 'on' : ''} disabled={n.needsRep && !rep} onClick={() => setView(n.view)} title={n.label}>
            <Icon name={n.icon} size={16} />
            <span className="label">{n.label}</span>
            {n.view === 'train' && due > 0 && <span className="badge due">{due}</span>}
          </button>
        ))}
      </nav>

      <span className="spacer" />
      <SyncButton />
      <button className="btn icon ghost" disabled={!canUndo} onClick={undoLast} title="Undo (Ctrl+Z)">
        <Icon name="undo" />
      </button>
      <button className="btn icon ghost" disabled={!canRedo} onClick={redoLast} title="Redo (Ctrl+Y)">
        <Icon name="redo" />
      </button>
      <button className={`btn icon ${view === 'settings' ? '' : 'ghost'}`} onClick={() => setView('settings')} title="Settings">
        <Icon name="settings" />
      </button>
      {creating && <NewRepertoireDialog onClose={() => setCreating(false)} />}
    </header>
  );
}

const LEVELS = [
  { label: 'Beginner (up to ±1200)', ratings: [0, 1000, 1200], rating: 1000 },
  { label: 'Club player (±1200–1800)', ratings: [1400, 1600, 1800], rating: 1500 },
  { label: 'Strong (1800+)', ratings: [1800, 2000, 2200], rating: 2000 },
];

function Onboarding() {
  const { addProfile, setActiveProfile, showToast } = useApp.getState();
  const [people, setPeople] = useState([{ name: '', level: 1 }]);
  const [loading, setLoading] = useState(false);
  const driveReady = !!googleClientId();

  const start = () => {
    const created = people
      .filter((p, i) => p.name.trim() || i === 0)
      .map((p, i) =>
        addProfile({
          name: p.name.trim() || 'Me',
          color: PROFILE_COLORS[i % PROFILE_COLORS.length],
          ratings: LEVELS[p.level].ratings,
          speeds: ['blitz', 'rapid', 'classical'],
          rating: LEVELS[p.level].rating,
        }),
      );
    setActiveProfile(created[0].id);
  };

  const loadFromDrive = async () => {
    setLoading(true);
    try {
      await connectDrive();
      if (!useApp.getState().data.profiles.length) showToast('Connected. There is no data in your Drive yet — create a player to start.');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const update = (i: number, patch: Partial<{ name: string; level: number }>) =>
    setPeople((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div style={{ minHeight: '100%', display: 'grid', gridTemplateRows: '1fr auto', padding: 16 }}>
      <div className="card card-pad stack" style={{ width: 'min(560px, 100%)', gap: 16, alignSelf: 'center', justifySelf: 'center' }}>
        <div className="row">
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 26 }}>
            ♞
          </div>
          <div>
            <h2 style={{ fontSize: 22 }}>Opening repertoire</h2>
            <div className="muted">Build, check and train your openings — no move limit.</div>
          </div>
        </div>
        <div className="help">
          Everything stays on your device unless you connect Google Drive. You can add more players later (each with their own
          repertoires, training schedule and database filters) — handy if several people share this device.
        </div>
        {people.map((p, i) => (
          <div key={i} className="field">
            <label>{i === 0 ? 'Your name' : `Player ${i + 1}`}</label>
            <div className="row">
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Name"
                value={p.name}
                autoFocus={i === 0}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <select className="input" value={p.level} onChange={(e) => update(i, { level: Number(e.target.value) })}>
                {LEVELS.map((l, j) => (
                  <option key={j} value={j}>
                    {l.label}
                  </option>
                ))}
              </select>
              {i > 0 && (
                <button className="btn icon ghost" title="Remove" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        <div>
          <button className="btn sm ghost" onClick={() => setPeople((ps) => [...ps, { name: '', level: 1 }])}>
            <Icon name="plus" size={14} /> Add another player
          </button>
        </div>
        <div className="row">
          <span className="help">You can change all of this later in Settings.</span>
          <span className="spacer" />
          <button className="btn primary" onClick={start}>
            Get started
          </button>
        </div>
        {driveReady && (
          <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div className="help">Already using this app on another device?</div>
            <div>
              <button className="btn" disabled={loading} onPointerEnter={preloadGoogle} onFocus={preloadGoogle} onClick={loadFromDrive}>
                <Icon name="cloud" size={16} /> {loading ? 'Loading…' : 'Load my data from Google Drive'}
              </button>
            </div>
          </div>
        )}
      </div>
      <Footer className="site-footer static" />
    </div>
  );
}

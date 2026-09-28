import { useMemo, useState } from 'react';
import { AuditView } from './components/AuditView';
import { BuildView } from './components/BuildView';
import { HomeView, NewRepertoireDialog } from './components/HomeView';
import { Icon, type IconName } from './components/Icon';
import { SettingsView } from './components/SettingsView';
import { TrainView } from './components/TrainView';
import { TreeView } from './components/TreeView';
import { useKey } from './lib/hooks';
import { counts } from './lib/srs';
import { activeRep, PROFILE_COLORS, useApp, type View } from './lib/store';

const NAV: { view: View; label: string; icon: IconName; needsRep: boolean }[] = [
  { view: 'home', label: 'Overzicht', icon: 'home', needsRep: false },
  { view: 'build', label: 'Bouwen', icon: 'board', needsRep: true },
  { view: 'tree', label: 'Boom', icon: 'tree', needsRep: true },
  { view: 'train', label: 'Trainen', icon: 'train', needsRep: true },
  { view: 'audit', label: 'Controle', icon: 'audit', needsRep: true },
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
  else if (view === 'settings') content = <SettingsView />;
  else content = <HomeView />;

  return (
    <div className="app">
      <TopBar />
      <main>{content}</main>
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
          <button className="btn sm icon ghost" style={{ color: 'inherit', border: 0 }} onClick={hideToast} aria-label="Sluiten">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
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
        {!rep && <option value="">Kies een repertoire…</option>}
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.side === 'white' ? '♔' : '♚'} {r.name}
          </option>
        ))}
        <option value="__new">+ Nieuw repertoire…</option>
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
      <button className="btn icon ghost" disabled={!canUndo} onClick={undoLast} title="Ongedaan maken (Ctrl+Z)">
        <Icon name="undo" />
      </button>
      <button className="btn icon ghost" disabled={!canRedo} onClick={redoLast} title="Opnieuw (Ctrl+Y)">
        <Icon name="redo" />
      </button>
      <button className={`btn icon ${view === 'settings' ? '' : 'ghost'}`} onClick={() => setView('settings')} title="Instellingen">
        <Icon name="settings" />
      </button>
      {creating && <NewRepertoireDialog onClose={() => setCreating(false)} />}
    </header>
  );
}

const LEVELS = [
  { label: 'Beginner (tot ±1200)', ratings: [0, 1000, 1200] },
  { label: 'Clubspeler (±1200–1800)', ratings: [1400, 1600, 1800] },
  { label: 'Sterk (1800+)', ratings: [1800, 2000, 2200] },
];

function Onboarding() {
  const { addProfile, setActiveProfile } = useApp.getState();
  const [people, setPeople] = useState([
    { name: '', level: 1 },
    { name: '', level: 0 },
  ]);

  const start = () => {
    const created = people
      .filter((p, i) => p.name.trim() || i === 0)
      .map((p, i) =>
        addProfile({
          name: p.name.trim() || 'Ik',
          color: PROFILE_COLORS[i],
          ratings: LEVELS[p.level].ratings,
          speeds: ['blitz', 'rapid', 'classical'],
        }),
      );
    setActiveProfile(created[0].id);
  };

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card card-pad stack" style={{ width: 'min(560px, 100%)', gap: 16 }}>
        <div className="row">
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 26 }}>
            ♞
          </div>
          <div>
            <h2 style={{ fontSize: 22 }}>Openingsrepertoire</h2>
            <div className="muted">Bouwen, controleren en trainen — zonder zettenlimiet.</div>
          </div>
        </div>
        <div className="help">
          Maak een profiel per speler. Elk profiel heeft eigen repertoires, een eigen trainingsschema en eigen
          databasefilters (welk ratingniveau je tegenstanders hebben).
        </div>
        {people.map((p, i) => (
          <div key={i} className="field">
            <label>{i === 0 ? 'Speler 1' : 'Speler 2 (optioneel)'}</label>
            <div className="row">
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder={i === 0 ? 'Naam' : 'Naam, bv. je dochter'}
                value={p.name}
                autoFocus={i === 0}
                onChange={(e) => setPeople((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <select
                className="input"
                value={p.level}
                onChange={(e) => setPeople((ps) => ps.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) } : x)))}
              >
                {LEVELS.map((l, j) => (
                  <option key={j} value={j}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <div className="row">
          <span className="help">Later aan te passen onder Instellingen.</span>
          <span className="spacer" />
          <button className="btn primary" onClick={start}>
            Beginnen
          </button>
        </div>
      </div>
    </div>
  );
}

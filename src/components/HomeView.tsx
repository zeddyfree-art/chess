import { useMemo, useState } from 'react';
import type { Side } from '../lib/chess';
import { importPgn } from '../lib/pgn';
import { newRepertoire, stats } from '../lib/repertoire';
import { counts } from '../lib/srs';
import { activeProfile, useApp } from '../lib/store';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

export function HomeView() {
  const data = useApp((s) => s.data);
  const profile = useApp(activeProfile);
  const { setActiveRep, setView } = useApp.getState();
  const [creating, setCreating] = useState(false);
  const reps = data.repertoires.filter((r) => r.profileId === data.activeProfileId);

  const summaries = useMemo(() => reps.map((r) => ({ rep: r, stats: stats(r), srs: counts(r) })), [reps]);
  const totalDue = summaries.reduce((a, s) => a + s.srs.due, 0);
  const totalNew = summaries.reduce((a, s) => a + s.srs.fresh, 0);

  if (!profile) return null;

  const open = (id: string, view: 'build' | 'train' | 'tree') => {
    setActiveRep(id);
    setView(view);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row wrap">
        <div>
          <h2 style={{ fontSize: 22 }}>Hi {profile.name}</h2>
          <div className="muted">
            {reps.length === 0
              ? 'Create your first repertoire.'
              : totalDue > 0
                ? `You have ${totalDue} ${totalDue === 1 ? 'move' : 'moves'} to review today.`
                : totalNew > 0
                  ? `Nothing due — ${totalNew} new ${totalNew === 1 ? 'move' : 'moves'} to learn.`
                  : 'All reviews done for today.'}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> New repertoire
        </button>
      </div>

      <div className="home-grid">
        {summaries.map(({ rep, stats: st, srs }) => (
          <div key={rep.id} className={`card rep-card ${rep.id === data.activeRepId ? 'active' : ''}`} onClick={() => open(rep.id, 'build')}>
            <div className="row">
              <div className={`side-icon ${rep.side}`}>{rep.side === 'white' ? '♔' : '♚'}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 15 }}>{rep.name}</div>
                <div className="small muted">{rep.side === 'white' ? 'with White' : 'with Black'}</div>
              </div>
            </div>
            <div className="stat-row">
              <div className="stat">
                <b>{st.moves}</b>
                <span>moves</span>
              </div>
              <div className="stat">
                <b>{st.lineEnds}</b>
                <span>lines</span>
              </div>
              <div className="stat">
                <b style={{ color: srs.due ? 'var(--due)' : undefined }}>{srs.due}</b>
                <span>due</span>
              </div>
              <div className="stat">
                <b style={{ color: srs.fresh ? 'var(--accent)' : undefined }}>{srs.fresh}</b>
                <span>new</span>
              </div>
            </div>
            <div className="progress" title={`${srs.learned} of ${srs.total} moves learned`}>
              <div style={{ width: `${(srs.learned / Math.max(1, srs.total)) * 100}%` }} />
            </div>
            <div className="row" onClick={(e) => e.stopPropagation()}>
              <button className="btn sm" onClick={() => open(rep.id, 'build')}>
                <Icon name="board" size={14} /> Build
              </button>
              <button className="btn sm" onClick={() => open(rep.id, 'tree')}>
                <Icon name="tree" size={14} /> Tree
              </button>
              <span className="spacer" />
              <button className={`btn sm ${srs.due || srs.fresh ? 'primary' : ''}`} onClick={() => open(rep.id, 'train')}>
                <Icon name="train" size={14} /> Train
              </button>
            </div>
          </div>
        ))}
        {reps.length === 0 && (
          <div className="card card-pad stack">
            <b>Tip</b>
            <div className="muted">
              For example, make one repertoire with White and two with Black (against 1.e4 and against 1.d4). Already have a
              repertoire in Chessbook or a Lichess study? Export it as PGN and import it here — there is no limit on the number
              of moves.
            </div>
          </div>
        )}
      </div>

      {creating && <NewRepertoireDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

export function NewRepertoireDialog({ onClose }: { onClose: () => void }) {
  const profileId = useApp((s) => s.data.activeProfileId)!;
  const { addRepertoire, setView, showToast } = useApp.getState();
  const [name, setName] = useState('');
  const [side, setSide] = useState<Side>('white');
  const [pgn, setPgn] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const create = () => {
    let rep = newRepertoire(profileId, name.trim() || (side === 'white' ? 'White' : 'Black'), side);
    if (pgn.trim()) {
      const res = importPgn(rep, pgn);
      if (res.added === 0) {
        setErrors(res.errors.length ? res.errors : ['No moves found in the PGN.']);
        return;
      }
      rep = res.rep;
      showToast(`Imported ${res.added} moves from ${res.games} ${res.games === 1 ? 'game' : 'games'}`);
    }
    addRepertoire(rep);
    setView('build');
    onClose();
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setPgn(await f.text());
    if (!name) setName(f.name.replace(/\.pgn$/i, ''));
  };

  return (
    <Dialog title="New repertoire" onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={side === 'white' ? 'e.g. White: 1.e4' : 'e.g. Black vs 1.d4'}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>You play</label>
        <div className="row">
          <button className={`btn ${side === 'white' ? 'primary' : ''}`} onClick={() => setSide('white')}>
            ♔ White
          </button>
          <button className={`btn ${side === 'black' ? 'primary' : ''}`} onClick={() => setSide('black')}>
            ♚ Black
          </button>
        </div>
      </div>
      <div className="field">
        <label>Import PGN (optional)</label>
        <textarea
          className="input"
          rows={4}
          value={pgn}
          placeholder="Paste a PGN with variations, e.g. an export from Chessbook or a Lichess study…"
          onChange={(e) => setPgn(e.target.value)}
        />
        <input type="file" accept=".pgn,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
        <div className="help">Multiple games/chapters are merged; transpositions are detected automatically.</div>
      </div>
      {errors.length > 0 && <div className="notice error small">{errors.slice(0, 4).join(' · ')}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={create}>
          Create
        </button>
      </div>
    </Dialog>
  );
}

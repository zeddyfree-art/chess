import { useMemo, useState } from 'react';
import type { Side } from '../lib/chess';
import { downloadText, safeName } from '../lib/download';
import { exportPgn, importPgn } from '../lib/pgn';
import { newRepertoire, stats, toMoves, type Repertoire } from '../lib/repertoire';
import { counts, State } from '../lib/srs';
import { activeProfile, useApp } from '../lib/store';
import { useSync } from '../lib/sync';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { ImportPgnDialog } from './ImportPgnDialog';

export function HomeView() {
  const data = useApp((s) => s.data);
  const profile = useApp(activeProfile);
  const { setActiveRep, setView } = useApp.getState();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Repertoire | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
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
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 650, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rep.name}>
                  {rep.name}
                </div>
                <div className="small muted">{rep.side === 'white' ? 'with White' : 'with Black'}</div>
              </div>
              <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn sm icon ghost"
                  title="Download as PGN"
                  aria-label={`Download ${rep.name} as PGN`}
                  onClick={() => downloadRepertoire(rep)}
                >
                  <Icon name="download" size={15} />
                </button>
                <button
                  className="btn sm icon ghost"
                  title="Add lines from a PGN (paste or file)"
                  aria-label={`Add lines to ${rep.name} from a PGN`}
                  onClick={() => setImportingId(rep.id)}
                >
                  <Icon name="upload" size={15} />
                </button>
                <button
                  className="btn sm icon ghost danger"
                  title="Delete repertoire"
                  aria-label={`Delete ${rep.name}`}
                  onClick={() => setDeleting(rep)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
            <div className="stat-row">
              <div
                className="stat"
                title={`${st.moves} moves = ${st.plies} half-moves (${st.myMoves} yours, ${st.oppMoves} from your opponents). One move is White's move plus Black's reply.`}
              >
                <b>{st.moves}</b>
                <span>{st.moves === 1 ? 'move' : 'moves'}</span>
              </div>
              <div className="stat" title="Distinct lines (variations): every route from the start to where your preparation ends">
                <b>{st.lineEnds}</b>
                <span>{st.lineEnds === 1 ? 'line' : 'lines'}</span>
              </div>
              <div className="stat" title="Your moves that are due for review">
                <b style={{ color: srs.due ? 'var(--due)' : undefined }}>{srs.due}</b>
                <span>due</span>
              </div>
              <div className="stat" title="Your moves you have not learned yet">
                <b style={{ color: srs.fresh ? 'var(--accent)' : undefined }}>{srs.fresh}</b>
                <span>new</span>
              </div>
            </div>
            {st.lineEnds > 0 && (
              <div className="small muted">
                {st.myMoves} of your moves to learn · lines average {st.avgLine} moves, longest {st.longest}
              </div>
            )}
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

      {summaries.length > 0 && (
        <div className="help">
          Sizes are counted the way books and PGN do: <b>one move is White’s move plus Black’s reply</b> (1.e4 e5 is one
          move), so a line of 20 half-moves is 10 moves. Hover a number to see the half-moves. <b>Lines</b> are distinct
          variations; <b>due</b> and <b>new</b> count your own moves, which are what you train.
        </div>
      )}

      {creating && <NewRepertoireDialog onClose={() => setCreating(false)} />}
      {deleting && <DeleteRepertoireDialog rep={deleting} onClose={() => setDeleting(null)} />}
      {importingId && reps.find((r) => r.id === importingId) && (
        <ImportPgnDialog rep={reps.find((r) => r.id === importingId)!} onClose={() => setImportingId(null)} />
      )}
    </div>
  );
}

/** All lines as one PGN with variations: opens in Lichess studies, ChessBase, Chessbook and this app. */
export function downloadRepertoire(rep: Repertoire) {
  downloadText(`${safeName(rep.name)}.pgn`, exportPgn(rep), 'application/x-chess-pgn');
  useApp.getState().showToast(`Downloaded ${safeName(rep.name)}.pgn`);
}

function DeleteRepertoireDialog({ rep, onClose }: { rep: Repertoire; onClose: () => void }) {
  const driveOn = useSync((s) => s.status !== 'off' && s.status !== 'unconfigured');
  const st = stats(rep);
  const cards = Object.values(rep.cards);
  const learned = cards.filter((c) => c.state !== State.New).length;

  const confirm = () => {
    const { deleteRepertoire, restoreRepertoire, showToast } = useApp.getState();
    deleteRepertoire(rep.id);
    onClose();
    showToast(`Deleted “${rep.name}”`, { label: 'Undo', run: () => restoreRepertoire(rep) });
  };

  return (
    <Dialog title={`Delete “${rep.name}”?`} onClose={onClose}>
      <div>
        This deletes the whole repertoire: <b>{st.moves}</b> {st.moves === 1 ? 'move' : 'moves'} in <b>{st.lineEnds}</b>{' '}
        {st.lineEnds === 1 ? 'line' : 'lines'}, with your notes and training progress
        {cards.length > 0 && (
          <>
            {' '}
            (<b>{learned}</b> of {cards.length} moves learned)
          </>
        )}
        .{driveOn && ' It is removed from your other devices too, because Google Drive sync is on.'}
      </div>
      <div className="help">You can undo it right after deleting, but not later. Download a copy first if you might want it back.</div>
      <div className="row wrap">
        <button className="btn" onClick={() => downloadRepertoire(rep)}>
          <Icon name="download" size={16} /> Download PGN first
        </button>
        <span className="spacer" />
        <button className="btn ghost" autoFocus onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger solid" onClick={confirm}>
          Delete
        </button>
      </div>
    </Dialog>
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
      showToast(`Imported ${toMoves(res.added)} moves from ${res.games} ${res.games === 1 ? 'game' : 'games'}`);
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
        <div className="help">
          Multiple games/chapters are merged; transpositions are detected automatically. Comments and arrows/circles are kept.
        </div>
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

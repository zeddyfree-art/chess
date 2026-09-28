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
          <h2 style={{ fontSize: 22 }}>Hoi {profile.name}</h2>
          <div className="muted">
            {reps.length === 0
              ? 'Maak je eerste repertoire aan.'
              : totalDue > 0
                ? `Je hebt vandaag ${totalDue} ${totalDue === 1 ? 'zet' : 'zetten'} te herhalen.`
                : totalNew > 0
                  ? `Niets te herhalen — nog ${totalNew} nieuwe ${totalNew === 1 ? 'zet' : 'zetten'} om te leren.`
                  : 'Alles herhaald voor vandaag.'}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Nieuw repertoire
        </button>
      </div>

      <div className="home-grid">
        {summaries.map(({ rep, stats: st, srs }) => (
          <div key={rep.id} className={`card rep-card ${rep.id === data.activeRepId ? 'active' : ''}`} onClick={() => open(rep.id, 'build')}>
            <div className="row">
              <div className={`side-icon ${rep.side}`}>{rep.side === 'white' ? '♔' : '♚'}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 15 }}>{rep.name}</div>
                <div className="small muted">{rep.side === 'white' ? 'met wit' : 'met zwart'}</div>
              </div>
            </div>
            <div className="stat-row">
              <div className="stat">
                <b>{st.moves}</b>
                <span>zetten</span>
              </div>
              <div className="stat">
                <b>{st.lineEnds}</b>
                <span>lijnen</span>
              </div>
              <div className="stat">
                <b style={{ color: srs.due ? 'var(--due)' : undefined }}>{srs.due}</b>
                <span>te herhalen</span>
              </div>
              <div className="stat">
                <b style={{ color: srs.fresh ? 'var(--accent)' : undefined }}>{srs.fresh}</b>
                <span>nieuw</span>
              </div>
            </div>
            <div className="progress" title={`${srs.learned} van ${srs.total} zetten geleerd`}>
              <div style={{ width: `${(srs.learned / Math.max(1, srs.total)) * 100}%` }} />
            </div>
            <div className="row" onClick={(e) => e.stopPropagation()}>
              <button className="btn sm" onClick={() => open(rep.id, 'build')}>
                <Icon name="board" size={14} /> Bouwen
              </button>
              <button className="btn sm" onClick={() => open(rep.id, 'tree')}>
                <Icon name="tree" size={14} /> Boom
              </button>
              <span className="spacer" />
              <button className={`btn sm ${srs.due || srs.fresh ? 'primary' : ''}`} onClick={() => open(rep.id, 'train')}>
                <Icon name="train" size={14} /> Trainen
              </button>
            </div>
          </div>
        ))}
        {reps.length === 0 && (
          <div className="card card-pad stack">
            <b>Tip</b>
            <div className="muted">
              Maak bijvoorbeeld één repertoire met wit en twee met zwart (tegen 1.e4 en tegen 1.d4). Heb je al een repertoire in
              Chessbook of een Lichess-studie? Exporteer het als PGN en importeer het hier — er is geen limiet op het aantal
              zetten.
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
    let rep = newRepertoire(profileId, name.trim() || (side === 'white' ? 'Wit' : 'Zwart'), side);
    if (pgn.trim()) {
      const res = importPgn(rep, pgn);
      if (res.added === 0) {
        setErrors(res.errors.length ? res.errors : ['Geen zetten gevonden in de PGN.']);
        return;
      }
      rep = res.rep;
      showToast(`${res.added} zetten geïmporteerd uit ${res.games} ${res.games === 1 ? 'partij' : 'partijen'}`);
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
    <Dialog title="Nieuw repertoire" onClose={onClose}>
      <div className="field">
        <label>Naam</label>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={side === 'white' ? 'bv. Wit: 1.e4' : 'bv. Zwart tegen 1.d4'}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Je speelt met</label>
        <div className="row">
          <button className={`btn ${side === 'white' ? 'primary' : ''}`} onClick={() => setSide('white')}>
            ♔ Wit
          </button>
          <button className={`btn ${side === 'black' ? 'primary' : ''}`} onClick={() => setSide('black')}>
            ♚ Zwart
          </button>
        </div>
      </div>
      <div className="field">
        <label>PGN importeren (optioneel)</label>
        <textarea
          className="input"
          rows={4}
          value={pgn}
          placeholder="Plak hier een PGN met varianten, bv. een export uit Chessbook of een Lichess-studie…"
          onChange={(e) => setPgn(e.target.value)}
        />
        <input type="file" accept=".pgn,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
        <div className="help">Meerdere partijen/hoofdstukken worden samengevoegd; transposities worden automatisch herkend.</div>
      </div>
      {errors.length > 0 && <div className="notice error small">{errors.slice(0, 4).join(' · ')}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Annuleren
        </button>
        <button className="btn primary" onClick={create}>
          Aanmaken
        </button>
      </div>
    </Dialog>
  );
}

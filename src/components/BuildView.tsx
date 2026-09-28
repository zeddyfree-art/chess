import { useEffect, useMemo, useState } from 'react';
import { moveFromBoard, moveNumber, playSan, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
import { lossLabel } from '../lib/audit';
import { useEvaluation, useExplorer, useKey } from '../lib/hooks';
import {
  addLine,
  countEdges,
  deleteMove,
  deletionImpact,
  edgeId,
  findMove,
  isMine,
  movesAt,
  promoteMove,
  reachable,
  ROOT,
  setMoveComment,
  setNote,
  type Repertoire,
  type RepMove,
} from '../lib/repertoire';
import { State } from '../lib/srs';
import { activeProfile, activeRep, useApp } from '../lib/store';
import { Board, type Shape } from './Board';
import { ChoiceDialog, type Choice } from './Dialog';
import { EnginePanel, EvalBar } from './EnginePanel';
import { ExplorerPanel } from './ExplorerPanel';
import { Icon } from './Icon';

type Tab = 'lichess' | 'masters' | 'engine';

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Opponent moves played in at least this share of games count as gaps when unprepared. */
export const GAP_SHARE = 0.05;

export function BuildView() {
  const rep = useApp(activeRep)!;
  const profile = useApp(activeProfile)!;
  const line = useApp((s) => s.line);
  const ply = useApp((s) => s.ply);
  const { playMove, setPly, updateRep, showToast, undoLast } = useApp.getState();

  const key = ply === 0 ? ROOT : line[ply - 1].to;
  const [orientation, setOrientation] = useState<Side>(rep.side);
  useEffect(() => setOrientation(rep.side), [rep.id, rep.side]);
  const [tab, setTab] = useState<Tab>(() => readPref('build-tab', 'lichess'));
  const [engineOn, setEngineOn] = useState<boolean>(() => readPref('engine-on', true));
  const [hover, setHover] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: React.ReactNode; choices: Choice[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => writePref('build-tab', tab), [tab]);
  useEffect(() => writePref('engine-on', engineOn), [engineOn]);

  const explorerDb = tab === 'masters' ? 'masters' : 'lichess';
  const explorer = useExplorer(key, explorerDb, profile.ratings, profile.speeds, tab !== 'engine');
  const evaluation = useEvaluation(key, engineOn);

  useEffect(() => {
    if (ply === 0) setOpening(null);
    else if (explorer.data?.opening) setOpening(`${explorer.data.opening.eco} · ${explorer.data.opening.name}`);
  }, [explorer.data, ply]);

  const repMoves = movesAt(rep, key);
  const mine = isMine(rep, key);
  const current = line.slice(0, ply);
  const firstUnsaved = current.findIndex((m) => !findMove(rep, m.from, m.uci));
  const unsaved = firstUnsaved < 0 ? 0 : current.length - firstUnsaved;

  const lastMove = useMemo(() => (ply ? uciToArrow(line[ply - 1].uci) : null), [line, ply]);

  const shapes = useMemo<Shape[]>(() => {
    const s: Shape[] = repMoves.map((m) => {
      const [orig, dest] = uciToArrow(m.uci);
      return { orig, dest, brush: mine ? 'green' : 'blue', modifiers: { lineWidth: mine ? 10 : 7 } } as Shape;
    });
    if (tab === 'engine' && engineOn && evaluation?.lines[0]?.uci[0]) {
      const [orig, dest] = uciToArrow(evaluation.lines[0].uci[0]);
      s.push({ orig, dest, brush: 'paleBlue' } as Shape);
    }
    if (hover) {
      const played = explorer.data?.moves.find((m) => m.uci === hover);
      const uci = played ? (playSan(key, played.san)?.uci ?? hover) : hover;
      const [orig, dest] = uciToArrow(uci);
      s.push({ orig, dest, brush: 'yellow' } as Shape);
    }
    return s;
  }, [repMoves, mine, hover, tab, engineOn, evaluation, explorer.data, key]);

  const onBoardMove = (orig: string, dest: string) => {
    const m = moveFromBoard(key, orig, dest);
    if (m) playMove(m);
  };

  const playHere = (san: string) => {
    const m = playSan(key, san);
    if (m) playMove(m);
  };

  const doSave = (steps: PlayedMove[], replace?: { from: string; ucis: string[] }) => {
    const before = countEdges(rep.positions);
    let added = 0;
    updateRep(
      rep.id,
      (r) => {
        let next = r;
        if (replace) for (const u of replace.ucis) next = deleteMove(next, replace.from, u);
        next = addLine(next, steps);
        added = countEdges(next.positions) - before;
        return next;
      },
      'zetten opslaan',
    );
    showToast(
      replace ? 'Zet vervangen' : `${added} ${added === 1 ? 'zet' : 'zetten'} opgeslagen`,
      { label: 'Ongedaan maken', run: undoLast },
    );
  };

  const save = (steps: PlayedMove[]) => {
    const conflict = steps.find((s) => isMine(rep, s.from) && movesAt(rep, s.from).length > 0 && !findMove(rep, s.from, s.uci));
    if (!conflict) return doSave(steps);
    const existing = movesAt(rep, conflict.from);
    const names = existing.map((m) => m.san).join(' / ');
    setDialog({
      title: 'Je hebt hier al een zet',
      body: (
        <>
          In deze stelling speel je nu <b>{names}</b>. Wil je <b>{conflict.san}</b> in plaats daarvan spelen, of beide
          houden? Met één vaste zet per stelling is je repertoire makkelijker te trainen.
        </>
      ),
      choices: [
        { label: 'Beide houden', run: () => doSave(steps) },
        {
          label: `Vervang ${names} door ${conflict.san}`,
          kind: 'danger',
          run: () => doSave(steps, { from: conflict.from, ucis: existing.map((m) => m.uci) }),
        },
      ],
    });
  };

  const discard = () => {
    if (firstUnsaved < 0) return;
    useApp.setState({ line: line.slice(0, firstUnsaved), ply: firstUnsaved });
  };

  const addFromExplorer = (san: string) => {
    const m = playSan(key, san);
    if (!m) return;
    save([...current, m]);
    playMove(m);
  };

  const askDelete = (m: RepMove) => {
    const impact = deletionImpact(rep, key, m.uci);
    setDialog({
      title: `${m.san} verwijderen?`,
      body: (
        <>
          Hiermee verdwijnen <b>{impact.moves}</b> {impact.moves === 1 ? 'zet' : 'zetten'} (de zet en alles erna)
          {impact.cards > 0 && (
            <>
              {' '}
              en <b>{impact.cards}</b> trainingskaart{impact.cards === 1 ? '' : 'en'}
            </>
          )}
          . Stellingen die je via een andere zetvolgorde bereikt blijven bewaard. Je kunt dit ongedaan maken.
        </>
      ),
      choices: [
        {
          label: 'Verwijderen',
          kind: 'danger',
          run: () => {
            updateRep(rep.id, (r) => deleteMove(r, key, m.uci), `${m.san} verwijderd`);
            showToast(`${m.san} en ${impact.moves - 1} vervolgzetten verwijderd`, { label: 'Ongedaan maken', run: undoLast });
          },
        },
      ],
    });
  };

  useKey(
    (e) => {
      if (e.key === 'ArrowLeft') setPly(ply - 1);
      else if (e.key === 'ArrowRight') setPly(ply + 1);
      else if (e.key === 'Home' || e.key === 'ArrowUp') setPly(0);
      else if (e.key === 'End' || e.key === 'ArrowDown') setPly(line.length);
      else if (e.key === 'Enter' && unsaved) save(current);
      else if (e.key === 'Escape' && unsaved) discard();
      else if (e.key === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    },
    [ply, line, unsaved, rep],
  );

  return (
    <div className="build">
      <div>
        <div className="board-area">
          {engineOn && <EvalBar evaluation={evaluation} flipped={orientation === 'black'} />}
          <Board position={key} orientation={orientation} movable="both" lastMove={lastMove} shapes={shapes} onMove={onBoardMove} />
        </div>
        <div className="board-controls">
          <button className="btn icon" onClick={() => setPly(0)} title="Begin (Home)">
            <Icon name="first" />
          </button>
          <button className="btn icon" onClick={() => setPly(ply - 1)} title="Terug (←)">
            <Icon name="prev" />
          </button>
          <button className="btn icon" onClick={() => setPly(ply + 1)} title="Vooruit (→)">
            <Icon name="next" />
          </button>
          <button className="btn icon" onClick={() => setPly(line.length)} title="Einde (End)">
            <Icon name="last" />
          </button>
          <span className="spacer" />
          <span className="legend">
            <span>
              <i style={{ background: 'var(--mine)' }} />
              jouw zet
            </span>
            <span>
              <i style={{ background: 'var(--opp)' }} />
              voorbereid antwoord
            </span>
          </span>
          <button className="btn icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Bord draaien (f)">
            <Icon name="flip" />
          </button>
        </div>
      </div>

      <div className="side-panel">
        <div className="card">
          <div className="section pos-head">
            <span className="opening-name">{opening ?? (ply === 0 ? 'Beginstelling' : ' ')}</span>
            <span className="spacer" />
            <span className={`badge ${mine ? 'mine' : 'opp'}`}>{mine ? 'Jij aan zet' : 'Tegenstander aan zet'}</span>
          </div>
          <LineBar line={line} ply={ply} rep={rep} onJump={setPly} />
          {unsaved > 0 && (
            <div className="section">
              <div className="save-banner">
                <div style={{ flex: 1 }}>
                  <b>
                    {unsaved} nieuwe {unsaved === 1 ? 'zet' : 'zetten'}
                  </b>
                  <div className="small muted">Nog niet in je repertoire</div>
                </div>
                <button className="btn ghost" onClick={discard} title="Esc">
                  Verwerpen
                </button>
                <button className="btn primary" onClick={() => save(current)} title="Enter">
                  <Icon name="check" size={16} /> Opslaan
                </button>
              </div>
            </div>
          )}
          <div className="section stack" style={{ gap: 8 }}>
            <h3>{mine ? 'Jouw zet in deze stelling' : 'Voorbereide antwoorden op de tegenstander'}</h3>
            <RepMoves rep={rep} positionKey={key} moves={repMoves} mine={mine} onPlay={playHere} onDelete={askDelete} />
          </div>
          <NoteEditor rep={rep} positionKey={key} />
        </div>

        <div className="card">
          <div className="section">
            <div className="tabs">
              <button className={tab === 'lichess' ? 'on' : ''} onClick={() => setTab('lichess')}>
                Lichess-partijen
              </button>
              <button className={tab === 'masters' ? 'on' : ''} onClick={() => setTab('masters')}>
                Meesters
              </button>
              <button className={tab === 'engine' ? 'on' : ''} onClick={() => setTab('engine')}>
                Engine
              </button>
            </div>
          </div>
          <div className="section">
            {tab === 'engine' ? (
              <EnginePanel
                evaluation={evaluation}
                enabled={engineOn}
                onToggle={() => setEngineOn((v) => !v)}
                onPlay={playHere}
                onHover={setHover}
                startPly={ply}
              />
            ) : (
              <ExplorerPanel
                positionKey={key}
                result={explorer}
                db={explorerDb}
                profile={profile}
                repSide={rep.side}
                repMoves={repMoves}
                gapShare={GAP_SHARE}
                onPlay={playHere}
                onAdd={addFromExplorer}
                onHover={setHover}
              />
            )}
          </div>
        </div>
        <div className="help">
          <span className="kbd">←</span> <span className="kbd">→</span> door de lijn · <span className="kbd">Enter</span> opslaan ·{' '}
          <span className="kbd">Esc</span> verwerpen · <span className="kbd">f</span> bord draaien · <span className="kbd">Ctrl</span>+
          <span className="kbd">Z</span> ongedaan maken
        </div>
      </div>

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function LineBar({ line, ply, rep, onJump }: { line: PlayedMove[]; ply: number; rep: Repertoire; onJump: (ply: number) => void }) {
  if (!line.length) {
    return (
      <div className="line-bar section faint">Speel een zet op het bord, of klik een zet in de database hieronder.</div>
    );
  }
  return (
    <div className="line-bar section">
      {line.map((m, i) => {
        const saved = !!findMove(rep, m.from, m.uci);
        return (
          <span key={i} style={{ display: 'contents' }}>
            {i % 2 === 0 && <span className="mn">{moveNumber(i)}</span>}
            <button
              className={`line-move ${i === ply - 1 ? 'current' : ''} ${saved ? '' : 'unsaved'} ${i >= ply ? 'future' : ''}`}
              onClick={() => onJump(i + 1)}
            >
              {m.san}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function RepMoves({
  rep,
  positionKey,
  moves,
  mine,
  onPlay,
  onDelete,
}: {
  rep: Repertoire;
  positionKey: string;
  moves: RepMove[];
  mine: boolean;
  onPlay: (san: string) => void;
  onDelete: (m: RepMove) => void;
}) {
  const updateRep = useApp((s) => s.updateRep);
  const [editing, setEditing] = useState<string | null>(null);
  const sizes = useMemo(
    () =>
      moves.map((m) => {
        const live = reachable(rep.positions, m.to);
        let n = 1;
        for (const k of live) n += movesAt(rep, k).length;
        return n;
      }),
    [rep, moves],
  );

  if (!moves.length) {
    return (
      <div className="empty">
        {positionKey === ROOT && !mine
          ? 'Nog leeg. Speel de openingszetten van de tegenstander waartegen je iets wilt voorbereiden.'
          : mine
            ? 'Nog geen zet gekozen. Speel je zet op het bord of kies er een uit de database.'
            : 'Hier eindigt je voorbereiding. Voeg de meest gespeelde antwoorden toe (zie “gat” in de database).'}
      </div>
    );
  }

  const now = Date.now();
  return (
    <div className="rep-moves">
      {mine && moves.length > 1 && (
        <div className="notice small">
          Je hebt hier {moves.length} zetten. Bij het trainen is elk ervan goed; maak er met ★ één hoofdzet van en verwijder de
          rest als je wilt snoeien.
        </div>
      )}
      {moves.map((m, i) => {
        const id = edgeId(positionKey, m.uci);
        const card = rep.cards[id];
        const flag = rep.engine[id];
        const label = flag ? lossLabel(flag.loss) : null;
        return (
          <div key={m.uci} className={`rep-move ${mine ? 'mine' : 'opp'}`}>
            <span className="san" onClick={() => onPlay(m.san)} title="Speel deze zet">
              {m.san}
              {label?.symbol && (
                <span style={{ color: 'var(--gap)' }} title={`Engine: ${(flag!.loss / 100).toFixed(1)} pion slechter dan ${flag!.bestSan}`}>
                  {label.symbol}
                </span>
              )}
            </span>
            <span className="badge">{sizes[i] === 1 ? 'eindpunt' : `${sizes[i]} zetten`}</span>
            {card && card.state !== State.New && card.due <= now && <span className="badge due">te herhalen</span>}
            {card && card.state === State.New && <span className="badge accent">nieuw</span>}
            {flag && label?.tone !== 'ok' && <span className="badge gap">beter: {flag.bestSan}</span>}
            <span className="spacer" />
            {i > 0 && (
              <button
                className="btn sm icon ghost"
                title="Maak hoofdzet (bovenaan)"
                onClick={() => updateRep(rep.id, (r) => promoteMove(r, positionKey, m.uci), 'volgorde')}
              >
                <Icon name="star" size={15} />
              </button>
            )}
            <button className="btn sm icon ghost" title="Commentaar" onClick={() => setEditing(editing === m.uci ? null : m.uci)}>
              <Icon name="comment" size={15} />
            </button>
            <button className="btn sm icon ghost danger" title="Verwijder deze zet en alles erna" onClick={() => onDelete(m)}>
              <Icon name="trash" size={15} />
            </button>
            {(editing === m.uci || m.comment) && (
              <div style={{ flexBasis: '100%' }}>
                {editing === m.uci ? (
                  <input
                    autoFocus
                    className="input"
                    style={{ width: '100%' }}
                    defaultValue={m.comment ?? ''}
                    placeholder="Idee achter de zet, plan, valkuil…"
                    onBlur={(e) => {
                      updateRep(rep.id, (r) => setMoveComment(r, positionKey, m.uci, e.target.value.trim()), 'commentaar');
                      setEditing(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <div className="small muted">{m.comment}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NoteEditor({ rep, positionKey }: { rep: Repertoire; positionKey: string }) {
  const updateRep = useApp((s) => s.updateRep);
  const saved = rep.notes[positionKey] ?? '';
  const [open, setOpen] = useState(!!saved);
  const [text, setText] = useState(saved);
  useEffect(() => {
    setText(saved);
    setOpen(!!saved);
  }, [positionKey, saved]);

  if (!open) {
    return (
      <div className="section">
        <button className="btn sm ghost" onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} /> Notitie bij deze stelling
        </button>
      </div>
    );
  }
  return (
    <div className="section stack" style={{ gap: 6 }}>
      <h3>Notitie</h3>
      <textarea
        className="input"
        rows={2}
        value={text}
        placeholder="Plannen, pionnenstructuur, typische manoeuvres…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== saved && updateRep(rep.id, (r) => setNote(r, positionKey, text), 'notitie', { undoable: false })}
      />
    </div>
  );
}

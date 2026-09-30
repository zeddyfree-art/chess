import { useEffect, useMemo, useRef, useState } from 'react';
import { moveFromBoard, moveNumber, playSan, turnOfKey, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
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
  setMoveNags,
  setNote,
  setShapes,
  toMoves,
  type Repertoire,
  type RepMove,
} from '../lib/repertoire';
import { State } from '../lib/srs';
import { MOVE_NAGS, nagInfo, nagText, nagTitle, POSITION_NAGS, toggleNag } from '../lib/nags';
import { shapesToTokens, tokensToShapes } from '../lib/shapes';
import { activeProfile, activeRep, useApp } from '../lib/store';
import { Board, moveArrow, type Shape } from './Board';
import { ChoiceDialog, type Choice } from './Dialog';
import { EnginePanel, EvalBar } from './EnginePanel';
import { ExplorerPanel } from './ExplorerPanel';
import { Icon } from './Icon';
import { ImportPgnDialog } from './ImportPgnDialog';

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
  const { playMove, setPly, updateRep, showToast, undoLast, trainFrom, playFrom } = useApp.getState();

  const key = ply === 0 ? ROOT : line[ply - 1].to;
  const [orientation, setOrientation] = useState<Side>(rep.side);
  useEffect(() => {
    setOrientation(rep.side);
  }, [rep.id, rep.side]);
  const [tab, setTab] = useState<Tab>(() => readPref('build-tab', 'lichess'));
  const [engineOn, setEngineOn] = useState<boolean>(() => readPref('engine-on', true));
  const [hover, setHover] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: React.ReactNode; choices: Choice[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showDrawings, setShowDrawings] = useState<boolean>(() => readPref('show-drawings', true));

  useEffect(() => {
    writePref('show-drawings', showDrawings);
  }, [showDrawings]);
  useEffect(() => {
    writePref('build-tab', tab);
  }, [tab]);
  useEffect(() => {
    writePref('engine-on', engineOn);
  }, [engineOn]);

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
  const inRepertoire = unsaved === 0 && (key === ROOT || movesAt(rep, key).length > 0 || current.length > 0);

  const lastMove = useMemo(() => (ply ? uciToArrow(line[ply - 1].uci) : null), [line, ply]);

  // Arrows and circles of this position (from PGN comments, or drawn here with the right mouse button).
  const stored = rep.shapes?.[key];
  const drawn = useMemo(() => (showDrawings ? (tokensToShapes(stored) as Shape[]) : undefined), [stored, showDrawings]);
  const onDraw = (all: Shape[]) => {
    setShowDrawings(true);
    updateRep(rep.id, (r) => setShapes(r, key, shapesToTokens(all)), 'drawing', { coalesce: `shapes:${key}` });
  };
  const clearDrawings = () => {
    updateRep(rep.id, (r) => setShapes(r, key, []), 'clear drawings');
    showToast('Drawings cleared', { label: 'Undo', run: undoLast });
  };
  const arrival = ply > 0 ? line[ply - 1] : null;

  // Prepared moves in the colour of the side to move, under the pieces; softer when the position has
  // annotations, so the author's arrows and circles stand out.
  const annotated = showDrawings && !!stored?.length;
  const shapes = useMemo<Shape[]>(() => {
    const turn = turnOfKey(key);
    const s: Shape[] = repMoves.map((m) => moveArrow(m.uci, turn, { soft: annotated, width: mine ? 12 : 9 }));
    if (tab === 'engine' && engineOn && evaluation?.lines[0]?.uci[0]) {
      const [orig, dest] = uciToArrow(evaluation.lines[0].uci[0]);
      s.push({ orig, dest, brush: 'engine' } as Shape);
    }
    if (hover) {
      const played = explorer.data?.moves.find((m) => m.uci === hover);
      const uci = played ? (playSan(key, played.san)?.uci ?? hover) : hover;
      const [orig, dest] = uciToArrow(uci);
      s.push({ orig, dest, brush: 'pointer' } as Shape);
    }
    return s;
  }, [repMoves, mine, annotated, hover, tab, engineOn, evaluation, explorer.data, key]);

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
      'save moves',
    );
    showToast(
      replace ? 'Move replaced' : `${toMoves(added)} ${toMoves(added) === 1 ? 'move' : 'moves'} saved`,
      { label: 'Undo', run: undoLast },
    );
  };

  const save = (steps: PlayedMove[]) => {
    const conflict = steps.find((s) => isMine(rep, s.from) && movesAt(rep, s.from).length > 0 && !findMove(rep, s.from, s.uci));
    if (!conflict) return doSave(steps);
    const existing = movesAt(rep, conflict.from);
    const names = existing.map((m) => m.san).join(' / ');
    setDialog({
      title: 'You already have a move here',
      body: (
        <>
          In this position you currently play <b>{names}</b>. Do you want to play <b>{conflict.san}</b> instead, or keep
          both? One fixed move per position makes a repertoire easier to train.
        </>
      ),
      choices: [
        { label: 'Keep both', run: () => doSave(steps) },
        {
          label: `Replace ${names} with ${conflict.san}`,
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
      title: `Delete ${m.san}?`,
      body: (
        <>
          This removes <b>{impact.moves}</b> {impact.moves === 1 ? 'move' : 'moves'} (the move and everything after it)
          {impact.cards > 0 && (
            <>
              {' '}
              and <b>{impact.cards}</b> training card{impact.cards === 1 ? '' : 's'}
            </>
          )}
          . Positions you also reach through another move order are kept. You can undo this.
        </>
      ),
      choices: [
        {
          label: 'Delete',
          kind: 'danger',
          run: () => {
            updateRep(rep.id, (r) => deleteMove(r, key, m.uci), `${m.san} deleted`);
            showToast(`Deleted ${m.san} and everything after it (${impact.moves} ${impact.moves === 1 ? 'move' : 'moves'})`, { label: 'Undo', run: undoLast });
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
          <Board position={key} orientation={orientation} movable="both" lastMove={lastMove} shapes={shapes} drawn={drawn} onDraw={onDraw} onMove={onBoardMove} />
        </div>
        <div className="board-controls">
          <button className="btn icon" onClick={() => setPly(0)} title="Start (Home)">
            <Icon name="first" />
          </button>
          <button className="btn icon" onClick={() => setPly(ply - 1)} title="Back (←)">
            <Icon name="prev" />
          </button>
          <button className="btn icon" onClick={() => setPly(ply + 1)} title="Forward (→)">
            <Icon name="next" />
          </button>
          <button className="btn icon" onClick={() => setPly(line.length)} title="End (End)">
            <Icon name="last" />
          </button>
          <span className="spacer" />
          <span className="legend" title="Prepared moves are drawn in the colour of the side that plays them, under the pieces">
            <span>
              <i className="side-dot white" />
              White
            </span>
            <span>
              <i className="side-dot black" />
              Black
            </span>
            {tab === 'engine' && engineOn && (
              <span>
                <i style={{ background: '#7a3db8' }} />
                engine
              </span>
            )}
          </span>
          <button
            className="btn icon"
            aria-pressed={showDrawings}
            onClick={() => setShowDrawings((v) => !v)}
            title={showDrawings ? 'Hide arrows and circles' : 'Show arrows and circles'}
          >
            <Icon name="eye" />
            {!!stored?.length && <span className="pip">{stored.length}</span>}
          </button>
          {!!stored?.length && showDrawings && (
            <button className="btn icon" onClick={clearDrawings} title="Clear the arrows and circles on this position">
              <Icon name="x" />
            </button>
          )}
          <button className="btn icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip board (f)">
            <Icon name="flip" />
          </button>
        </div>
      </div>

      <div className="side-panel">
        <div className="card">
          <div className="section pos-head">
            <span className="opening-name">{opening ?? (ply === 0 ? 'Starting position' : ' ')}</span>
            <span className="spacer" />
            <span className={`badge ${mine ? 'mine' : 'opp'}`}>{mine ? 'Your move' : 'Opponent to move'}</span>
            <div className="row" style={{ flexBasis: '100%', gap: 6 }}>
              <button
                className="btn sm"
                disabled={!inRepertoire}
                title={inRepertoire ? 'Train the branch that starts here' : 'Save this line first'}
                onClick={() => trainFrom(key)}
              >
                <Icon name="train" size={14} /> Train from here
              </button>
              <button className="btn sm" title="Play a practice game from this position" onClick={() => playFrom(current)}>
                <Icon name="play" size={14} /> Play from here
              </button>
              <span className="spacer" />
              <button className="btn sm ghost" title="Add lines from a PGN (paste or file)" onClick={() => setImporting(true)}>
                <Icon name="upload" size={14} /> Add PGN
              </button>
            </div>
          </div>
          <LineBar line={line} ply={ply} rep={rep} onJump={setPly} />
          {arrival && <ArrivalComment rep={rep} move={arrival} ply={ply} />}
          {unsaved > 0 && (
            <div className="section">
              <div className="save-banner">
                <div style={{ flex: 1 }}>
                  <b>
                    {unsaved} new {unsaved === 1 ? 'move' : 'moves'}
                  </b>
                  <div className="small muted">Not in your repertoire yet</div>
                </div>
                <button className="btn ghost" onClick={discard} title="Esc">
                  Discard
                </button>
                <button className="btn primary" onClick={() => save(current)} title="Enter">
                  <Icon name="check" size={16} /> Save
                </button>
              </div>
            </div>
          )}
          <div className="section stack" style={{ gap: 8 }}>
            <h3>{mine ? 'Your move in this position' : 'Prepared replies to the opponent'}</h3>
            <RepMoves rep={rep} positionKey={key} moves={repMoves} mine={mine} onPlay={playHere} onDelete={askDelete} />
          </div>
          <NoteEditor rep={rep} positionKey={key} />
        </div>

        <div className="card">
          <div className="section">
            <div className="tabs">
              <button className={tab === 'lichess' ? 'on' : ''} onClick={() => setTab('lichess')}>
                Lichess games
              </button>
              <button className={tab === 'masters' ? 'on' : ''} onClick={() => setTab('masters')}>
                Masters
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
          <span className="kbd">←</span> <span className="kbd">→</span> move through the line · <span className="kbd">Enter</span> save ·{' '}
          <span className="kbd">Esc</span> discard · <span className="kbd">f</span> flip board · <span className="kbd">Ctrl</span>+
          <span className="kbd">Z</span> undo
          <br />
          Draw on the board like on Lichess: right-click and drag for an arrow, right-click a square for a circle (with{' '}
          <span className="kbd">Shift</span> red, <span className="kbd">Alt</span> blue). They are saved with the position.
        </div>
      </div>

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
      {importing && <ImportPgnDialog rep={rep} onClose={() => setImporting(false)} />}
    </div>
  );
}

function LineBar({ line, ply, rep, onJump }: { line: PlayedMove[]; ply: number; rep: Repertoire; onJump: (ply: number) => void }) {
  if (!line.length) {
    return (
      <div className="line-bar section faint">Play a move on the board, or click a move in the database below.</div>
    );
  }
  return (
    <div className="line-bar section">
      {line.map((m, i) => {
        const edge = findMove(rep, m.from, m.uci);
        const saved = !!edge;
        return (
          <span key={i} style={{ display: 'contents' }}>
            {i % 2 === 0 && <span className="mn">{moveNumber(i)}</span>}
            <button
              className={`line-move ${i === ply - 1 ? 'current' : ''} ${saved ? '' : 'unsaved'} ${i >= ply ? 'future' : ''}`}
              onClick={() => onJump(i + 1)}
            >
              {m.san}
              {nagText(edge?.nags).move}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** A move's annotation symbols: "!?" and the like, then the position symbols ("±"). */
function Nags({ nags }: { nags?: number[] }) {
  const t = nagText(nags);
  if (!t.move && !t.rest) return null;
  return (
    <span className="nag" title={nagTitle(nags)}>
      {t.move}
      {t.move && t.rest ? ' ' : ''}
      {t.rest}
    </span>
  );
}

/** Buttons for the symbols of one move; choosing one replaces the other of its kind. */
function NagPicker({ nags, onChange }: { nags: number[]; onChange: (next: number[]) => void }) {
  const button = (n: number) => (
    <button key={n} className="btn sm" aria-pressed={nags.includes(n)} title={nagInfo(n).text} onClick={() => onChange(toggleNag(nags, n))}>
      {nagInfo(n).symbol}
    </button>
  );
  return (
    <div className="nag-picker">
      <div className="row wrap" style={{ gap: 4 }}>
        <span className="small muted">Move</span>
        {MOVE_NAGS.map(button)}
      </div>
      <div className="row wrap" style={{ gap: 4 }}>
        <span className="small muted">Position</span>
        {POSITION_NAGS.map(button)}
      </div>
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
  // `sizes` are half-moves; the badge shows full moves, with the exact count on hover.

  if (!moves.length) {
    return (
      <div className="empty">
        {positionKey === ROOT && !mine
          ? 'Empty so far. Play the opponent’s first moves you want to prepare against.'
          : mine
            ? 'No move chosen yet. Play your move on the board or pick one from the database.'
            : 'Your preparation ends here. Add the most common replies (look for “gap” in the database).'}
      </div>
    );
  }

  const now = Date.now();
  return (
    <div className="rep-moves">
      {mine && moves.length > 1 && (
        <div className="notice small">
          You have {moves.length} moves here. In training each of them counts as correct; use ★ to make one the main move and
          delete the others if you want to prune.
        </div>
      )}
      {moves.map((m, i) => {
        const id = edgeId(positionKey, m.uci);
        const card = rep.cards[id];
        const flag = rep.engine[id];
        const label = flag ? lossLabel(flag.loss) : null;
        return (
          <div key={m.uci} className={`rep-move ${mine ? 'mine' : 'opp'}`}>
            <span className="san" onClick={() => onPlay(m.san)} title="Play this move">
              <i className={`side-dot ${turnOfKey(positionKey)}`} />
              {m.san}
              <Nags nags={m.nags} />
              {label?.symbol && (
                <span style={{ color: 'var(--gap)' }} title={`Engine: ${(flag!.loss / 100).toFixed(1)} pawns worse than ${flag!.bestSan}`}>
                  {label.symbol}
                </span>
              )}
            </span>
            <span className="badge" title={`${sizes[i]} half-moves in this branch`}>
              {sizes[i] === 1 ? 'line end' : `${toMoves(sizes[i])} ${toMoves(sizes[i]) === 1 ? 'move' : 'moves'}`}
            </span>
            {card && card.state !== State.New && card.due <= now && <span className="badge due">due</span>}
            {card && card.state === State.New && <span className="badge accent">new</span>}
            {flag && label?.tone !== 'ok' && <span className="badge gap">better: {flag.bestSan}</span>}
            <span className="spacer" />
            {i > 0 && (
              <button
                className="btn sm icon ghost"
                title="Make main move (move to top)"
                onClick={() => updateRep(rep.id, (r) => promoteMove(r, positionKey, m.uci), 'reorder')}
              >
                <Icon name="star" size={15} />
              </button>
            )}
            <button className="btn sm icon ghost" title="Comment" onClick={() => setEditing(editing === m.uci ? null : m.uci)}>
              <Icon name="comment" size={15} />
            </button>
            <button className="btn sm icon ghost danger" title="Delete this move and everything after it" onClick={() => onDelete(m)}>
              <Icon name="trash" size={15} />
            </button>
            {(editing === m.uci || m.comment) && (
              <div style={{ flexBasis: '100%' }}>
                {editing === m.uci ? (
                  <CommentEditor
                    initial={m.comment ?? ''}
                    onSave={(text) => {
                      updateRep(rep.id, (r) => setMoveComment(r, positionKey, m.uci, text), 'comment');
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <CommentText key={m.comment} text={m.comment!} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Multi-line comment box; saves when you leave it (or Ctrl+Enter), Esc cancels. */
function CommentEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const cancelled = useRef(false);
  return (
    <textarea
      autoFocus
      className="input"
      style={{ width: '100%' }}
      rows={Math.min(12, Math.max(3, Math.ceil(initial.length / 55) + initial.split('\n').length - 1))}
      defaultValue={initial}
      placeholder="Idea behind the move, plan, trap…"
      onBlur={(e) => (cancelled.current ? onCancel() : onSave(e.target.value.trim()))}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true;
          (e.target as HTMLTextAreaElement).blur();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

/** A comment with its paragraphs; long ones (book chapters) are folded. */
function CommentText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420 || text.split('\n').length > 8;
  return (
    <div>
      <div className={`comment-text small muted ${long && !open ? 'clamped' : ''}`}>{text}</div>
      {long && (
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** The comment of the move that led to this position: what a book says about the position you are looking at. */
function ArrivalComment({ rep, move, ply }: { rep: Repertoire; move: PlayedMove; ply: number }) {
  const updateRep = useApp((s) => s.updateRep);
  const saved = findMove(rep, move.from, move.uci);
  const [editing, setEditing] = useState(false);
  const [symbols, setSymbols] = useState(false);
  useEffect(() => {
    setEditing(false);
  }, [move.from, move.uci]);
  if (!saved) return null;
  return (
    <div className="section stack arrival" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="arrival-move">
          {moveNumber(ply - 1, true)} {saved.san}
          <Nags nags={saved.nags} />
        </span>
        <span className="spacer" />
        <button
          className="btn sm ghost"
          aria-pressed={symbols}
          onClick={() => setSymbols((v) => !v)}
          title="Annotation symbols: !, ?!, ±, …"
        >
          !?
        </button>
        {!editing && (
          <button className="btn sm ghost" onClick={() => setEditing(true)} title={saved.comment ? 'Edit this comment' : 'Comment on this move'}>
            <Icon name="comment" size={14} /> {saved.comment ? 'Edit' : 'Add comment'}
          </button>
        )}
      </div>
      {symbols && (
        <NagPicker
          nags={saved.nags ?? []}
          onChange={(next) => updateRep(rep.id, (r) => setMoveNags(r, move.from, move.uci, next), 'symbol', { coalesce: `nags:${move.from}|${move.uci}` })}
        />
      )}
      {editing ? (
        <CommentEditor
          initial={saved.comment ?? ''}
          onSave={(text) => {
            updateRep(rep.id, (r) => setMoveComment(r, move.from, move.uci, text), 'comment');
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        saved.comment && <CommentText key={saved.comment} text={saved.comment} />
      )}
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
          <Icon name="plus" size={14} /> Note for this position
        </button>
      </div>
    );
  }
  return (
    <div className="section stack" style={{ gap: 6 }}>
      <h3>Note</h3>
      <textarea
        className="input"
        rows={2}
        value={text}
        placeholder="Plans, pawn structure, typical manoeuvres…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== saved && updateRep(rep.id, (r) => setNote(r, positionKey, text), 'note', { undoable: false })}
      />
    </div>
  );
}

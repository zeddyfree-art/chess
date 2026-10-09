import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, lichessAnalysisUrl, lineFromSans, moveFromBoard, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
import {
  edgeId,
  findPath,
  inTrainDepth,
  isMine,
  maxMyMoveNumber,
  moveNumberAt,
  movesAt,
  myEdgesInOrder,
  reachable,
  ROOT,
  setPaused,
  setTrainDepth,
  type PathStep,
  type Repertoire,
} from '../lib/repertoire';
import { buildQueue, counts, formatInterval, gradeCard, Rating, resetCards, State, type TrainItem } from '../lib/srs';
import { activeRep, useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { tokensToShapes } from '../lib/shapes';
import { Board, moveArrow, sideCircle, type Shape } from './Board';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { LineReviewSession } from './LineReview';
import { DeckTabs, MistakesTrain } from './MistakesTrain';
import { SavedNote, saveMessage } from './SaveIndicator';

type Mode = 'review' | 'lines' | 'line-review';

/** Two decks: the moves of the selected repertoire, and the mistakes from your own games. */
export function TrainView() {
  const rep = useApp(activeRep);
  const deck = useApp((s) => s.trainDeck);
  if (!rep || deck === 'mistakes') return <MistakesTrain />;
  return <RepertoireTrain rep={rep} />;
}

function RepertoireTrain({ rep }: { rep: Repertoire }) {
  const scope = useApp((s) => s.trainScope);
  const trainFrom = useApp((s) => s.trainFrom);
  const [mode, setMode] = useState<Mode | null>(null);
  const [newLimit, setNewLimit] = useState(() => Number(localStorage.getItem('new-limit') ?? 10));
  useEffect(() => {
    localStorage.setItem('new-limit', String(newLimit));
  }, [newLimit]);
  // Review in whole lines instead of one card at a time (remembered on this device).
  const [wholeLines, setWholeLines] = useState(() => localStorage.getItem('train-whole-lines') === '1');
  useEffect(() => {
    localStorage.setItem('train-whole-lines', wholeLines ? '1' : '0');
  }, [wholeLines]);
  // Freeze the queue when a session starts so grading doesn't reshuffle it.
  const [queue, setQueue] = useState<QItem[]>([]);

  const scopePath = useMemo(() => (scope ? findPath(rep, scope) : []), [rep, scope]);
  const scopeKeys = useMemo(() => (scope && scopePath ? reachable(rep.positions, scope) : undefined), [rep, scope, scopePath]);
  const allBranchEdges = useMemo(() => myEdgesInOrder(rep).filter((e) => !scopeKeys || scopeKeys.has(e.from)), [rep, scopeKeys]);
  // Only up to the repertoire's training depth: the deeper moves wait.
  const branchEdges = useMemo(() => {
    const inDepth = inTrainDepth(rep);
    return allBranchEdges.filter((e) => inDepth(e.from));
  }, [rep, allBranchEdges]);
  const maxMove = useMemo(() => maxMyMoveNumber(rep), [rep]);
  const updateRep = useApp((s) => s.updateRep);
  const setDepth = (d: number | undefined) =>
    updateRep(rep.id, (r) => setTrainDepth(r, d && d < maxMove ? d : undefined), 'training depth', { undoable: false });
  const [resetting, setResetting] = useState(false);
  const togglePause = () => {
    updateRep(rep.id, (r) => setPaused(r, !rep.paused), rep.paused ? 'resume training' : 'pause training', { undoable: false });
    useApp.getState().showToast(rep.paused ? `Training of “${rep.name}” resumed` : `Training of “${rep.name}” paused`);
  };

  // The branch may have disappeared (pruned, or synced from another device).
  const lost = !!scope && !scopePath;
  useEffect(() => {
    if (lost) trainFrom(null);
  }, [lost, trainFrom]);
  if (lost) return null;
  if (mode === 'review') return <ReviewSession rep={rep} initial={queue} onExit={() => setMode(null)} />;
  if (mode === 'line-review') return <LineReviewSession rep={rep} items={queue} start={scopePath ?? []} onExit={() => setMode(null)} />;
  if (mode === 'lines') return <LinesSession rep={rep} start={scopePath ?? []} depth={rep.trainDepth} onExit={() => setMode(null)} />;

  const now = Date.now();
  const c = { due: 0, fresh: 0, learned: 0 };
  for (const e of branchEdges) {
    const card = rep.cards[edgeId(e.from, e.uci)];
    if (!card) continue;
    if (card.state === State.New) c.fresh++;
    else {
      c.learned++;
      if (card.due <= now) c.due++;
    }
  }
  const total = c.fresh + c.learned;
  const deeper = allBranchEdges.length - branchEdges.length;
  const depth = rep.trainDepth;

  const startReview = () => {
    setQueue(buildQueue(rep, { newLimit, subtreeOf: scopeKeys }).map((i) => ({ ...i, kind: i.isNew ? 'learn' : 'review' })));
    setMode(wholeLines ? 'line-review' : 'review');
  };

  const startDrill = () => {
    setQueue(
      branchEdges.map((e) => {
        const id = edgeId(e.from, e.uci);
        const isNew = rep.cards[id]?.state === State.New;
        return { id, from: e.from, uci: e.uci, san: e.san, isNew, kind: isNew ? 'learn' : 'review' };
      }),
    );
    setMode('review');
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }} className="stack">
      <DeckTabs />
      <div className="card card-pad stack">
        <div className="row wrap">
          <h2>Train: {rep.name}</h2>
          <span className="spacer" />
          {scope && (
            <button className="btn sm ghost" onClick={() => trainFrom(null)}>
              <Icon name="x" size={14} /> Whole repertoire
            </button>
          )}
        </div>
        {scope && (
          <div className="notice small">
            Only the branch after <b>{formatLine((scopePath ?? []).map((p) => p.san))}</b>
          </div>
        )}
        {rep.paused && (
          <div className="notice row wrap" style={{ gap: 8 }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b>Training paused.</b> This repertoire asks for no reviews and does not count as due. Practice lines still work.
            </span>
            <button className="btn sm primary" onClick={togglePause}>
              <Icon name="train" size={14} /> Resume
            </button>
          </div>
        )}
        {maxMove > 1 && allBranchEdges.length > 0 && (
          <DepthSetting depth={depth} maxMove={maxMove} total={total} fresh={c.fresh} deeper={deeper} onChange={setDepth} />
        )}
        {total === 0 ? (
          <div className="empty">
            {deeper > 0
              ? `This branch starts after move ${depth}, how deep you train this repertoire. Go deeper to train it.`
              : scope
                ? 'There are none of your moves in this branch yet.'
                : 'No moves to train yet. Build your repertoire first.'}
          </div>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat">
                <b style={{ color: 'var(--due)' }}>{c.due}</b>
                <span>due</span>
              </div>
              <div className="stat">
                <b style={{ color: 'var(--accent)' }}>{c.fresh}</b>
                <span>new</span>
              </div>
              <div className="stat">
                <b>{c.learned}</b>
                <span>learned</span>
              </div>
            </div>
            <div className="progress" title="Share of your moves you have learned">
              <div style={{ width: `${(c.learned / Math.max(1, total)) * 100}%` }} />
            </div>
            <div className="row wrap">
              <span className="muted">New moves per session</span>
              {[0, 5, 10, 20, 50].map((n) => (
                <span
                  key={n}
                  className={`chip ${newLimit === n ? 'on' : ''}`}
                  onClick={() => setNewLimit(n)}
                  title={n === 0 ? 'Only reviews: no new moves this session' : undefined}
                >
                  {n}
                </span>
              ))}
              {newLimit === 0 && <span className="small muted">only reviews</span>}
            </div>
            {newLimit === 0 && !c.due && c.fresh > 0 && (
              <div className="help">Nothing to review right now. Choose a number of new moves to learn some.</div>
            )}
            <label className="row small" style={{ gap: 6, cursor: 'pointer', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={wholeLines} onChange={(e) => setWholeLines(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <b>Play whole lines</b>
                <span className="muted">
                  {' '}
                  — you play all your moves of each line{scope ? ' from here' : ' from the start'}, for the reflex. Moves that are due
                  count as usual; a move that is not due only counts when you get it wrong.
                </span>
              </span>
            </label>
            <div className="row wrap">
              <button className="btn primary" disabled={rep.paused || !(c.due + Math.min(c.fresh, newLimit))} onClick={startReview}>
                <Icon name="train" size={16} /> Start review ({c.due + Math.min(c.fresh, newLimit)})
              </button>
              {scope && (
                <button className="btn" disabled={rep.paused} onClick={startDrill} title="Quiz every one of your moves in this branch, due or not">
                  <Icon name="target" size={16} /> Drill whole branch ({total})
                </button>
              )}
              <button className="btn" onClick={() => setMode('lines')}>
                <Icon name="tree" size={16} /> Practice lines{scope ? ' from here' : ''}
              </button>
            </div>
            <div className="row wrap train-admin">
              {!rep.paused && (
                <button className="btn sm ghost" onClick={togglePause} title="No reviews and nothing due for this repertoire until you resume">
                  Pause training
                </button>
              )}
              <button
                className="btn sm ghost"
                disabled={!allBranchEdges.some((e) => rep.cards[edgeId(e.from, e.uci)]?.state !== State.New)}
                onClick={() => setResetting(true)}
              >
                {scope ? 'Reset this branch…' : 'Reset progress…'}
              </button>
            </div>
          </>
        )}
      </div>
      {resetting && (
        <ResetDialog
          rep={rep}
          ids={scope ? new Set(allBranchEdges.map((e) => edgeId(e.from, e.uci))) : undefined}
          branch={scope ? formatLine((scopePath ?? []).map((p) => p.san)) : null}
          onClose={() => setResetting(false)}
        />
      )}
      <div className="card card-pad help stack" style={{ gap: 6 }}>
        <b style={{ color: 'var(--text)' }}>How it works</b>
        <div>
          Every move <i>you</i> play is a card. The app plays the line up to that position and you have to find your move.
          The FSRS algorithm (also used by Anki) schedules the next review: what you know well comes back less and less
          often, what you forget comes back soon.
        </div>
        <div>
          New moves are shown first (green arrow) and quizzed again later in the same session. <b>Practice lines</b> plays
          random lines all the way through and does not affect the schedule. Use <b>Train from here</b> in the tree or on the
          build board to focus on one branch.
        </div>
        <div>
          <b>Train up to move</b> (per repertoire) learns a wide repertoire breadth-first: first the opening moves of every
          line, later deeper. Moves beyond it are left out of every kind of training; the ones you had learned keep their
          schedule and come back when you go deeper.
        </div>
        <div>
          <b>Play whole lines</b> reviews in lines instead of single cards: you play every one of your moves of each line,
          for the playing reflex. Due moves count as usual; a move that is not due only counts when you get it wrong.
        </div>
        <div>
          <b>Pause training</b> stops the reviews of a repertoire you are not working on now (it no longer counts as due);{' '}
          <b>Resume</b> brings them back. <b>Reset progress</b> makes its moves new again, or those of one branch when you
          train from there.
        </div>
      </div>
    </div>
  );
}

/** Training progress back to the start, for the whole repertoire or one branch. Undoable. */
function ResetDialog({ rep, ids, branch, onClose }: { rep: Repertoire; ids?: Set<string>; branch: string | null; onClose: () => void }) {
  const cards = Object.entries(rep.cards).filter(([id]) => !ids || ids.has(id));
  const learned = cards.filter(([, c]) => c.state !== State.New).length;
  const confirm = () => {
    const { updateRep, undoLast, showToast } = useApp.getState();
    updateRep(rep.id, (r) => resetCards(r, ids), branch ? 'reset of a branch' : 'reset of the training');
    onClose();
    showToast(`Training ${branch ? 'of the branch ' : ''}reset: ${cards.length} moves are new again`, { label: 'Undo', run: undoLast });
  };
  return (
    <Dialog title={branch ? 'Reset this branch?' : `Reset the training of “${rep.name}”?`} onClose={onClose}>
      <div>
        {branch ? (
          <>
            All <b>{cards.length}</b> of your moves after <b>{branch}</b> become new again
          </>
        ) : (
          <>
            All <b>{cards.length}</b> of your moves become new again
          </>
        )}{' '}
        (<b>{learned}</b> of them learned now): you learn them again from the start, as if you had never trained them. Your
        moves, comments, drawings and engine checks stay as they are.
      </div>
      <div className="help">You can undo it (Undo, or Ctrl+Z), also after it has synced to your other devices.</div>
      <div className="row wrap">
        <span className="spacer" />
        <button className="btn ghost" autoFocus onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger solid" onClick={confirm}>
          Reset
        </button>
      </div>
    </Dialog>
  );
}

/** How deep this repertoire is trained: − / + per move, up to the end of the lines. */
function DepthSetting({
  depth,
  maxMove,
  total,
  fresh,
  deeper,
  onChange,
}: {
  depth: number | undefined;
  maxMove: number;
  total: number;
  fresh: number;
  deeper: number;
  onChange: (d: number | undefined) => void;
}) {
  const shown = depth ?? maxMove;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="muted">Train up to</span>
        <button className="btn sm icon" aria-label="Less deep" title="One move less deep" disabled={shown <= 1} onClick={() => onChange(shown - 1)}>
          −
        </button>
        <b className="num depth-value">{depth ? `move ${depth}` : 'the end'}</b>
        <button className="btn sm icon" aria-label="Deeper" title="One move deeper" disabled={!depth} onClick={() => onChange(shown + 1)}>
          +
        </button>
        {depth ? (
          <button className="btn sm ghost" onClick={() => onChange(undefined)}>
            All moves
          </button>
        ) : null}
      </div>
      <div className="small muted">
        {depth
          ? `${total} of your moves up to move ${depth}; ${deeper} deeper ${deeper === 1 ? 'one waits' : 'ones wait'} until you go deeper (their schedule is kept).`
          : `Your lines go to move ${maxMove}. For a wide repertoire, train up to an early move first and go deeper once that sits.`}
      </div>
      {depth && total > 0 && fresh === 0 && deeper > 0 && (
        <div className="notice small">
          You have learned every move up to move {depth}. When the reviews go well, go one move deeper with <b>+</b>.
        </div>
      )}
    </div>
  );
}

interface QItem extends TrainItem {
  kind: 'learn' | 'review' | 'test' | 'retry';
}

export function useFlash() {
  const [flash, setFlash] = useState<'' | 'flash-good' | 'flash-bad'>('');
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trigger = (f: 'flash-good' | 'flash-bad') => {
    setFlash(f);
    clearTimeout(t.current);
    t.current = setTimeout(() => setFlash(''), 600);
  };
  return [flash, trigger] as const;
}

function ReviewSession({ rep, initial, onExit }: { rep: Repertoire; initial: QItem[]; onExit: () => void }) {
  const updateRep = useApp((s) => s.updateRep);
  const showToast = useApp((s) => s.showToast);
  const [saved, setSaved] = useState<SaveResult | 'saving' | null>(null);
  // Autosave: cards are stored as you answer them, but the upload to Google Drive waits for the end of the session.
  const unsaved = useRef(false);
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState(ROOT);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [phase, setPhase] = useState<'intro' | 'await' | 'good' | 'bad' | 'done'>('intro');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [mistake, setMistake] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [score, setScore] = useState({ good: 0, bad: 0 });
  const [flash, triggerFlash] = useFlash();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const item = queue[index];
  const path = useMemo(() => (item ? (findPath(rep, item.from) ?? []) : []), [item, rep]);
  // While a new move is being taught, the author's arrows and circles for this position are shown too.
  const teaching = item?.kind === 'learn' && phase === 'await';
  const taught = rep.shapes?.[item?.from ?? ''];
  const drawn = useMemo(() => (teaching ? (tokensToShapes(taught) as Shape[]) : undefined), [teaching, taught]);

  // Session finished: save right away and show the result.
  useEffect(() => {
    if (phase !== 'done' || !unsaved.current) return;
    unsaved.current = false;
    setSaved('saving');
    let alive = true;
    saveNow().then((r) => alive && setSaved(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Left mid-session (Stop, or another screen): save what has been answered so far.
  useEffect(
    () => () => {
      if (unsaved.current) void saveNow();
    },
    [],
  );

  const stop = () => {
    if (unsaved.current) {
      unsaved.current = false;
      void saveNow().then((r) => showToast(saveMessage(r)));
    }
    onExit();
  };

  // Set up the position for the current item: show the line, then play the opponent's last move.
  useEffect(() => {
    if (!item) {
      setPhase('done');
      return;
    }
    setMistake(false);
    setHinted(false);
    setMessage(null);
    setShapes([]);
    const last = path.at(-1);
    setPos(last ? last.from : ROOT);
    setLastMove(path.length > 1 ? uciToArrow(path[path.length - 2].uci) : null);
    setPhase('intro');
    later(() => {
      setPos(item.from);
      setLastMove(last ? uciToArrow(last.uci) : null);
      setPhase('await');
      if (item.kind === 'learn') {
        setShapes([moveArrow(item.uci, rep.side)]);
        setMessage(
          <>
            New move: play <b>{item.san}</b>
            {comment(rep, item) && <div className="comment-text small muted">{comment(rep, item)}</div>}
          </>,
        );
      }
    }, last ? 450 : 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, item?.id]);

  const grade = (g: Rating.Again | Rating.Hard | Rating.Good) => {
    unsaved.current = true;
    let due = 0;
    updateRep(
      rep.id,
      (r) => {
        const card = r.cards[item.id];
        if (!card) return r;
        const next = gradeCard(card, g);
        due = next.due;
        return { ...r, cards: { ...r.cards, [item.id]: next } };
      },
      'training',
      { undoable: false },
    );
    return due;
  };

  const next = () => setIndex((i) => i + 1);

  const onMove = (orig: string, dest: string) => {
    if (phase !== 'await' || !item) return;
    const m = moveFromBoard(pos, orig, dest);
    if (!m) return;
    const ok = movesAt(rep, item.from).some((x) => x.uci === m.uci);
    setPos(m.to);
    setLastMove(uciToArrow(m.uci));
    if (ok) {
      triggerFlash('flash-good');
      setShapes([]);
      setPhase('good');
      let info: React.ReactNode = null;
      if (item.kind === 'learn') {
        setQueue((q) => [...q, { ...item, kind: 'test' }]);
        info = 'Remember it! You will get it again in a moment.';
      } else if (item.kind === 'retry') {
        info = 'Well done.';
      } else if (!mistake) {
        const due = grade(hinted ? Rating.Hard : Rating.Good);
        setScore((s) => ({ ...s, good: s.good + 1 }));
        info = `Correct! Next review in ${formatInterval(due - Date.now())}.`;
      }
      setMessage(
        <>
          {info}
          {comment(rep, item) && <div className="comment-text small muted">{comment(rep, item)}</div>}
        </>,
      );
      later(next, mistake || comment(rep, item) ? 1400 : 700);
    } else {
      triggerFlash('flash-bad');
      setPhase('bad');
      if (!mistake && (item.kind === 'review' || item.kind === 'test')) {
        grade(Rating.Again);
        setScore((s) => ({ ...s, bad: s.bad + 1 }));
        setQueue((q) => [...q, { ...item, kind: 'retry' }]);
      }
      setMistake(true);
      setMessage(
        <>
          Not your repertoire move. Play <b>{item.san}</b>.
        </>,
      );
      later(() => {
        setPos(item.from);
        setLastMove(path.length ? uciToArrow(path[path.length - 1].uci) : null);
        setShapes([moveArrow(item.uci, rep.side)]);
        setPhase('await');
      }, 650);
    }
  };

  const hint = () => {
    if (!item || phase !== 'await') return;
    setHinted(true);
    setShapes([sideCircle(uciToArrow(item.uci)[0], rep.side)]);
  };

  if (phase === 'done' || !item) {
    const c = counts(rep);
    return (
      <div style={{ maxWidth: 560, margin: '40px auto' }} className="card card-pad stack">
        <h2>Session complete 🎉</h2>
        <div className="stat-row">
          <div className="stat">
            <b style={{ color: 'var(--mine)' }}>{score.good}</b>
            <span>right first time</span>
          </div>
          <div className="stat">
            <b style={{ color: 'var(--gap)' }}>{score.bad}</b>
            <span>wrong (coming back soon)</span>
          </div>
          <div className="stat">
            <b>{c.due}</b>
            <span>still due</span>
          </div>
        </div>
        {saved && <SavedNote state={saved} />}
        <div className="row">
          <button className="btn primary" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const context = formatLine(path.map((p) => p.san));
  return (
    <div className="train">
      <div className="board-area">
        <Board
          className={flash}
          position={pos}
          orientation={rep.side}
          movable={phase === 'await' ? rep.side : null}
          lastMove={lastMove}
          shapes={shapes}
          drawn={drawn}
          onMove={onMove}
        />
      </div>
      <div className="stack">
        <div className="card card-pad stack">
          <div className="row">
            <span className="big-count">{queue.length - index}</span>
            <span className="muted">to go</span>
            <span className="spacer" />
            <span className="badge mine">{score.good} right</span>
            <span className="badge gap">{score.bad} wrong</span>
          </div>
          <div className="progress">
            <div style={{ width: `${(index / Math.max(1, queue.length)) * 100}%` }} />
          </div>
          <div className="small muted">{context || 'Starting position'}</div>
          <div className={`feedback ${phase === 'good' ? 'good' : phase === 'bad' || mistake ? 'bad' : 'info'}`}>
            {message ?? (item.kind === 'retry' ? 'Once more: what do you play here?' : 'What do you play here?')}
          </div>
          <div className="row">
            <button className="btn" onClick={hint} disabled={phase !== 'await' || item.kind === 'learn' || hinted || mistake}>
              <Icon name="hint" size={16} /> Hint
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={stop}>
              Stop
            </button>
          </div>
          <PositionLinks line={path} positionKey={item.from} orientation={rep.side} />
        </div>
        <div className="help">
          A hint (which piece) counts as “hard”, a wrong move as “again”. Cards you got wrong come back at the end of the
          session.
        </div>
      </div>
    </div>
  );
}

/** The position on the board, elsewhere: on the build board (this ends the session; progress so far is saved)
 *  or on the Lichess analysis board in a new tab (the session goes on). */
export function PositionLinks({ line, positionKey, orientation, build = true }: { line: PlayedMove[]; positionKey: string; orientation: Side; build?: boolean }) {
  const openLine = useApp((s) => s.openLine);
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {build && <button className="btn sm ghost" onClick={() => openLine(line)} title="Open this position on the build board (ends the session; your progress is saved)">
        <Icon name="board" size={14} /> Open in Build
      </button>}
      <a
        className="btn sm ghost"
        href={lichessAnalysisUrl(positionKey, orientation, line.length)}
        target="_blank"
        rel="noreferrer"
        title="Analyse this position on Lichess, in a new tab"
      >
        <Icon name="external" size={14} /> Analyse on Lichess
      </a>
    </div>
  );
}

function comment(rep: Repertoire, item: TrainItem): string | undefined {
  return movesAt(rep, item.from).find((m) => m.uci === item.uci)?.comment;
}

/** Ungraded practice: plays random prepared opponent moves; you answer with your repertoire until the line ends. */
function LinesSession({ rep, start, depth, onExit }: { rep: Repertoire; start: PathStep[]; depth?: number; onExit: () => void }) {
  const startKey = start.at(-1)?.to ?? ROOT;
  const startArrow = start.length ? uciToArrow(start[start.length - 1].uci) : null;
  const [pos, setPos] = useState(startKey);
  // What the board shows; differs from `pos` briefly while a wrong move is displayed.
  const [shown, setShown] = useState(startKey);
  const [line, setLine] = useState<string[]>(start.map((s) => s.san));
  const [lastMove, setLastMove] = useState<[string, string] | null>(startArrow);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [stats, setStats] = useState({ lines: 0, good: 0, bad: 0 });
  const [flash, triggerFlash] = useFlash();
  const [waiting, setWaiting] = useState(false);
  const [round, setRound] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const go = (key: string, uci: string | null) => {
    setPos(key);
    setShown(key);
    setLastMove(uci ? uciToArrow(uci) : null);
  };

  const restart = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    go(startKey, start.length ? start[start.length - 1].uci : null);
    setLine(start.map((s) => s.san));
    setShapes([]);
    setMessage(null);
    setWaiting(false);
    setRound((r) => r + 1);
  };

  // Opponent's turn: pick one of the prepared replies at random.
  useEffect(() => {
    // With a training depth, a line ends after your last move within it (the ply of your next move would be too deep).
    const nextMine = isMine(rep, pos) ? line.length : line.length + 1;
    const tooDeep = !!depth && moveNumberAt(nextMine) > depth;
    const moves = tooDeep ? [] : movesAt(rep, pos);
    if (tooDeep && line.length <= start.length) {
      setMessage(<>This branch starts after move {depth}, how deep you train this repertoire.</>);
      return;
    }
    if (!moves.length) {
      if (line.length > start.length) {
        setMessage(tooDeep ? <>Up to move {depth} ✓</> : <>End of the line ✓</>);
        setStats((s) => ({ ...s, lines: s.lines + 1 }));
        later(restart, 1200);
      }
      return;
    }
    if (isMine(rep, pos)) return;
    setWaiting(true);
    later(() => {
      const m = moves[Math.floor(Math.random() * moves.length)];
      go(m.to, m.uci);
      setLine((l) => [...l, m.san]);
      setWaiting(false);
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, round]);

  const onMove = (orig: string, dest: string) => {
    const m = moveFromBoard(pos, orig, dest);
    if (!m) return;
    const expected = movesAt(rep, pos);
    if (expected.some((x) => x.uci === m.uci)) {
      triggerFlash('flash-good');
      setShapes([]);
      setMessage(null);
      setStats((s) => ({ ...s, good: s.good + 1 }));
      go(m.to, m.uci);
      setLine((l) => [...l, m.san]);
    } else {
      triggerFlash('flash-bad');
      setStats((s) => ({ ...s, bad: s.bad + 1 }));
      setShown(m.to);
      setWaiting(true);
      setMessage(
        <>
          Your repertoire plays <b>{expected.map((x) => x.san).join(' or ')}</b> here.
        </>,
      );
      later(() => {
        setShown(pos);
        setWaiting(false);
        setShapes(expected.map((x) => moveArrow(x.uci, rep.side)));
      }, 650);
    }
  };

  return (
    <div className="train">
      <div className="board-area">
        <Board
          className={flash}
          position={shown}
          orientation={rep.side}
          movable={!waiting && isMine(rep, pos) && movesAt(rep, pos).length ? rep.side : null}
          lastMove={lastMove}
          shapes={shapes}
          onMove={onMove}
        />
      </div>
      <div className="stack">
        <div className="card card-pad stack">
          <div className="row">
            <h2>Practice lines</h2>
            <span className="spacer" />
            <span className="badge">{stats.lines} lines</span>
            <span className="badge mine">{stats.good} right</span>
            <span className="badge gap">{stats.bad} wrong</span>
          </div>
          <div className="small muted">{formatLine(line) || 'Starting position'}</div>
          <div className="feedback info">{message ?? (isMine(rep, pos) ? (movesAt(rep, pos).length ? 'Your move.' : 'Nothing prepared here.') : 'Opponent is thinking…')}</div>
          <div className="row">
            <button className="btn" onClick={restart}>
              New line
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={onExit}>
              Stop
            </button>
          </div>
          <PositionLinks line={lineFromSans(line) ?? []} positionKey={pos} orientation={rep.side} />
        </div>
      </div>
    </div>
  );
}

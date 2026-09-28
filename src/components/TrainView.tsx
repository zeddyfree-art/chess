import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, moveFromBoard, uciToArrow } from '../lib/chess';
import { edgeId, findPath, isMine, movesAt, myEdgesInOrder, reachable, ROOT, type PathStep, type Repertoire } from '../lib/repertoire';
import { buildQueue, counts, formatInterval, gradeCard, Rating, State, type TrainItem } from '../lib/srs';
import { activeRep, useApp } from '../lib/store';
import { Board, type Shape } from './Board';
import { Icon } from './Icon';

type Mode = 'review' | 'lines';

export function TrainView() {
  const rep = useApp(activeRep)!;
  const scope = useApp((s) => s.trainScope);
  const trainFrom = useApp((s) => s.trainFrom);
  const [mode, setMode] = useState<Mode | null>(null);
  const [newLimit, setNewLimit] = useState(() => Number(localStorage.getItem('new-limit') ?? 10));
  useEffect(() => {
    localStorage.setItem('new-limit', String(newLimit));
  }, [newLimit]);
  // Freeze the queue when a session starts so grading doesn't reshuffle it.
  const [queue, setQueue] = useState<QItem[]>([]);

  const scopePath = useMemo(() => (scope ? findPath(rep, scope) : []), [rep, scope]);
  const scopeKeys = useMemo(() => (scope && scopePath ? reachable(rep.positions, scope) : undefined), [rep, scope, scopePath]);
  const branchEdges = useMemo(
    () => myEdgesInOrder(rep).filter((e) => !scopeKeys || scopeKeys.has(e.from)),
    [rep, scopeKeys],
  );

  // The branch may have disappeared (pruned, or synced from another device).
  const lost = !!scope && !scopePath;
  useEffect(() => {
    if (lost) trainFrom(null);
  }, [lost, trainFrom]);
  if (lost) return null;
  if (mode === 'review') return <ReviewSession rep={rep} initial={queue} onExit={() => setMode(null)} />;
  if (mode === 'lines') return <LinesSession rep={rep} start={scopePath ?? []} onExit={() => setMode(null)} />;

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

  const startReview = () => {
    setQueue(buildQueue(rep, { newLimit, subtreeOf: scopeKeys }).map((i) => ({ ...i, kind: i.isNew ? 'learn' : 'review' })));
    setMode('review');
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
        {total === 0 ? (
          <div className="empty">
            {scope ? 'There are none of your moves in this branch yet.' : 'No moves to train yet. Build your repertoire first.'}
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
              {[5, 10, 20, 50].map((n) => (
                <span key={n} className={`chip ${newLimit === n ? 'on' : ''}`} onClick={() => setNewLimit(n)}>
                  {n}
                </span>
              ))}
            </div>
            <div className="row wrap">
              <button className="btn primary" disabled={!c.due && !c.fresh} onClick={startReview}>
                <Icon name="train" size={16} /> Start review ({c.due + Math.min(c.fresh, newLimit)})
              </button>
              {scope && (
                <button className="btn" onClick={startDrill} title="Quiz every one of your moves in this branch, due or not">
                  <Icon name="target" size={16} /> Drill whole branch ({total})
                </button>
              )}
              <button className="btn" onClick={() => setMode('lines')}>
                <Icon name="tree" size={16} /> Practice lines{scope ? ' from here' : ''}
              </button>
            </div>
          </>
        )}
      </div>
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
      </div>
    </div>
  );
}

interface QItem extends TrainItem {
  kind: 'learn' | 'review' | 'test' | 'retry';
}

function useFlash() {
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
        const [orig, dest] = uciToArrow(item.uci);
        setShapes([{ orig, dest, brush: 'green' } as Shape]);
        setMessage(
          <>
            New move: play <b>{item.san}</b>
            {comment(rep, item) && <div className="small muted">{comment(rep, item)}</div>}
          </>,
        );
      }
    }, last ? 450 : 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, item?.id]);

  const grade = (g: Rating.Again | Rating.Hard | Rating.Good) => {
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
          {comment(rep, item) && <div className="small muted">{comment(rep, item)}</div>}
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
      const [o, d] = uciToArrow(item.uci);
      setMessage(
        <>
          Not your repertoire move. Play <b>{item.san}</b>.
        </>,
      );
      later(() => {
        setPos(item.from);
        setLastMove(path.length ? uciToArrow(path[path.length - 1].uci) : null);
        setShapes([{ orig: o, dest: d, brush: 'green' } as Shape]);
        setPhase('await');
      }, 650);
    }
  };

  const hint = () => {
    if (!item || phase !== 'await') return;
    setHinted(true);
    const [orig] = uciToArrow(item.uci);
    setShapes([{ orig, brush: 'yellow' } as Shape]);
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
            <button className="btn ghost" onClick={onExit}>
              Stop
            </button>
          </div>
        </div>
        <div className="help">
          A hint (which piece) counts as “hard”, a wrong move as “again”. Cards you got wrong come back at the end of the
          session.
        </div>
      </div>
    </div>
  );
}

function comment(rep: Repertoire, item: TrainItem): string | undefined {
  return movesAt(rep, item.from).find((m) => m.uci === item.uci)?.comment;
}

/** Ungraded practice: plays random prepared opponent moves; you answer with your repertoire until the line ends. */
function LinesSession({ rep, start, onExit }: { rep: Repertoire; start: PathStep[]; onExit: () => void }) {
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
    const moves = movesAt(rep, pos);
    if (!moves.length) {
      if (line.length > start.length) {
        setMessage(<>End of the line ✓</>);
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
        setShapes(expected.map((x) => ({ orig: uciToArrow(x.uci)[0], dest: uciToArrow(x.uci)[1], brush: 'green' }) as Shape));
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
        </div>
      </div>
    </div>
  );
}

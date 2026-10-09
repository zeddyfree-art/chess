import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, lineFromSans, moveFromBoard, uciToArrow } from '../lib/chess';
import { planLine, type PlannedMove } from '../lib/linePlan';
import { edgeId, inTrainDepth, movesAt, myEdgesInOrder, ROOT, type PathStep, type Repertoire } from '../lib/repertoire';
import { counts, gradeCard, Rating, State, type TrainItem } from '../lib/srs';
import { useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { Board, moveArrow, sideCircle, type Shape } from './Board';
import { Icon } from './Icon';
import { SavedNote, saveMessage } from './SaveIndicator';
import { PositionLinks, useFlash } from './TrainView';

/**
 * Review in whole lines: you play every one of your moves of a line, from the start (or the branch you train), and
 * the opponent's moves are played for you. The moves that are due (or new) are graded as in the card review; a move
 * that is not due only counts when you get it wrong. New moves are shown first; their lines come back at the end of
 * the session without help, and that is when they are graded.
 */
export function LineReviewSession({ rep, items, start, onExit }: { rep: Repertoire; items: TrainItem[]; start: PathStep[]; onExit: () => void }) {
  const updateRep = useApp((s) => s.updateRep);
  const showToast = useApp((s) => s.showToast);
  const startKey = start.at(-1)?.to ?? ROOT;
  const startMove = start.at(-1);
  const order = useMemo(() => myEdgesInOrder(rep).map((e) => edgeId(e.from, e.uci)), [rep.positions]); // eslint-disable-line react-hooks/exhaustive-deps
  const newIds = useMemo(() => new Set(items.filter((i) => i.isNew).map((i) => i.id)), [items]);

  const targets = useRef(new Set(items.map((i) => i.id)));
  const taught = useRef(new Set<string>());
  const pass = useRef<'first' | 'test'>('first');
  const lineTargets = useRef(new Set<string>());
  const unsaved = useRef(false);

  const [plan, setPlan] = useState<PlannedMove[] | null>(null);
  const [lineNo, setLineNo] = useState(0);
  const [i, setI] = useState(0);
  const [pos, setPos] = useState(startKey);
  const [lastMove, setLastMove] = useState<[string, string] | null>(startMove ? uciToArrow(startMove.uci) : null);
  const [phase, setPhase] = useState<'auto' | 'await' | 'between' | 'done'>('auto');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [missed, setMissed] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [score, setScore] = useState({ lines: 0, good: 0, bad: 0 });
  const [saved, setSaved] = useState<SaveResult | 'saving' | null>(null);
  const [flash, triggerFlash] = useFlash();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Left mid-session: save what has been answered so far.
  useEffect(
    () => () => {
      if (unsaved.current) void saveNow();
    },
    [],
  );

  const nextLine = () => {
    const opts = { start: startKey, order, inDepth: inTrainDepth(useApp.getState().data.repertoires.find((r) => r.id === rep.id) ?? rep) };
    let next = planLine(rep, { ...opts, targets: targets.current });
    if (!next && pass.current === 'first' && taught.current.size) {
      // The new moves once more, now without help: this time they count.
      pass.current = 'test';
      targets.current = new Set(taught.current);
      next = planLine(rep, { ...opts, targets: targets.current });
    }
    if (!next) {
      setPhase('done');
      setPlan(null);
      return;
    }
    lineTargets.current = next.covers;
    setPlan(next.moves);
    setI(0);
    setPos(startKey);
    setLastMove(startMove ? uciToArrow(startMove.uci) : null);
    setShapes([]);
    setMessage(pass.current === 'test' ? 'Your new moves once more, without help.' : null);
    setLineNo((n) => n + 1);
  };

  useEffect(() => {
    nextLine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = plan?.[i];
  const teaching = !!current && pass.current === 'first' && lineTargets.current.has(current.id) && newIds.has(current.id);

  // Each step of the line: the opponent's moves (and yours that you have not learned yet) are played for you.
  useEffect(() => {
    if (!plan) return;
    setMissed(false);
    setHinted(false);
    if (i >= plan.length) {
      setPhase('between');
      setScore((s) => ({ ...s, lines: s.lines + 1 }));
      setMessage(<>Line done ✓</>);
      later(nextLine, 900);
      return;
    }
    const m = plan[i];
    const card = rep.cards[m.id];
    const target = lineTargets.current.has(m.id);
    // A new move outside this session is played for you; one you were shown earlier in the session you play (ungraded).
    if (!m.mine || (card?.state === State.New && !target && !taught.current.has(m.id))) {
      setPhase('auto');
      if (m.mine) setMessage(<>Not learned yet: {m.san}</>);
      later(
        () => {
          setPos(m.to);
          setLastMove(uciToArrow(m.uci));
          setI((x) => x + 1);
        },
        m.mine ? 900 : 450,
      );
      return;
    }
    setPhase('await');
    if (teaching) {
      setShapes([moveArrow(m.uci, rep.side)]);
      setMessage(
        <>
          New move: play <b>{m.san}</b>
        </>,
      );
    } else setShapes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineNo, i]);

  const grade = (id: string, g: Rating.Again | Rating.Hard | Rating.Good) => {
    unsaved.current = true;
    updateRep(
      rep.id,
      (r) => (r.cards[id] ? { ...r, cards: { ...r.cards, [id]: gradeCard(r.cards[id], g) } } : r),
      'training',
      { undoable: false },
    );
  };

  const onMove = (orig: string, dest: string) => {
    if (phase !== 'await' || !current) return;
    const m = moveFromBoard(pos, orig, dest);
    if (!m) return;
    const target = lineTargets.current.has(current.id);
    const card = rep.cards[current.id];
    if (movesAt(rep, pos).some((x) => x.uci === m.uci)) {
      triggerFlash('flash-good');
      if (teaching) taught.current.add(current.id);
      else if (target && !missed) {
        grade(current.id, hinted ? Rating.Hard : Rating.Good);
        setScore((s) => ({ ...s, good: s.good + 1 }));
      }
      setShapes([]);
      if (m.uci !== current.uci) {
        // Another move of yours here: right, but this line goes on with the one it planned.
        setMessage(
          <>
            Also yours. This line goes on with <b>{current.san}</b>.
          </>,
        );
        setPhase('auto');
        setPos(m.to);
        setLastMove(uciToArrow(m.uci));
        later(() => {
          setPos(current.to);
          setLastMove(uciToArrow(current.uci));
          setI((x) => x + 1);
        }, 900);
      } else {
        setMessage(null);
        setPos(current.to);
        setLastMove(uciToArrow(current.uci));
        setI((x) => x + 1);
      }
      return;
    }
    triggerFlash('flash-bad');
    if (!missed && !teaching && (target || (card && card.state !== State.New))) {
      // Due: graded as forgotten. Not due: a mistake still counts, so it comes back soon.
      grade(current.id, Rating.Again);
      setScore((s) => ({ ...s, bad: s.bad + 1 }));
    }
    setMissed(true);
    setPhase('auto');
    setPos(m.to);
    setLastMove(uciToArrow(m.uci));
    setMessage(
      <>
        Not your repertoire move. Play <b>{current.san}</b>.
      </>,
    );
    later(() => {
      setPos(current.from);
      setLastMove(i > 0 && plan ? uciToArrow(plan[i - 1].uci) : startMove ? uciToArrow(startMove.uci) : null);
      setShapes([moveArrow(current.uci, rep.side)]);
      setPhase('await');
    }, 650);
  };

  const hint = () => {
    if (!current || phase !== 'await') return;
    setHinted(true);
    setShapes([sideCircle(uciToArrow(current.uci)[0], rep.side)]);
  };

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
  }, [phase]);

  const stop = () => {
    if (unsaved.current) {
      unsaved.current = false;
      void saveNow().then((r) => showToast(saveMessage(r)));
    }
    onExit();
  };

  if (phase === 'done') {
    const c = counts(rep);
    return (
      <div style={{ maxWidth: 560, margin: '40px auto' }} className="card card-pad stack">
        <h2>Session complete 🎉</h2>
        <div className="stat-row">
          <div className="stat">
            <b>{score.lines}</b>
            <span>{score.lines === 1 ? 'line' : 'lines'}</span>
          </div>
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

  const played = [...start.map((s) => s.san), ...(plan ?? []).slice(0, i).map((m) => m.san)];
  const left = targets.current.size + [...lineTargets.current].filter((id) => !plan?.slice(0, i).some((m) => m.id === id)).length;
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
            <span className="big-count">{left}</span>
            <span className="muted">to review</span>
            <span className="spacer" />
            <span className="badge">line {lineNo}</span>
            <span className="badge mine">{score.good} right</span>
            <span className="badge gap">{score.bad} wrong</span>
          </div>
          <div className="small muted">{formatLine(played) || 'Starting position'}</div>
          <div className={`feedback ${missed ? 'bad' : 'info'}`}>
            {message ?? (phase === 'await' ? 'Your move.' : 'Opponent is thinking…')}
          </div>
          <div className="row">
            <button className="btn" onClick={hint} disabled={phase !== 'await' || teaching || hinted || missed}>
              <Icon name="hint" size={16} /> Hint
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={stop}>
              Stop
            </button>
          </div>
          <PositionLinks line={lineFromSans(played) ?? []} positionKey={pos} orientation={rep.side} />
        </div>
        <div className="help">
          You play every one of your moves in the line; the opponent’s are played for you. Moves that are due count as in
          the card review; a move that is not due only counts when you get it wrong.
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { lineFromSans, moveFromBoard, uciToArrow } from '../lib/chess';
import { planLine, type PlannedMove } from '../lib/linePlan';
import { edgeId, inTrainDepth, movesAt, myEdgesInOrder, ROOT, type PathStep, type Repertoire } from '../lib/repertoire';
import { counts, gradeCard, Rating, State, type TrainItem } from '../lib/srs';
import { useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { playMoveSound } from '../lib/sound';
import { Board, moveArrow, sideCircle, type Shape } from './Board';
import { Icon } from './Icon';
import { SavedNote, saveMessage } from './SaveIndicator';
import { AuthorText, PositionLinks, tailOf, useFlash } from './TrainView';
import { useKey, useScrollToTop } from '../lib/hooks';
import { moveNo } from '../lib/analysis';
import { OpeningLabel } from './OpeningLabel';

/**
 * Review in whole lines: you play every one of your moves of a line, from the start (or the branch you train), and
 * the opponent's moves are played for you. The moves that are due (or new) are graded as in the card review; a move
 * that is not due only counts when you get it wrong. New moves are shown first; their lines come back at the end of
 * the session without help, and that is when they are graded.
 */
export function LineReviewSession({
  rep,
  items,
  start,
  onExit,
  onDone,
}: {
  rep: Repertoire;
  items: TrainItem[];
  start: PathStep[];
  onExit: () => void;
  /** Part of today's session: hand over the score when done instead of showing a summary. */
  onDone?: (score: { good: number; bad: number }) => void;
}) {
  useScrollToTop();
  const updateRep = useApp((s) => s.updateRep);
  const showToast = useApp((s) => s.showToast);
  const startKey = start.at(-1)?.to ?? ROOT;
  const startMove = start.at(-1);
  const order = useMemo(() => myEdgesInOrder(rep).map((e) => edgeId(e.from, e.uci)), [rep.positions]); // eslint-disable-line react-hooks/exhaustive-deps
  const newIds = useMemo(() => new Set(items.filter((i) => i.isNew).map((i) => i.id)), [items]);

  const targets = useRef(new Set(items.map((i) => i.id)));
  const taught = useRef(new Set<string>());
  // 'retry': at the end, the lines of the moves you missed, once more (ungraded).
  const pass = useRef<'first' | 'test' | 'retry'>('first');
  const missedIds = useRef(new Set<string>());
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
  // The comment on the move you just played.
  const [said, setSaid] = useState<{ label: string; text: string } | null>(null);
  // What the author wrote around a move being taught.
  const [teachWords, setTeachWords] = useState<({ label: string; text: string } | undefined)[]>([]);
  const [missed, setMissed] = useState(false);
  // After a mistake you play the move with the arrow, then once more from memory before the line goes on.
  const [redo, setRedo] = useState(false);
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
    if (!next && pass.current !== 'retry' && missedIds.current.size) {
      // The moves you missed, once more at the end.
      pass.current = 'retry';
      targets.current = new Set(missedIds.current);
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
    setSaid(null);
    setMessage(
      pass.current === 'test' ? 'Your new moves once more, without help.' : pass.current === 'retry' ? 'The moves you missed, once more.' : null,
    );
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
    setRedo(false);
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
          playMoveSound(m);
          setI((x) => x + 1);
        },
        m.mine ? 900 : 450,
      );
      return;
    }
    setPhase('await');
    if (teaching) {
      // With everything the author wrote around it: on the opponent's move, the position and yours.
      const prev = i > 0 ? plan[i - 1] : startMove;
      const theirs = prev ? movesAt(rep, prev.from).find((x) => x.uci === prev.uci)?.comment?.trim() : undefined;
      const note = rep.notes[m.from]?.trim();
      const mine = movesAt(rep, m.from).find((x) => x.uci === m.uci)?.comment?.trim();
      const ply = start.length + i;
      setShapes([moveArrow(m.uci, rep.side)]);
      setMessage(
        <>
          New move: play <b>{m.san}</b>
        </>,
      );
      setTeachWords([
              theirs && prev ? { label: `${moveNo(ply - 1)}${prev.san}`, text: theirs } : undefined,
              note ? { label: 'Note', text: note } : undefined,
              mine ? { label: `${moveNo(ply)}${m.san}`, text: mine } : undefined,
            ]);
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
    playMoveSound(m);
    if (m.uci !== current.uci && movesAt(rep, pos).some((x) => x.uci === m.uci)) {
      // Another move of yours: not wrong, but this line asks for the other one, which stays open.
      setPhase('auto');
      setPos(m.to);
      setLastMove(uciToArrow(m.uci));
      setMessage(
        <>
          <b>{m.san}</b> is in your repertoire too, but this line goes on with your other move here.
        </>,
      );
      const keep = shapes;
      later(() => {
        setPos(current.from);
        setLastMove(i > 0 && plan ? uciToArrow(plan[i - 1].uci) : startMove ? uciToArrow(startMove.uci) : null);
        setShapes(keep);
        setPhase('await');
      }, 1100);
      return;
    }
    if (m.uci === current.uci && missed && !redo) {
      // Played with the arrow: now once more, from memory.
      triggerFlash('flash-good');
      setRedo(true);
      setPhase('auto');
      setShapes([]);
      setPos(m.to);
      setLastMove(uciToArrow(m.uci));
      setMessage(<>Now once more, without the arrow.</>);
      later(() => {
        setPos(current.from);
        setLastMove(i > 0 && plan ? uciToArrow(plan[i - 1].uci) : startMove ? uciToArrow(startMove.uci) : null);
        setPhase('await');
      }, 900);
      return;
    }
    if (m.uci === current.uci) {
      triggerFlash('flash-good');
      if (teaching) taught.current.add(current.id);
      else if (target && !missed && pass.current !== 'retry') {
        grade(current.id, hinted ? Rating.Hard : Rating.Good);
        setScore((s) => ({ ...s, good: s.good + 1 }));
      }
      setShapes([]);
      // The comment on your move stays in view while the line goes on, until your next move.
      const said = movesAt(rep, pos).find((x) => x.uci === m.uci)?.comment?.trim();
      setSaid(said ? { label: `${moveNo(start.length + i)}${m.san}`, text: said } : null);
      setMessage(null);
      setPos(current.to);
      setLastMove(uciToArrow(current.uci));
      setI((x) => x + 1);
      return;
    }
    triggerFlash('flash-bad');
    if (pass.current !== 'retry') missedIds.current.add(current.id);
    setRedo(false);
    if (!missed && !teaching && pass.current !== 'retry' && (target || (card && card.state !== State.New))) {
      // Due: graded as forgotten. Not due: a mistake still counts, so it comes back soon.
      grade(current.id, Rating.Again);
      setScore((s) => ({ ...s, bad: s.bad + 1 }));
    }
    setMissed(true);
    setSaid(null);
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

  const canHint = !!current && phase === 'await' && !teaching && !hinted && !missed;
  const hint = () => {
    if (!current || !canHint) return;
    setHinted(true);
    setShapes([sideCircle(uciToArrow(current.uci)[0], rep.side)]);
  };
  useKey(
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'h' && e.key !== 'H')) return;
      hint();
      e.preventDefault();
    },
    [canHint, current],
  );

  // Session finished: save right away and show the result (or hand over to the next part of today's session).
  useEffect(() => {
    if (phase === 'done' && onDone) {
      if (unsaved.current) {
        unsaved.current = false;
        void saveNow();
      }
      onDone({ good: score.good, bad: score.bad });
      return;
    }
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
    if (onDone) return null;
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
      <div className="stack train-panel">
        <div className="card card-pad stack">
          <div className="row">
            <span className="big-count">{left}</span>
            <span className="muted">to review</span>
            <span className="spacer" />
            <span className="badge">line {lineNo}</span>
            <span className="badge mine">{score.good} right</span>
            <span className="badge gap">{score.bad} wrong</span>
          </div>
          <div className="small muted train-context">{tailOf(played) || 'Starting position'}</div>
          <OpeningLabel keys={(lineFromSans(played) ?? []).map((m) => m.to)} reserve />
          <div className={`feedback ${missed ? 'bad' : 'info'}`}>
            {message ?? (phase === 'await' ? 'Your move.' : 'Opponent is thinking…')}
          </div>
          <div className="row">
            <button className="btn" onClick={hint} disabled={!canHint}>
              <Icon name="hint" size={16} /> Hint
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={stop}>
              Stop
            </button>
          </div>
          <PositionLinks line={lineFromSans(played) ?? []} positionKey={pos} orientation={rep.side} />
          {/* Comments come last, so nothing above them moves. */}
          {teaching ? <AuthorText words={teachWords} /> : said && <AuthorText words={[said]} />}
        </div>
        <div className="help">
          You play every one of your moves in the line; the opponent’s are played for you. Moves that are due count as in
          the card review; a move that is not due only counts when you get it wrong.
          <span className="desktop-only"> Key: H hint.</span>
        </div>
      </div>
    </div>
  );
}

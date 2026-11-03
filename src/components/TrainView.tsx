import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, lichessAnalysisUrl, moveFromBoard, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
import {
  edgeId,
  findPath,
  inTrainDepth,
  maxMyMoveNumber,
  movesAt,
  myEdgesInOrder,
  reachable,
  ROOT,
  setNote,
  setPaused,
  setTrainDepth,
  type PathStep,
  type Repertoire,
} from '../lib/repertoire';
import { buildQueue, counts, formatInterval, gradeCard, isLeech, Rating, resetCards, State, type TrainItem } from '../lib/srs';
import { activeRep, useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { playMoveSound } from '../lib/sound';
import { useKey, useScrollToTop } from '../lib/hooks';
import { moveNo } from '../lib/analysis';
import { tokensToShapes } from '../lib/shapes';
import { Board, moveArrow, sideCircle, type Shape } from './Board';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { LineReviewSession } from './LineReview';
import { OpeningLabel } from './OpeningLabel';
import { DeckTabs, MistakesTrain } from './MistakesTrain';
import { SavedNote, saveMessage } from './SaveIndicator';
import { Menu } from './Menu';
import { repTraining } from '../lib/today';
import { RepSessionSettings, TodayTrain, useTrainPrefs } from './TodayTrain';
import { PracticeSession } from './PracticeLines';

type Mode = 'review' | 'lines' | 'line-review';

/** Today's session over everything; one repertoire; or the mistakes from your own games. */
export function TrainView() {
  const rep = useApp(activeRep);
  const deck = useApp((s) => s.trainDeck);
  if (deck === 'mistakes') return <MistakesTrain />;
  if (!rep || deck === 'today') return <TodayTrain />;
  return <RepertoireTrain rep={rep} />;
}

function RepertoireTrain({ rep }: { rep: Repertoire }) {
  const scope = useApp((s) => s.trainScope);
  const trainFrom = useApp((s) => s.trainFrom);
  const [mode, setMode] = useState<Mode | null>(null);
  // New moves per session and whole lines: this repertoire's own settings, synced (also used by today's session).
  const [prefs] = useTrainPrefs();
  const { newMoves: newLimit, wholeLines } = repTraining(rep, prefs);
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
  if (mode === 'lines') return <PracticeSession rep={rep} start={scopePath ?? []} onExit={() => setMode(null)} />;

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

  const learnedAny = allBranchEdges.some((e) => rep.cards[edgeId(e.from, e.uci)]?.state !== State.New);
  const leeches = allBranchEdges.filter((e) => isLeech(rep.cards[edgeId(e.from, e.uci)]));
  const startCount = c.due + Math.min(c.fresh, newLimit);
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
          <Menu
            label={`More for ${rep.name}`}
            items={[
              rep.paused
                ? { label: 'Resume training', icon: 'train', onClick: togglePause }
                : { label: 'Pause training', icon: 'pause', onClick: togglePause },
              ...(scope && total > 0 && !rep.paused ? [{ label: `Drill the whole branch (${total})`, icon: 'target' as const, onClick: startDrill }] : []),
              ...(learnedAny ? [{ label: scope ? 'Reset this branch…' : 'Reset progress…', icon: 'undo' as const, danger: true, onClick: () => setResetting(true) }] : []),
            ]}
          />
        </div>
        {scope && (
          <div className="notice small">
            Only the branch after <b>{formatLine((scopePath ?? []).map((p) => p.san))}</b>
          </div>
        )}
        {rep.paused && (
          <div className="notice row wrap" style={{ gap: 8 }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b>Training paused.</b> This repertoire asks for no reviews and does not count as due. Practicing all lines still works.
            </span>
            <button className="btn sm primary" onClick={togglePause}>
              <Icon name="train" size={14} /> Resume
            </button>
          </div>
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
            {newLimit === 0 && !c.due && c.fresh > 0 && (
              <div className="help">Nothing to review right now. Choose a number of new moves in the settings below to learn some.</div>
            )}
          </>
        )}
        {allBranchEdges.length > 0 && (
          <div className="train-choices">
            <div className="stack" style={{ gap: 4 }}>
              <button className="btn primary" disabled={rep.paused || !startCount} onClick={startReview}>
                <Icon name="train" size={16} /> Train ({startCount})
              </button>
              <span className="small muted">Reviews and new moves: what you learn becomes cards that come back on schedule.</span>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <button className="btn" onClick={() => setMode('lines')}>
                <Icon name="tree" size={16} /> Practice all lines{scope ? ' from here' : ''}
              </button>
              <span className="small muted">
                Every line to its end{depth ? ', past move ' + depth : ''}, the most played first. To explore and rehearse: no cards, no schedule.
              </span>
            </div>
          </div>
        )}
        {allBranchEdges.length > 0 && (
          <details className="advanced">
            <summary className="small muted">
              Settings · {newLimit} new per session · {wholeLines ? 'whole lines' : 'single cards'} · {depth ? `up to move ${depth}` : 'all moves'}
            </summary>
            <div className="stack" style={{ gap: 12, marginTop: 10 }}>
              {maxMove > 1 && <DepthSetting depth={depth} maxMove={maxMove} total={total} deeper={deeper} onChange={setDepth} />}
              <RepSessionSettings rep={rep} />
            </div>
          </details>
        )}
        {leeches.length > 0 && (
          <details className="advanced">
            <summary className="small muted">
              {leeches.length} {leeches.length === 1 ? 'move' : 'moves'} you keep missing
            </summary>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              <div className="help">
                Missed {'≥'} 4 times after you had learned them. A note, playing the position against Maia, or a simpler line often helps
                more than more reviews.
              </div>
              {leeches.map((e) => {
                const path = findPath(rep, e.from) ?? [];
                const card = rep.cards[edgeId(e.from, e.uci)];
                return (
                  <div key={edgeId(e.from, e.uci)} className="row wrap small" style={{ gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 180 }}>
                      {formatLine([...path.map((p) => p.san), e.san])} <span className="muted">· missed {card.lapses}×</span>
                    </span>
                    <button className="btn sm ghost" onClick={() => useApp.getState().openLine(path)}>
                      <Icon name="board" size={14} /> Open in Build
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
        )}
        {!!depth && total > 0 && c.fresh === 0 && deeper > 0 && (
          <div className="notice small">
            You have learned every move up to move {depth}. When the reviews go well, go one move deeper (Settings, <b>+</b>).
          </div>
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
      <details className="card card-pad help">
        <summary>
          <b style={{ color: 'var(--text)' }}>How training works</b>
        </summary>
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          <div>
            Every move <i>you</i> play is a card. The app plays the line up to that position and you have to find your move.
            The FSRS algorithm (also used by Anki) schedules the next review: what you know well comes back less and less
            often, what you forget comes back soon. <b>Today</b> (the first tab) trains all your repertoires and mistake cards
            in one go; this tab trains this repertoire only.
          </div>
          <div>
            New moves are shown first (green arrow) and quizzed again later in the same session. Each card asks for its own
            move: where you have two prepared, the other one does not pass it. <b>Practice all lines</b> goes through every
            line to its end, also past the depth you train up to, the lines you meet most first (the line thickness in the
            Tree), and leaves your cards alone: for exploring a branch or rehearsing it without new cards. Use{' '}
            <b>Train from here</b> in the tree or on the build board to focus on one branch, for either.
          </div>
          <div>
            The settings (how many new moves a session adds, whole lines or single cards, and how deep) belong to each
            repertoire and are the same on all your devices; Today uses each repertoire's own. <b>Train up to move</b> learns a wide repertoire breadth-first: first the opening
            moves of every line, later deeper. Moves beyond it are left out of training (not of practice); the ones you had learned
            keep their schedule and come back when you go deeper.
          </div>
          <div>
            <b>Play whole lines</b> reviews in lines instead of single cards: you play every one of your moves of each line,
            for the playing reflex. Due moves count as usual; a move that is not due only counts when you get it wrong.
          </div>
          <div>
            In the <b>⋯</b> menu: <b>Pause training</b> stops the reviews of a repertoire you are not working on now (it no
            longer counts as due); <b>Resume</b> brings them back. <b>Reset progress</b> makes its moves new again, or those of
            one branch when you train from there.
          </div>
        </div>
      </details>
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
  deeper,
  onChange,
}: {
  depth: number | undefined;
  maxMove: number;
  total: number;
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
    </div>
  );
}

export interface QItem extends TrainItem {
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

export interface SessionScore {
  good: number;
  bad: number;
}

/** A card review. With `onDone` (a part of today's session) it hands over its score when the cards run out instead of
 *  showing its own summary. */
export function ReviewSession({ rep, initial, onExit, onDone }: { rep: Repertoire; initial: QItem[]; onExit: () => void; onDone?: (score: SessionScore) => void }) {
  useScrollToTop();
  const updateRep = useApp((s) => s.updateRep);
  const showToast = useApp((s) => s.showToast);
  const [saved, setSaved] = useState<SaveResult | 'saving' | null>(null);
  // Autosave: cards are stored as you answer them, but the upload to Google Drive waits for the end of the session.
  const unsaved = useRef(false);
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState(ROOT);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [phase, setPhase] = useState<'intro' | 'await' | 'also' | 'good' | 'bad' | 'done'>('intro');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [mistake, setMistake] = useState(false);
  // After a mistake you play the move with the arrow, then once more from memory: the card goes on only when you
  // find it yourself (and it comes back once more at the end of the session).
  const [redo, setRedo] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [score, setScore] = useState({ good: 0, bad: 0 });
  // Waiting for Continue (no longer used after a mistake: the card is played again from memory instead).
  const [waiting, setWaiting] = useState(false);
  // What the author wrote at the card you just found: it goes along to the next card until you answer that one, so
  // there is time to read it without a stop.
  const [carried, setCarried] = useState<Words[] | null>(null);
  // What the author wrote around the current card, shown under the buttons (so the buttons never move).
  const [words, setWords] = useState<(Words | undefined)[]>([]);
  // Missed this card often: the number of times, to offer another way than more reviews.
  const [leech, setLeech] = useState(0);
  // Looking back through the line with the arrow keys: the ply shown, or null for the position of the card.
  const [peek, setPeek] = useState<number | null>(null);
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

  // Session finished: save right away and show the result (or hand over to the next part of today's session).
  useEffect(() => {
    if (phase !== 'done') return;
    if (onDone) {
      if (unsaved.current) {
        unsaved.current = false;
        void saveNow();
      }
      onDone(score);
      return;
    }
    if (!unsaved.current) return;
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
    setRedo(false);
    setHinted(false);
    setWaiting(false);
    setPeek(null);
    setLeech(0);
    setMessage(null);
    setWords([]);
    setShapes([]);
    const last = path.at(-1);
    setPos(last ? last.from : ROOT);
    setLastMove(path.length > 1 ? uciToArrow(path[path.length - 2].uci) : null);
    setPhase('intro');
    later(() => {
      setPos(item.from);
      setLastMove(last ? uciToArrow(last.uci) : null);
      if (last) playMoveSound(last);
      setPhase('await');
      if (item.kind === 'learn') {
        // A new move comes with everything the author wrote around it: on the opponent's move, the position and yours.
        const w = authorWords(rep, item, path);
        setShapes([moveArrow(item.uci, rep.side)]);
        setMessage(
          <>
            New move: play <b>{item.san}</b>
          </>,
        );
        setWords([w.theirs, w.note, w.mine]);
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
  const proceed = () => {
    setWaiting(false);
    next();
  };

  // The position of the card, back on the board (after a wrong move, or another move of yours).
  const backToCard = (shapes: Shape[] = []) => {
    setPos(item.from);
    setLastMove(path.length ? uciToArrow(path[path.length - 1].uci) : null);
    setShapes(shapes);
    setPhase('await');
  };

  const onMove = (orig: string, dest: string) => {
    if (phase !== 'await' || !item || peek !== null) return;
    const m = moveFromBoard(pos, orig, dest);
    if (!m) return;
    const mine = movesAt(rep, item.from);
    playMoveSound(m);
    setPos(m.to);
    setLastMove(uciToArrow(m.uci));
    setCarried(null);
    if (m.uci !== item.uci && mine.some((x) => x.uci === m.uci)) {
      // Another move of yours: not wrong, but this card asks for its own move, so it stays open.
      setPhase('also');
      setMessage(
        <>
          <b>{m.san}</b> is in your repertoire too, but this card asks for {mine.length > 2 ? 'another' : 'your other'} move here.
        </>,
      );
      const keep = shapes;
      later(() => backToCard(keep), 1100);
      return;
    }
    if (m.uci === item.uci && mistake && !redo) {
      // Played with the arrow: now once more, from memory.
      triggerFlash('flash-good');
      setShapes([]);
      setPhase('good');
      setRedo(true);
      setMessage(<>Now once more, without the arrow.</>);
      later(() => backToCard([]), 900);
      return;
    }
    if (m.uci === item.uci) {
      triggerFlash('flash-good');
      setShapes([]);
      setPhase('good');
      let info: React.ReactNode = null;
      if (item.kind === 'learn') {
        setQueue((q) => [...q, { ...item, kind: 'test' }]);
        info = 'Remember it! You will get it again in a moment.';
      } else if (item.kind === 'retry') {
        info = 'Well done.';
      } else if (mistake) {
        info = 'Good. It comes back once more at the end of the session.';
      } else {
        const due = grade(hinted ? Rating.Hard : Rating.Good);
        setScore((s) => ({ ...s, good: s.good + 1 }));
        info = `Correct! Next review in ${formatInterval(due - Date.now())}.`;
      }
      const w = authorWords(rep, item, path);
      setMessage(info);
      setWords([w.note, w.mine]);
      // Found it: on to the next card, taking the author's words along (a new move showed them already); after a
      // mistake a little later, to read what it says.
      const words = item.kind === 'learn' ? [] : [w.note, w.mine].filter((x): x is Words => !!x);
      if (words.length) setCarried(words);
      later(next, mistake ? 1300 : 700);
    } else {
      triggerFlash('flash-bad');
      setPhase('bad');
      if (!mistake && (item.kind === 'review' || item.kind === 'test')) {
        grade(Rating.Again);
        setScore((s) => ({ ...s, bad: s.bad + 1 }));
        setQueue((q) => [...q, { ...item, kind: 'retry' }]);
        const card = useApp.getState().data.repertoires.find((r) => r.id === rep.id)?.cards[item.id];
        if (isLeech(card)) setLeech(card!.lapses);
      }
      setMistake(true);
      setRedo(false);
      setMessage(
        <>
          Not your repertoire move. Play <b>{item.san}</b>.
        </>,
      );
      later(() => backToCard([moveArrow(item.uci, rep.side)]), 650);
    }
  };

  const canHint = phase === 'await' && peek === null && item?.kind !== 'learn' && !hinted && !mistake;
  const hint = () => {
    if (!item || !canHint) return;
    setHinted(true);
    setShapes([sideCircle(uciToArrow(item.uci)[0], rep.side)]);
  };

  // Keys: Space or Enter goes on, H gives the hint, ← and → look back through the line and return.
  useKey(
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if ((e.key === ' ' || e.key === 'Enter') && waiting) {
        if (onButton) return;
        proceed();
      } else if (e.key === 'h' || e.key === 'H') hint();
      else if (e.key === 'ArrowLeft' && phase === 'await' && path.length) setPeek((p) => Math.max(0, (p ?? path.length) - 1));
      else if (e.key === 'ArrowRight' && peek !== null) setPeek(peek + 1 >= path.length ? null : peek + 1);
      else return;
      e.preventDefault();
    },
    [waiting, phase, peek, path, canHint, item],
  );

  if (phase === 'done' || !item) {
    if (onDone) return null;
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

  const peeking = peek !== null;
  return (
    <div className="train">
      <div className="board-area">
        <Board
          className={flash}
          position={peeking ? (peek ? path[peek - 1].to : path[0].from) : pos}
          orientation={rep.side}
          movable={phase === 'await' && !peeking ? rep.side : null}
          lastMove={peeking ? (peek ? uciToArrow(path[peek - 1].uci) : null) : lastMove}
          shapes={peeking ? [] : shapes}
          drawn={peeking ? undefined : drawn}
          onMove={onMove}
        />
      </div>
      <div className="stack train-panel">
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
          <div className="small muted train-context">{tailOf(path.map((p) => p.san)) || 'Starting position'}</div>
          <OpeningLabel keys={path.map((p) => p.to)} reserve />
          <div className={`feedback ${phase === 'good' ? 'good' : phase === 'bad' || (mistake && phase !== 'also') ? 'bad' : 'info'}`}>
            {peeking ? (
              <>
                Looking back: after {peek ? `${moveNo(path[peek - 1].ply)}${path[peek - 1].san}` : 'the start'}. Press → to return.
              </>
            ) : (
              (message ?? (item.kind === 'retry' ? 'Once more: what do you play here?' : 'What do you play here?'))
            )}
          </div>
          <div className="row">
            {waiting ? (
              <button className="btn primary" onClick={proceed}>
                Continue <Icon name="next" size={16} />
              </button>
            ) : (
              <button className="btn" onClick={hint} disabled={!canHint}>
                <Icon name="hint" size={16} /> Hint
              </button>
            )}
            <span className="spacer" />
            <button className="btn ghost" onClick={stop}>
              Stop
            </button>
          </div>
          <PositionLinks line={path} positionKey={item.from} orientation={rep.side} />
          {/* Everything that varies in length comes last, so nothing above it moves. */}
          {leech > 0 && !peeking && <LeechHelp rep={rep} item={item} path={path} lapses={leech} />}
          {!peeking && <AuthorText words={words} />}
          {carried && !peeking && phase !== 'good' && (
            <div className="carried">
              <span className="small faint">From the last card</span>
              <AuthorText words={carried} />
            </div>
          )}
        </div>
        <div className="help">
          A hint (which piece) counts as “hard”, a wrong move as “again”. Another of your moves does not count: each card asks
          for its own. After a wrong move you play the right one with the arrow, then once more from memory, and only then go on;
          the card comes back at the end of the session too. A comment on a move you found stays in view
          on the next card.
          <span className="desktop-only"> Keys: Space continue, H hint, ← → look back through the line.</span>
        </div>
      </div>
    </div>
  );
}

/** A card you keep missing: three other ways than more of the same reviews. */
function LeechHelp({ rep, item, path, lapses }: { rep: Repertoire; item: TrainItem; path: PathStep[]; lapses: number }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState(rep.notes[item.from] ?? '');
  const [saved, setSaved] = useState(false);
  const { openLine, playFrom, updateRep } = useApp.getState();
  const save = () => {
    updateRep(rep.id, (r) => setNote(r, item.from, text), 'note');
    setSaved(true);
    setWriting(false);
  };
  return (
    <div className="notice small stack leech" style={{ gap: 8 }}>
      <div>
        <b>You have missed {item.san} here {lapses} times.</b> More of the same reviews rarely help; something different often
        does:
      </div>
      {writing ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea
            className="input"
            rows={3}
            autoFocus
            value={text}
            placeholder={`Why ${item.san}? A plan, a trap, a picture to remember it by…`}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={save}>
              Save note
            </button>
            <button className="btn sm ghost" onClick={() => setWriting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setWriting(true)} title="A note on this position; it shows with the card after you answer">
            <Icon name="comment" size={14} /> {saved ? 'Note saved · edit' : rep.notes[item.from] ? 'Edit the note' : 'Add a note'}
          </button>
          <button
            className="btn sm"
            onClick={() => playFrom(path, { color: rep.side, label: `a move you keep missing (${item.san})` })}
            title="Play this position against Maia, to feel why the move matters (ends the session; your progress is saved)"
          >
            <Icon name="play" size={14} /> Play it vs Maia
          </button>
          <button className="btn sm" onClick={() => openLine(path)} title="Open the position on the build board, to simplify or change the line (ends the session; your progress is saved)">
            <Icon name="board" size={14} /> Simplify in Build
          </button>
        </div>
      )}
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

/** The last moves of a line ("… 7.Bb3 d6 8.c3"), so it fits on one line and the panel keeps its height. */
export function tailOf(sans: readonly string[], keep = 8): string {
  const start = Math.max(0, sans.length - keep);
  return (start ? '… ' : '') + formatLine(sans.slice(start), start);
}

function comment(rep: Repertoire, item: TrainItem): string | undefined {
  return movesAt(rep, item.from).find((m) => m.uci === item.uci)?.comment;
}

interface Words {
  label: string;
  text: string;
}

/** What the author wrote around a card: the comment on the opponent's move before it, the note on the position, and
 *  the comment on your move. */
function authorWords(rep: Repertoire, item: TrainItem, path: PathStep[]): { theirs?: Words; note?: Words; mine?: Words } {
  const last = path.at(-1);
  const theirs = last ? movesAt(rep, last.from).find((m) => m.uci === last.uci)?.comment?.trim() : undefined;
  const note = rep.notes[item.from]?.trim();
  const mine = comment(rep, item)?.trim();
  return {
    theirs: theirs && last ? { label: `${moveNo(last.ply)}${last.san}`, text: theirs } : undefined,
    note: note ? { label: 'Note', text: note } : undefined,
    mine: mine ? { label: `${moveNo(path.length)}${item.san}`, text: mine } : undefined,
  };
}

/** The author's comments and notes, each with the move (or "Note") it belongs to. */
export function AuthorText({ words }: { words: (Words | undefined)[] }) {
  const shown = words.filter((w): w is Words => !!w);
  if (!shown.length) return null;
  return (
    <div className="stack author-text" style={{ gap: 4, marginTop: 6 }}>
      {shown.map((w) => (
        <div key={w.label} className="comment-text small">
          <b className="muted">{w.label}</b> {w.text}
        </div>
      ))}
    </div>
  );
}

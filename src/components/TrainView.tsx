import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, moveFromBoard, uciToArrow } from '../lib/chess';
import { findPath, isMine, movesAt, ROOT, type Repertoire } from '../lib/repertoire';
import { buildQueue, counts, formatInterval, gradeCard, Rating, type TrainItem } from '../lib/srs';
import { activeRep, useApp } from '../lib/store';
import { Board, type Shape } from './Board';
import { Icon } from './Icon';

type Mode = 'review' | 'lines';

export function TrainView() {
  const rep = useApp(activeRep)!;
  const [mode, setMode] = useState<Mode | null>(null);
  const [newLimit, setNewLimit] = useState(() => Number(localStorage.getItem('new-limit') ?? 10));
  useEffect(() => localStorage.setItem('new-limit', String(newLimit)), [newLimit]);
  // Freeze the queue when a session starts so grading doesn't reshuffle it.
  const [queue, setQueue] = useState<QItem[]>([]);

  const c = counts(rep);
  const empty = c.total === 0;

  if (mode === 'review') return <ReviewSession rep={rep} initial={queue} onExit={() => setMode(null)} />;
  if (mode === 'lines') return <LinesSession rep={rep} onExit={() => setMode(null)} />;

  const start = () => {
    setQueue(buildQueue(rep, { newLimit }).map((i) => ({ ...i, kind: i.isNew ? 'learn' : 'review' })));
    setMode('review');
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }} className="stack">
      <div className="card card-pad stack">
        <h2>Trainen: {rep.name}</h2>
        {empty ? (
          <div className="empty">Nog geen zetten om te trainen. Bouw eerst je repertoire op.</div>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat">
                <b style={{ color: 'var(--due)' }}>{c.due}</b>
                <span>te herhalen</span>
              </div>
              <div className="stat">
                <b style={{ color: 'var(--accent)' }}>{c.fresh}</b>
                <span>nieuw</span>
              </div>
              <div className="stat">
                <b>{c.learned}</b>
                <span>geleerd</span>
              </div>
            </div>
            <div className="progress" title="Deel van je zetten dat je al hebt geleerd">
              <div style={{ width: `${(c.learned / Math.max(1, c.total)) * 100}%` }} />
            </div>
            <div className="row wrap">
              <span className="muted">Nieuwe zetten per sessie</span>
              {[5, 10, 20, 50].map((n) => (
                <span key={n} className={`chip ${newLimit === n ? 'on' : ''}`} onClick={() => setNewLimit(n)}>
                  {n}
                </span>
              ))}
            </div>
            <div className="row wrap">
              <button className="btn primary" disabled={!c.due && !c.fresh} onClick={start}>
                <Icon name="train" size={16} /> Start herhaling ({c.due + Math.min(c.fresh, newLimit)})
              </button>
              <button className="btn" onClick={() => setMode('lines')}>
                <Icon name="tree" size={16} /> Vrij lijnen oefenen
              </button>
            </div>
          </>
        )}
      </div>
      <div className="card card-pad help stack" style={{ gap: 6 }}>
        <b style={{ color: 'var(--text)' }}>Hoe het werkt</b>
        <div>
          Elke zet die jíj speelt is een kaartje. De app speelt de lijn tot die stelling en jij moet je zet vinden. Het
          FSRS-algoritme (ook gebruikt door Anki) plant de volgende herhaling: wat je goed kent zie je steeds minder vaak,
          wat je vergeet komt snel terug.
        </div>
        <div>
          Nieuwe zetten krijg je eerst te zien (groene pijl) en worden later in dezelfde sessie overhoord. <b>Vrij oefenen</b>{' '}
          speelt willekeurige lijnen helemaal uit en telt niet mee voor de planning.
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
            Nieuwe zet: speel <b>{item.san}</b>
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
        info = 'Onthouden! Je krijgt hem straks nog een keer.';
      } else if (item.kind === 'retry') {
        info = 'Goed zo.';
      } else if (!mistake) {
        const due = grade(hinted ? Rating.Hard : Rating.Good);
        setScore((s) => ({ ...s, good: s.good + 1 }));
        info = `Goed! Volgende herhaling over ${formatInterval(due - Date.now())}.`;
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
          Niet je repertoirezet. Speel <b>{item.san}</b>.
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
        <h2>Sessie klaar 🎉</h2>
        <div className="stat-row">
          <div className="stat">
            <b style={{ color: 'var(--mine)' }}>{score.good}</b>
            <span>in één keer goed</span>
          </div>
          <div className="stat">
            <b style={{ color: 'var(--gap)' }}>{score.bad}</b>
            <span>fout (komen snel terug)</span>
          </div>
          <div className="stat">
            <b>{c.due}</b>
            <span>nu nog te herhalen</span>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={onExit}>
            Terug
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
            <span className="muted">te gaan</span>
            <span className="spacer" />
            <span className="badge mine">{score.good} goed</span>
            <span className="badge gap">{score.bad} fout</span>
          </div>
          <div className="progress">
            <div style={{ width: `${(index / Math.max(1, queue.length)) * 100}%` }} />
          </div>
          <div className="small muted">{context || 'Beginstelling'}</div>
          <div className={`feedback ${phase === 'good' ? 'good' : phase === 'bad' || mistake ? 'bad' : 'info'}`}>
            {message ?? (item.kind === 'retry' ? 'Nog een keer: wat speel je hier?' : 'Wat speel je hier?')}
          </div>
          <div className="row">
            <button className="btn" onClick={hint} disabled={phase !== 'await' || item.kind === 'learn' || hinted || mistake}>
              <Icon name="hint" size={16} /> Hint
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={onExit}>
              Stoppen
            </button>
          </div>
        </div>
        <div className="help">
          Een hint (welk stuk) telt als “moeilijk”, een foute zet als “opnieuw”. Kaartjes die je fout had komen aan het eind
          van de sessie terug.
        </div>
      </div>
    </div>
  );
}

function comment(rep: Repertoire, item: TrainItem): string | undefined {
  return movesAt(rep, item.from).find((m) => m.uci === item.uci)?.comment;
}

/** Ungraded practice: plays random prepared opponent moves; you answer with your repertoire until the line ends. */
function LinesSession({ rep, onExit }: { rep: Repertoire; onExit: () => void }) {
  const [pos, setPos] = useState(ROOT);
  // What the board shows; differs from `pos` briefly while a wrong move is displayed.
  const [shown, setShown] = useState(ROOT);
  const [line, setLine] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
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
    go(ROOT, null);
    setLine([]);
    setShapes([]);
    setMessage(null);
    setWaiting(false);
    setRound((r) => r + 1);
  };

  // Opponent's turn: pick one of the prepared replies at random.
  useEffect(() => {
    const moves = movesAt(rep, pos);
    if (!moves.length) {
      if (line.length) {
        setMessage(<>Einde van de lijn ✓</>);
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
          Je repertoire speelt hier <b>{expected.map((x) => x.san).join(' of ')}</b>.
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
            <h2>Vrij oefenen</h2>
            <span className="spacer" />
            <span className="badge">{stats.lines} lijnen</span>
            <span className="badge mine">{stats.good} goed</span>
            <span className="badge gap">{stats.bad} fout</span>
          </div>
          <div className="small muted">{formatLine(line) || 'Beginstelling'}</div>
          <div className="feedback info">{message ?? (isMine(rep, pos) ? 'Jouw zet.' : 'Tegenstander denkt na…')}</div>
          <div className="row">
            <button className="btn" onClick={restart}>
              Nieuwe lijn
            </button>
            <span className="spacer" />
            <button className="btn ghost" onClick={onExit}>
              Stoppen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

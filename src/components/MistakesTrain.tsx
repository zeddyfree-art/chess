import { useEffect, useMemo, useRef, useState } from 'react';
import { formatEval, moveNo } from '../lib/analysis';
import { lineFromSans, moveFromBoard, playSan, sanToUci, START_KEY, uciToArrow } from '../lib/chess';
import { explainCard, mistakeCounts, mistakeQueue, type MistakeCard } from '../lib/mistakes';
import { formatInterval, Rating } from '../lib/srs';
import { activeRep, useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { Board, sideCircle, type Shape } from './Board';
import { Icon } from './Icon';
import { SavedNote, saveMessage } from './SaveIndicator';
import { PositionLinks, useFlash } from './TrainView';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function useMyMistakes(): MistakeCard[] {
  const all = useApp((s) => s.data.mistakes);
  const profileId = useApp((s) => s.data.activeProfileId);
  return useMemo(() => (all ?? []).filter((m) => m.profileId === profileId), [all, profileId]);
}

/** Switch between the repertoire deck and the mistakes deck. */
export function DeckTabs() {
  const rep = useApp(activeRep);
  const deck = useApp((s) => s.trainDeck);
  const setTrainDeck = useApp((s) => s.setTrainDeck);
  const cards = useMyMistakes();
  const due = mistakeCounts(cards).due;
  const current = !rep ? 'mistakes' : deck;
  return (
    <div className="deck-tabs" role="tablist">
      <button role="tab" aria-selected={current === 'repertoire'} className={current === 'repertoire' ? 'on' : ''} disabled={!rep} onClick={() => setTrainDeck('repertoire')}>
        {rep ? `${rep.side === 'white' ? '♔' : '♚'} ${rep.name}` : 'Repertoire'}
      </button>
      <button role="tab" aria-selected={current === 'mistakes'} className={current === 'mistakes' ? 'on' : ''} onClick={() => setTrainDeck('mistakes')}>
        My mistakes {due > 0 && <span className="badge due">{due}</span>}
      </button>
    </div>
  );
}

export function MistakesTrain() {
  const cards = useMyMistakes();
  const setView = useApp((s) => s.setView);
  const [session, setSession] = useState<MistakeCard[] | null>(null);
  const [newLimit, setNewLimit] = useState(() => Number(localStorage.getItem('new-limit-mistakes') ?? 10));
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    localStorage.setItem('new-limit-mistakes', String(newLimit));
  }, [newLimit]);

  if (session) return <MistakeSession initial={session} onExit={() => setSession(null)} />;
  const c = mistakeCounts(cards);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }} className="stack">
      <DeckTabs />
      <div className="card card-pad stack">
        <h2>Train: my mistakes</h2>
        {cards.length === 0 ? (
          <div className="empty stack" style={{ gap: 10 }}>
            <div>No cards yet. Add the games you played in the Games tab; after the analysis you choose which mistakes to train here.</div>
            <div>
              <button className="btn primary" onClick={() => setView('games')}>
                <Icon name="games" size={16} /> Go to Games
              </button>
            </div>
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
            <div className="row wrap">
              <span className="muted">New cards per session</span>
              {[5, 10, 20].map((n) => (
                <span key={n} className={`chip ${newLimit === n ? 'on' : ''}`} onClick={() => setNewLimit(n)}>
                  {n}
                </span>
              ))}
            </div>
            <div className="row wrap">
              <button className="btn primary" disabled={!c.due && !c.fresh} onClick={() => setSession(mistakeQueue(cards, newLimit))}>
                <Icon name="train" size={16} /> Start ({c.due + Math.min(c.fresh, newLimit)})
              </button>
              <button className="btn" onClick={() => setSession([...cards].sort(() => Math.random() - 0.5))} title="All your mistake cards, due or not">
                <Icon name="target" size={16} /> Drill all ({cards.length})
              </button>
            </div>
          </>
        )}
      </div>
      {cards.length > 0 && (
        <div className="card card-pad stack">
          <div className="row">
            <h3>Your cards</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => setShowAll((x) => !x)}>
              {showAll ? 'Hide' : `Show all ${cards.length}`}
            </button>
          </div>
          {showAll && <CardList cards={cards} />}
        </div>
      )}
      <div className="card card-pad help stack" style={{ gap: 6 }}>
        <b style={{ color: 'var(--text)' }}>How it works</b>
        <div>
          Each card is a position from one of your games where you went wrong. You get the position, with the move you played; find a
          better one. Any move the engine rates as good counts. Like the repertoire, the cards come back on the FSRS schedule: soon
          when you miss them, later and later when you find them.
        </div>
        <div>After a card you can play the position out against Maia, to see whether you can also win from there.</div>
      </div>
    </div>
  );
}

function CardList({ cards }: { cards: MistakeCard[] }) {
  const { deleteMistakes, restoreMistakes, showToast, openGame } = useApp.getState();
  const now = Date.now();
  return (
    <div className="card-list">
      {[...cards]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => (
          <div key={c.id} className="card-row">
            <span>
              <b>
                {moveNo(c.line.length)}
                {c.played}
              </b>{' '}
              → {c.best[0]}{' '}
              <span className="small muted">
                {c.games[0]?.label}
                {c.games.length > 1 ? ` (+${c.games.length - 1})` : ''}
              </span>
            </span>
            <span className="spacer" />
            <span className="small faint">{c.card.reps === 0 ? 'new' : c.card.due <= now ? 'due' : `in ${formatInterval(c.card.due - now)}`}</span>
            <button className="btn sm icon ghost" title="Open the game" onClick={() => openGame(c.games[0]?.id ?? null)}>
              <Icon name="games" size={14} />
            </button>
            <button
              className="btn sm icon ghost danger"
              title="Delete this card"
              onClick={() => {
                deleteMistakes([c.id]);
                showToast('Card deleted', { label: 'Undo', run: () => restoreMistakes([c]) });
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
    </div>
  );
}

function MistakeSession({ initial, onExit }: { initial: MistakeCard[]; onExit: () => void }) {
  const gradeMistake = useApp((s) => s.gradeMistake);
  const playFrom = useApp((s) => s.playFrom);
  const showToast = useApp((s) => s.showToast);
  const hasRep = useApp((s) => s.data.repertoires.some((r) => r.profileId === s.data.activeProfileId));
  const [queue, setQueue] = useState(initial.map((c) => ({ id: c.id, retry: false })));
  const [index, setIndex] = useState(0);
  const cards = useMyMistakes();
  const item = queue[index];
  const card = item ? (cards.find((c) => c.id === item.id) ?? initial.find((c) => c.id === item.id)) : undefined;
  const [pos, setPos] = useState(START_KEY);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [phase, setPhase] = useState<'intro' | 'await' | 'wrong' | 'good' | 'revealed' | 'done'>('intro');
  const [graded, setGraded] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [tried, setTried] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [score, setScore] = useState({ good: 0, bad: 0 });
  const [saved, setSaved] = useState<SaveResult | 'saving' | null>(null);
  const [flash, triggerFlash] = useFlash();
  const unsaved = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(
    () => () => {
      if (unsaved.current) void saveNow();
    },
    [],
  );

  const path = useMemo(() => (card ? (lineFromSans(card.line) ?? []) : []), [card]);

  useEffect(() => {
    if (!card) {
      setPhase('done');
      return;
    }
    setGraded(false);
    setHinted(false);
    setTried(null);
    setShapes([]);
    const last = path.at(-1);
    setPos(last ? last.from : START_KEY);
    setLastMove(path.length > 1 ? uciToArrow(path[path.length - 2].uci) : null);
    setPhase('intro');
    later(() => {
      setPos(card.key);
      setLastMove(last ? uciToArrow(last.uci) : null);
      setPhase('await');
    }, last ? 500 : 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, card?.id]);

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

  const grade = (g: Rating.Again | Rating.Hard | Rating.Good) => {
    if (graded || !card || item.retry) return null;
    setGraded(true);
    unsaved.current = true;
    return gradeMistake(card.id, g);
  };

  const showAnswer = (): Shape[] => {
    if (!card) return [];
    const best = sanToUci(card.key, card.best[0]);
    return best ? [{ orig: uciToArrow(best)[0], dest: uciToArrow(best)[1], brush: 'engine' } as Shape] : [];
  };

  const onMove = (orig: string, dest: string) => {
    if (!card || (phase !== 'await' && phase !== 'wrong')) return;
    const m = moveFromBoard(card.key, orig, dest);
    if (!m) return;
    setTried(m.san);
    setPos(m.to);
    setLastMove(uciToArrow(m.uci));
    if (card.best.includes(m.san)) {
      triggerFlash('flash-good');
      const due = grade(hinted ? Rating.Hard : Rating.Good);
      if (due !== null) setScore((s) => ({ ...s, good: s.good + 1 }));
      setPhase('good');
      setShapes(showAnswer());
    } else {
      triggerFlash('flash-bad');
      if (grade(Rating.Again) !== null) {
        setScore((s) => ({ ...s, bad: s.bad + 1 }));
        setQueue((q) => [...q, { id: card.id, retry: true }]);
      }
      setPhase('wrong');
      later(() => {
        setPos(card.key);
        setLastMove(path.length ? uciToArrow(path[path.length - 1].uci) : null);
      }, 800);
    }
  };

  const reveal = () => {
    if (!card) return;
    if (grade(Rating.Again) !== null) {
      setScore((s) => ({ ...s, bad: s.bad + 1 }));
      setQueue((q) => [...q, { id: card.id, retry: true }]);
    }
    const best = playSan(card.key, card.best[0]);
    if (best) {
      setPos(best.to);
      setLastMove(uciToArrow(best.uci));
    }
    setShapes(showAnswer());
    setPhase('revealed');
  };

  const hint = () => {
    if (!card) return;
    setHinted(true);
    const best = sanToUci(card.key, card.best[0]);
    if (best) setShapes([sideCircle(uciToArrow(best)[0], card.side)]);
  };

  const stop = () => {
    if (unsaved.current) {
      unsaved.current = false;
      void saveNow().then((r) => showToast(saveMessage(r)));
    }
    onExit();
  };

  const playOut = () => {
    if (!card) return;
    const start = [...path];
    const best = playSan(card.key, card.best[0]);
    if (best) start.push(best);
    playFrom(start, { color: card.side, label: `your mistake card ${moveNo(card.line.length)}${card.played} → ${card.best[0]}`, level: card.rating });
  };

  if (phase === 'done' || !card) {
    return (
      <div style={{ maxWidth: 560, margin: '40px auto' }} className="card card-pad stack">
        <h2>Session complete 🎉</h2>
        <div className="stat-row">
          <div className="stat">
            <b style={{ color: 'var(--mine)' }}>{score.good}</b>
            <span>found</span>
          </div>
          <div className="stat">
            <b style={{ color: 'var(--gap)' }}>{score.bad}</b>
            <span>missed (coming back soon)</span>
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

  const no = moveNo(card.line.length);
  const finished = phase === 'good' || phase === 'revealed';
  return (
    <div className="train">
      <div className="board-area">
        <Board
          className={flash}
          position={pos}
          orientation={card.side}
          movable={phase === 'await' || phase === 'wrong' ? card.side : null}
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
            <span className="badge mine">{score.good} found</span>
            <span className="badge gap">{score.bad} missed</span>
          </div>
          <div className="progress">
            <div style={{ width: `${(index / Math.max(1, queue.length)) * 100}%` }} />
          </div>
          <div className="small muted">
            {card.games[0]?.label}
            {card.games.length > 1 ? ` and ${plural(card.games.length - 1, 'other game')}` : ''}
          </div>
          <div className={`feedback ${phase === 'good' ? 'good' : phase === 'wrong' ? 'bad' : 'info'}`}>
            {phase === 'good' ? (
              <>
                {tried}! {tried === card.best[0] ? 'That is the move.' : `Good too (the engine’s first choice is ${card.best[0]}).`}
              </>
            ) : phase === 'revealed' ? (
              <>
                The move was {no}
                {card.best[0]}.
              </>
            ) : phase === 'wrong' ? (
              tried === card.played ? (
                <>That is what you played in the game. Look for something better.</>
              ) : (
                <>{tried} is not it. Try again.</>
              )
            ) : item.retry ? (
              <>Once more: what is better than {card.played}?</>
            ) : (
              <>
                You played {no}
                {card.played} here. Find a better move.
              </>
            )}
          </div>
          {finished && (
            <div className="stack" style={{ gap: 4 }}>
              {explainCard(card).map((t, i) => (
                <div key={i} className="small">
                  {t}
                </div>
              ))}
              <div className="small muted">
                Engine line: {no} {card.answer.join(' ')} ({formatEval(card.bestEval)})
              </div>
            </div>
          )}
          <div className="row wrap">
            {!finished ? (
              <>
                <button className="btn" onClick={hint} disabled={hinted || phase === 'intro'}>
                  <Icon name="hint" size={16} /> Hint
                </button>
                <button className="btn" onClick={reveal} disabled={phase === 'intro'}>
                  Show the move
                </button>
              </>
            ) : (
              <>
                <button className="btn primary" onClick={() => setIndex((i) => i + 1)} autoFocus>
                  Next <Icon name="next" size={16} />
                </button>
                <button className="btn" onClick={playOut} title="Leaves the session (your progress is saved)">
                  <Icon name="play" size={16} /> Play it out vs Maia
                </button>
              </>
            )}
            <span className="spacer" />
            <button className="btn ghost" onClick={stop}>
              Stop
            </button>
          </div>
          <PositionLinks line={path} positionKey={card.key} orientation={card.side} build={hasRep} />
        </div>
        <div className="help">
          A hint (which piece) counts as “hard”, a wrong move or “show the move” as “again”. Missed cards come back at the end of the session.
        </div>
      </div>
    </div>
  );
}

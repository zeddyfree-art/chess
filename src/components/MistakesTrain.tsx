import { useEffect, useMemo, useRef, useState } from 'react';
import { formatEval, moveNo } from '../lib/analysis';
import { lineFromSans, moveFromBoard, playSan, sanToUci, START_KEY, uciToArrow } from '../lib/chess';
import { nullMoveKey } from '../lib/analyzer';
import { isGoodToo } from '../lib/checkMove';
import { explainCard, mistakeCounts, mistakeQueue, mistakesToPgn, type MistakeCard } from '../lib/mistakes';
import { downloadText } from '../lib/download';
import { formatInterval, Rating } from '../lib/srs';
import { activeRep, useApp } from '../lib/store';
import { saveNow, type SaveResult } from '../lib/sync';
import { Board, sideCircle, type Shape } from './Board';
import { Icon } from './Icon';
import { SavedNote, saveMessage } from './SaveIndicator';
import { PositionLinks, useFlash } from './TrainView';
import { themesOf } from '../lib/themes';
import { ThemeChips } from './ThemeChips';

const cardThemes = (c: MistakeCard) =>
  themesOf({ key: c.key, side: c.side, played: c.played, line: c.answer, reply: c.reply, threat: c.threat, bestEval: c.bestEval });

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
              {[0, 5, 10, 20].map((n) => (
                <span
                  key={n}
                  className={`chip ${newLimit === n ? 'on' : ''}`}
                  onClick={() => setNewLimit(n)}
                  title={n === 0 ? 'Only reviews: no new cards this session' : undefined}
                >
                  {n}
                </span>
              ))}
              {newLimit === 0 && <span className="small muted">only reviews</span>}
            </div>
            {newLimit === 0 && !c.due && c.fresh > 0 && (
              <div className="help">Nothing to review right now. Choose a number of new cards to start on some.</div>
            )}
            <div className="row wrap">
              <button
                className="btn primary"
                disabled={!(c.due + Math.min(c.fresh, newLimit))}
                onClick={() => setSession(mistakeQueue(cards, newLimit))}
              >
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
          <div className="row wrap">
            <h3>Your cards</h3>
            <span className="spacer" />
            <button
              className="btn sm ghost"
              title="All cards as one PGN file: one chapter per card, for a Lichess study (Study → Add chapter → PGN; up to 64 per study) or any chess program"
              onClick={() => downloadText(`my-mistakes-${new Date().toISOString().slice(0, 10)}.pgn`, mistakesToPgn(cards), 'application/x-chess-pgn')}
            >
              <Icon name="download" size={14} /> PGN
            </button>
            <button
              className="btn sm ghost"
              title="Copy all cards as PGN, to paste into a Lichess study"
              onClick={() =>
                navigator.clipboard?.writeText(mistakesToPgn(cards)).then(
                  () => useApp.getState().showToast(`${plural(cards.length, 'card')} copied as PGN`),
                  () => useApp.getState().showToast('Could not copy'),
                )
              }
            >
              <Icon name="copy" size={14} /> Copy
            </button>
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
              → {c.best[0]} <ThemeChips themes={cardThemes(c)} />{' '}
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
  // threat: first say what the opponent threatens (cards of overlooked threats); checking: the engine looks at your move.
  const [phase, setPhase] = useState<'intro' | 'threat' | 'await' | 'checking' | 'wrong' | 'good' | 'revealed' | 'done'>('intro');
  const [threatOk, setThreatOk] = useState<boolean | null>(null);
  const [goodToo, setGoodToo] = useState(false);
  const checkSeq = useRef(0);
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
    setThreatOk(null);
    setGoodToo(false);
    checkSeq.current++;
    const last = path.at(-1);
    setPos(last ? last.from : START_KEY);
    setLastMove(path.length > 1 ? uciToArrow(path[path.length - 2].uci) : null);
    setPhase('intro');
    const nullKey = card.threat?.length && !item.retry ? nullMoveKey(card.key) : null;
    later(() => {
      setPos(nullKey ?? card.key);
      setLastMove(last ? uciToArrow(last.uci) : null);
      setPhase(nullKey ? 'threat' : 'await');
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

  const threatArrow = (): Shape[] => {
    const nullKey = card ? nullMoveKey(card.key) : null;
    const uci = nullKey && card?.threat?.[0] ? sanToUci(nullKey, card.threat[0]) : null;
    return uci ? [{ orig: uciToArrow(uci)[0], dest: uciToArrow(uci)[1], brush: 'red' } as Shape] : [];
  };

  const backToPosition = (keep: Shape[] = []) => {
    if (!card) return;
    setPos(card.key);
    setLastMove(path.length ? uciToArrow(path[path.length - 1].uci) : null);
    setShapes(keep);
  };

  const accept = (san: string, alsoGood: boolean) => {
    if (!card) return;
    triggerFlash('flash-good');
    // A missed threat costs the card its "good": seeing the threat is the point of it.
    const due = grade(threatOk === false ? Rating.Again : hinted ? Rating.Hard : Rating.Good);
    if (due !== null) {
      if (threatOk === false) {
        setScore((s) => ({ ...s, bad: s.bad + 1 }));
        setQueue((q) => [...q, { id: card.id, retry: true }]);
      } else setScore((s) => ({ ...s, good: s.good + 1 }));
    }
    setTried(san);
    setGoodToo(alsoGood);
    setPhase('good');
    setShapes(showAnswer());
  };

  const reject = () => {
    if (!card) return;
    triggerFlash('flash-bad');
    // Saw the threat but not the answer: partly right.
    if (grade(threatOk ? Rating.Hard : Rating.Again) !== null) {
      setScore((s) => ({ ...s, bad: s.bad + 1 }));
      setQueue((q) => [...q, { id: card.id, retry: true }]);
    }
    setPhase('wrong');
    later(() => backToPosition(threatOk === false ? threatArrow() : []), 800);
  };

  const onMove = (orig: string, dest: string) => {
    if (!card) return;
    if (phase === 'threat') {
      const nullKey = nullMoveKey(card.key);
      const m = nullKey ? moveFromBoard(nullKey, orig, dest) : null;
      if (!m) return;
      const plain = (x: string) => x.replace(/[+#]/g, '');
      const ok = plain(m.san) === plain(card.threat![0]);
      setThreatOk(ok);
      setTried(m.san);
      setPos(m.to);
      setLastMove(uciToArrow(m.uci));
      triggerFlash(ok ? 'flash-good' : 'flash-bad');
      setPhase('intro');
      later(() => {
        backToPosition(threatArrow());
        setTried(null);
        setPhase('await');
      }, ok ? 1200 : 1800);
      return;
    }
    if (phase !== 'await' && phase !== 'wrong') return;
    const m = moveFromBoard(card.key, orig, dest);
    if (!m) return;
    setTried(m.san);
    setPos(m.to);
    setLastMove(uciToArrow(m.uci));
    setShapes([]);
    if (card.best.includes(m.san)) return accept(m.san, false);
    if (m.san === card.played) return reject();
    // Not one of the stored good moves: ask the engine whether it is good too.
    setPhase('checking');
    const seq = ++checkSeq.current;
    isGoodToo(m.to, card.side, card.bestEval)
      .then((r) => {
        if (seq !== checkSeq.current) return;
        if (r?.good) accept(m.san, true);
        else reject();
      })
      .catch(() => seq === checkSeq.current && reject());
  };

  const reveal = () => {
    if (!card) return;
    if (phase === 'threat') {
      // Show the threat, then on to the move.
      setThreatOk(false);
      backToPosition(threatArrow());
      setPhase('await');
      return;
    }
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
          movable={phase === 'await' || phase === 'wrong' ? card.side : phase === 'threat' ? (card.side === 'white' ? 'black' : 'white') : null}
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
            {phase === 'threat' ? (
              <>
                You played {no}
                {card.played} here. First: what was your opponent threatening? Play their move.
              </>
            ) : phase === 'intro' && threatOk !== null ? (
              threatOk ? (
                <>Yes: {card.threat![0]} was the threat. Now find a move that deals with it.</>
              ) : (
                <>
                  Not quite: the threat was {card.threat![0]} (red arrow). Now find a move that deals with it.
                </>
              )
            ) : phase === 'checking' ? (
              <>Checking {tried} with the engine…</>
            ) : phase === 'good' ? (
              <>
                {tried}!{' '}
                {tried === card.best[0]
                  ? 'That is the move.'
                  : goodToo
                    ? `The engine rates it about as strong as ${card.best[0]}.`
                    : `Good too (the engine’s first choice is ${card.best[0]}).`}
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
                <>{tried} is not good enough. Try again.</>
              )
            ) : item.retry ? (
              <>Once more: what is better than {card.played}?</>
            ) : threatOk !== null ? (
              <>Now find a move that deals with {card.threat![0]}.</>
            ) : (
              <>
                You played {no}
                {card.played} here. Find a better move.
              </>
            )}
          </div>
          {finished && (
            <div className="stack" style={{ gap: 4 }}>
              <ThemeChips themes={cardThemes(card)} />
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
                <button className="btn" onClick={hint} disabled={hinted || phase !== 'await'}>
                  <Icon name="hint" size={16} /> Hint
                </button>
                <button className="btn" onClick={reveal} disabled={phase === 'intro' || phase === 'checking'}>
                  {phase === 'threat' ? 'Show the threat' : 'Show the move'}
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

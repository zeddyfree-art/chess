import { useEffect, useMemo, useState } from 'react';
import {
  divide,
  explainMoment,
  formatEval,
  JUDGMENT_NAMES,
  JUDGMENT_SYMBOLS,
  moveNo,
  PHASES,
  summarize,
  verdicts,
  type KeyMoment,
  type MoveVerdict,
} from '../lib/analysis';
import { needsAnalysis, pauseQueue, useAnalysisQueue } from '../lib/analyzer';
import { lichessAnalysisUrl, moveFromBoard, playSan, playUci, sanToUci, START_KEY, uciToArrow, type Side } from '../lib/chess';
import { formatDate, gameLabel, gameLine, opponentOf, SPEED_NAMES, type PlayedGame } from '../lib/games';
import { useGames } from '../lib/gamesStore';
import { useKey } from '../lib/hooks';
import { cardFromMoment, mistakeId } from '../lib/mistakes';
import { useApp } from '../lib/store';
import { Board, moveArrow, type Shape } from './Board';
import { EvalGraph, EvalGraphLegend } from './EvalGraph';
import { Icon } from './Icon';

interface Retry {
  moment: KeyMoment;
  board: string;
  lastMove: [string, string] | null;
  state: 'try' | 'wrong' | 'solved' | 'revealed';
  tried?: string;
}

const engineArrow = (uci: string): Shape => {
  const [orig, dest] = uciToArrow(uci);
  return { orig, dest, brush: 'engine' } as Shape;
};

export function GameReview({ game }: { game: PlayedGame }) {
  const { openGame, openLine, playFrom, addMistakes, deleteMistakes, restoreMistakes, showToast } = useApp.getState();
  const mistakes = useApp((s) => s.data.mistakes);
  const hasRep = useApp((s) => s.data.repertoires.some((r) => r.profileId === game.profileId));
  const profile = useApp((s) => s.data.profiles.find((p) => p.id === game.profileId));
  const queue = useAnalysisQueue();
  const waitingBefore = useGames((s) => s.data.games.filter(needsAnalysis).length);

  const line = useMemo(() => gameLine(game.moves), [game.moves]);
  const keys = useMemo(() => [START_KEY, ...line.map((m) => m.to)], [line]);
  const n = line.length;
  const side = game.myColor;
  const a = needsAnalysis(game) ? undefined : game.analysis;
  const moments = useMemo(() => a?.moments ?? [], [a]);
  const phases = useMemo(() => divide(keys), [keys]);
  const v: MoveVerdict[] = useMemo(() => (a ? verdicts(a.evals) : []), [a]);
  const mine = useMemo(() => (a ? summarize(a.evals, phases, side) : null), [a, phases, side]);
  const theirs = useMemo(() => (a ? summarize(a.evals, phases, side === 'white' ? 'black' : 'white') : null), [a, phases, side]);

  const [pos, setPos] = useState(() => game.analysis?.moments?.[0]?.ply ?? 0);
  const [orientation, setOrientation] = useState<Side>(side);
  const [retry, setRetry] = useState<Retry | null>(null);
  const moment = moments.find((m) => m.ply === pos);
  const cardIds = useMemo(() => new Set((mistakes ?? []).map((m) => m.id)), [mistakes]);
  const rating = a?.maiaRating ?? profile?.rating;

  const go = (p: number) => {
    setRetry(null);
    setPos(Math.max(0, Math.min(n, p)));
  };

  useKey(
    (e) => {
      if (retry) return;
      if (e.key === 'ArrowLeft') go(pos - 1);
      else if (e.key === 'ArrowRight') go(pos + 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(n);
      else return;
      e.preventDefault();
    },
    [pos, n, retry],
  );

  // Arrived at a new game, or the analysis came in: start at the first moment.
  useEffect(() => {
    if (moments.length && pos === 0) setPos(moments[0].ply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments]);

  const bestUci = (m: KeyMoment) => sanToUci(keys[m.ply], m.best[0]);

  let boardKey = keys[pos];
  let lastMove: [string, string] | null = pos > 0 ? uciToArrow(line[pos - 1].uci) : null;
  let shapes: Shape[] = [];
  if (retry) {
    boardKey = retry.board;
    lastMove = retry.lastMove;
    const best = bestUci(retry.moment);
    if ((retry.state === 'solved' || retry.state === 'revealed') && best) shapes = [engineArrow(best)];
  } else if (moment) {
    const best = bestUci(moment);
    shapes = [moveArrow(line[pos].uci, side, { soft: true }), ...(best ? [engineArrow(best)] : [])];
  }

  const startRetry = (m: KeyMoment) => {
    setPos(m.ply);
    setRetry({ moment: m, board: keys[m.ply], lastMove: m.ply > 0 ? uciToArrow(line[m.ply - 1].uci) : null, state: 'try' });
  };

  const onMove = (orig: string, dest: string) => {
    if (!retry || (retry.state !== 'try' && retry.state !== 'wrong')) return;
    const m = moveFromBoard(keys[retry.moment.ply], orig, dest);
    if (!m) return;
    const good = retry.moment.best.includes(m.san);
    setRetry({ ...retry, board: m.to, lastMove: uciToArrow(m.uci), state: good ? 'solved' : 'wrong', tried: m.san });
    if (!good) {
      setTimeout(
        () => setRetry((r) => (r && r.state === 'wrong' ? { ...r, board: keys[r.moment.ply], lastMove: r.moment.ply > 0 ? uciToArrow(line[r.moment.ply - 1].uci) : null } : r)),
        900,
      );
    }
  };

  const toggleCard = (m: KeyMoment) => {
    const id = mistakeId(game.profileId, keys[m.ply]);
    const existing = (mistakes ?? []).find((c) => c.id === id);
    if (existing) {
      deleteMistakes([id]);
      showToast('Removed from My mistakes', { label: 'Undo', run: () => restoreMistakes([existing]) });
    } else {
      addMistakes([cardFromMoment(game, m, rating)]);
      if (game.dismissed?.includes(m.ply)) useGames.getState().updateGame(game.id, (g) => ({ ...g, dismissed: g.dismissed?.filter((p) => p !== m.ply) }));
      showToast('Added to Train → My mistakes');
    }
  };

  const playFromHere = (p: number, after?: string) => {
    const start = line.slice(0, p);
    let label = `${gameLabel(game)}, before ${moveNo(p)}`;
    if (after) {
      const m = playSan(keys[p], after);
      if (m) start.push(m);
      label = `${gameLabel(game)}, after ${moveNo(p)}${after}`;
    }
    playFrom(start, { color: side, label, level: opponentOf(game).elo });
  };

  const deleteGame = () => {
    useGames.getState().deleteGames([game.id]);
    openGame(null);
    showToast('Game deleted', { label: 'Undo', run: () => useGames.getState().restoreGames([game]) });
  };

  const opp = opponentOf(game);
  const sym = (i: number) => {
    const x = v[i];
    if (!x) return null;
    if (x.miss) return <span className="sym bad" title="Miss">✕</span>;
    if (!x.judgment) return null;
    return (
      <span className={`sym ${x.judgment === 'blunder' ? 'bad' : x.judgment}`} title={JUDGMENT_NAMES[x.judgment]}>
        {JUDGMENT_SYMBOLS[x.judgment]}
      </span>
    );
  };

  return (
    <div className="review">
    <div className="card card-pad stack review-head" style={{ gap: 8 }}>
        <div className="row wrap">
          <button className="btn sm ghost" onClick={() => openGame(null)}>
            <Icon name="prev" size={14} /> All games
          </button>
          <span className="spacer" />
          {game.url && (
            <a className="btn sm ghost" href={game.url} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> {game.url.includes('lichess.org') ? 'On Lichess' : game.url.includes('chess.com') ? 'On Chess.com' : 'Original'}
            </a>
          )}
          <button className="btn sm icon ghost danger" onClick={deleteGame} title="Delete this game">
            <Icon name="trash" size={15} />
          </button>
        </div>
        <div>
          <h2 className="review-title">
            {game.white}
            {game.whiteElo ? ` (${game.whiteElo})` : ''} – {game.black}
            {game.blackElo ? ` (${game.blackElo})` : ''}
          </h2>
          <div className="small muted">
            {game.result}
            {game.termination ? ` · ${game.termination}` : ''} · {formatDate(game.playedAt)}
            {game.speed ? ` · ${SPEED_NAMES[game.speed]}` : ''}
            {game.opening ? ` · ${game.opening}` : ''} · you played {side}
          </div>
        </div>
      </div>

      <div className="review-board stack">
        <Board
          position={boardKey}
          orientation={orientation}
          movable={retry && (retry.state === 'try' || retry.state === 'wrong') ? side : null}
          lastMove={lastMove}
          shapes={shapes}
          onMove={onMove}
        />
        <div className="row review-nav">
          <button className="btn icon" onClick={() => go(0)} disabled={!!retry || pos === 0} title="Start (Home)">
            <Icon name="first" />
          </button>
          <button className="btn icon" onClick={() => go(pos - 1)} disabled={!!retry || pos === 0} title="Back (←)">
            <Icon name="prev" />
          </button>
          <span className="num small muted review-ply">{pos === 0 ? 'Start' : `${moveNo(pos - 1)}${line[pos - 1].san}`}</span>
          <button className="btn icon" onClick={() => go(pos + 1)} disabled={!!retry || pos === n} title="Forward (→)">
            <Icon name="next" />
          </button>
          <button className="btn icon" onClick={() => go(n)} disabled={!!retry || pos === n} title="End (End)">
            <Icon name="last" />
          </button>
          <span className="spacer" />
          <button className="btn icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip board">
            <Icon name="flip" />
          </button>
        </div>
        {a && (
          <>
            <EvalGraph evals={a.evals} current={pos} moves={game.moves} moments={moments} phases={phases} onSelect={go} />
            <EvalGraphLegend />
          </>
        )}
      </div>

      <div className="stack review-side">
        {!a ? (
          <div className="card card-pad stack">
            {queue.current === game.id ? (
              <>
                <div>Analysing this game… {Math.round(queue.progress * 100)}%</div>
                <div className="progress">
                  <div style={{ width: `${queue.progress * 100}%` }} />
                </div>
              </>
            ) : (
              <div className="row wrap">
                <span style={{ flex: 1 }}>
                  {queue.paused ? 'Analysis is paused.' : queue.held ? 'Analysis waits while you play.' : `Waiting for analysis (${waitingBefore} in the queue).`}
                </span>
                {queue.paused && (
                  <button className="btn sm" onClick={() => pauseQueue(false)}>
                    Resume
                  </button>
                )}
              </div>
            )}
            <div className="help">You can step through the moves meanwhile.</div>
          </div>
        ) : retry ? (
          <RetryPanel
            retry={retry}
            played={line[retry.moment.ply].san}
            onReveal={() => {
              const best = playSan(keys[retry.moment.ply], retry.moment.best[0]);
              setRetry({ ...retry, state: 'revealed', board: best?.to ?? retry.board, lastMove: best ? uciToArrow(best.uci) : retry.lastMove });
            }}
            onAgain={() => startRetry(retry.moment)}
            onStop={() => setRetry(null)}
            onPlay={() => playFromHere(retry.moment.ply, retry.tried && retry.moment.best.includes(retry.tried) ? retry.tried : retry.moment.best[0])}
            carded={cardIds.has(mistakeId(game.profileId, keys[retry.moment.ply]))}
            onCard={() => toggleCard(retry.moment)}
          />
        ) : moment ? (
          <div className="card card-pad stack moment-card">
            <div className="row wrap">
              <b className="moment-move">
                {moveNo(moment.ply)}
                {line[moment.ply].san}
              </b>
              <span className={`badge kind-${moment.kind}`}>{JUDGMENT_NAMES[moment.kind]}</span>
              <span className="muted small num">
                {formatEval(moment.bestEval)} → {formatEval(moment.playedEval)}
              </span>
              <span className="spacer" />
              <span className="small faint">
                {moments.indexOf(moment) + 1} of {moments.length}
              </span>
            </div>
            {explainMoment(moment, { played: line[moment.ply].san, previous: line[moment.ply - 1]?.san, rating }).map((t, i) => (
              <div key={i} className="small">
                {t}
              </div>
            ))}
            <div className="small muted">
              Board: <span className="key-white">white/black arrow</span> what you played, <span className="key-engine">violet</span> the engine’s move.
            </div>
            <div className="row wrap">
              <button className="btn primary" onClick={() => startRetry(moment)}>
                <Icon name="target" size={16} /> Find a better move
              </button>
              <button className={`btn ${cardIds.has(mistakeId(game.profileId, keys[moment.ply])) ? 'mine' : ''}`} onClick={() => toggleCard(moment)}>
                <Icon name={cardIds.has(mistakeId(game.profileId, keys[moment.ply])) ? 'check' : 'plus'} size={16} />{' '}
                {cardIds.has(mistakeId(game.profileId, keys[moment.ply])) ? 'In My mistakes' : 'Train this'}
              </button>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn sm ghost" onClick={() => playFromHere(moment.ply, moment.best[0])} title="Play on from the better move against Maia">
                <Icon name="play" size={14} /> Play {moment.best[0]} vs Maia
              </button>
              <button className="btn sm ghost" onClick={() => playFromHere(moment.ply)} title="Play this position again against Maia">
                <Icon name="play" size={14} /> Play from here
              </button>
              {hasRep && (
                <button className="btn sm ghost" onClick={() => openLine(line.slice(0, moment.ply))}>
                  <Icon name="board" size={14} /> Open in Build
                </button>
              )}
              <a className="btn sm ghost" href={lichessAnalysisUrl(keys[moment.ply], side, moment.ply)} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> Analyse on Lichess
              </a>
            </div>
            <div className="row">
              <button className="btn sm ghost" disabled={moments.indexOf(moment) === 0} onClick={() => go(moments[moments.indexOf(moment) - 1].ply)}>
                <Icon name="prev" size={14} /> Previous moment
              </button>
              <span className="spacer" />
              <button className="btn sm ghost" disabled={moments.indexOf(moment) === moments.length - 1} onClick={() => go(moments[moments.indexOf(moment) + 1].ply)}>
                Next moment <Icon name="next" size={14} />
              </button>
            </div>
          </div>
        ) : (
          <PositionCard
            pos={pos}
            line={line}
            a={a}
            verdict={pos > 0 ? v[pos - 1] : undefined}
            keys={keys}
            side={side}
            justPlayed={moments.find((m) => m.ply === pos - 1)}
            nextMoment={moments.find((m) => m.ply >= pos)}
            onGo={go}
            onPlay={() => playFromHere(pos)}
            onBuild={hasRep ? () => openLine(line.slice(0, pos)) : undefined}
          />
        )}

        {a && mine && theirs && (
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <h3>Accuracy</h3>
            <table className="acc-table">
              <thead>
                <tr>
                  <th />
                  <th>You</th>
                  <th>{opp.name}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Whole game</td>
                  <td className="num">
                    <b>{pctOf(mine.accuracy)}</b>
                  </td>
                  <td className="num">{pctOf(theirs.accuracy)}</td>
                </tr>
                {PHASES.map((p) => (
                  <tr key={p}>
                    <td className="muted">{p[0].toUpperCase() + p.slice(1)}</td>
                    <td className="num">{pctOf(mine.byPhase[p])}</td>
                    <td className="num">{pctOf(theirs.byPhase[p])}</td>
                  </tr>
                ))}
                <tr>
                  <td className="muted">Inaccuracies ?!</td>
                  <td className="num">{mine.inaccuracies}</td>
                  <td className="num">{theirs.inaccuracies}</td>
                </tr>
                <tr>
                  <td className="muted">Mistakes ?</td>
                  <td className="num">{mine.mistakes}</td>
                  <td className="num">{theirs.mistakes}</td>
                </tr>
                <tr>
                  <td className="muted">Blunders ??</td>
                  <td className="num">{mine.blunders}</td>
                  <td className="num">{theirs.blunders}</td>
                </tr>
                <tr>
                  <td className="muted" title="A mistake right after the opponent’s mistake: the chance was there and went by">
                    Misses ✕
                  </td>
                  <td className="num">{mine.misses}</td>
                  <td className="num">{theirs.misses}</td>
                </tr>
              </tbody>
            </table>
            <div className="help">
              Lichess’ method: how much of your winning chances each move kept, weighted towards sharp positions. Analysed {a.from === 'lichess' ? 'by Lichess, checked here' : 'on this device'}
              {a.maiaRating ? `; learnability by Maia at ${a.maiaRating}` : ''}.
            </div>
          </div>
        )}

        <div className="card card-pad">
          <div className="review-moves">
            {line.map((m, i) => (
              <span key={i} className={`rm ${pos === i + 1 ? 'on' : ''} ${moments.some((x) => x.ply === i) ? 'moment' : ''}`} onClick={() => go(i + 1)}>
                {i % 2 === 0 && <span className="faint">{i / 2 + 1}.</span>}
                {m.san}
                {sym(i)}
              </span>
            ))}
            <span className="faint small"> {game.result}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const pctOf = (x: number | null) => (x === null ? '–' : `${Math.round(x)}%`);

function PositionCard({
  pos,
  line,
  a,
  verdict,
  keys,
  side,
  justPlayed,
  nextMoment,
  onGo,
  onPlay,
  onBuild,
}: {
  pos: number;
  line: ReturnType<typeof gameLine>;
  a: NonNullable<PlayedGame['analysis']>;
  verdict?: MoveVerdict;
  keys: string[];
  side: Side;
  justPlayed?: KeyMoment;
  nextMoment?: KeyMoment;
  onGo: (p: number) => void;
  onPlay: () => void;
  onBuild?: () => void;
}) {
  const prev = pos > 0 ? line[pos - 1] : null;
  const bestBefore = pos > 0 ? a.best[pos - 1] : null;
  const bestSan = bestBefore && prev && bestBefore !== prev.uci ? playUci(keys[pos - 1], bestBefore)?.san : null;
  const label = verdict?.miss ? 'Miss' : verdict?.judgment ? JUDGMENT_NAMES[verdict.judgment] : null;
  return (
    <div className="card card-pad stack">
      <div className="row wrap">
        <b>{prev ? `${moveNo(pos - 1)}${prev.san}` : 'Starting position'}</b>
        {label && <span className={`badge kind-${verdict?.miss ? 'miss' : verdict?.judgment}`}>{label}</span>}
        <span className="spacer" />
        <span className="num muted">{formatEval(a.evals[pos])}</span>
      </div>
      {label && bestSan && <div className="small">The engine preferred {moveNo(pos - 1)}{bestSan}.</div>}
      {justPlayed && (
        <div>
          <button className="btn sm primary" onClick={() => onGo(justPlayed.ply)}>
            <Icon name="target" size={14} /> Review this mistake
          </button>
        </div>
      )}
      {nextMoment && !justPlayed && (
        <div className="small muted">
          Next of your mistakes:{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), onGo(nextMoment.ply))}>
            {moveNo(nextMoment.ply)}
            {line[nextMoment.ply].san}
          </a>
        </div>
      )}
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn sm ghost" onClick={onPlay}>
          <Icon name="play" size={14} /> Play from here vs Maia
        </button>
        {onBuild && (
          <button className="btn sm ghost" onClick={onBuild}>
            <Icon name="board" size={14} /> Open in Build
          </button>
        )}
        <a className="btn sm ghost" href={lichessAnalysisUrl(keys[pos], side, pos)} target="_blank" rel="noreferrer">
          <Icon name="external" size={14} /> Analyse on Lichess
        </a>
      </div>
    </div>
  );
}

function RetryPanel({
  retry,
  played,
  onReveal,
  onAgain,
  onStop,
  onPlay,
  carded,
  onCard,
}: {
  retry: Retry;
  played: string;
  onReveal: () => void;
  onAgain: () => void;
  onStop: () => void;
  onPlay: () => void;
  carded: boolean;
  onCard: () => void;
}) {
  const m = retry.moment;
  const no = moveNo(m.ply);
  const finished = retry.state === 'solved' || retry.state === 'revealed';
  let feedback: React.ReactNode;
  let cls = 'info';
  if (retry.state === 'try') feedback = <>You played {no}{played}. Find a better move.</>;
  else if (retry.state === 'wrong')
    feedback = retry.tried === played ? <>That is what you played. Look for something better.</> : <>{retry.tried} is not it. Try again.</>;
  else if (retry.state === 'solved') {
    cls = 'good';
    feedback = <>{retry.tried}! {retry.tried === m.best[0] ? 'That is the best move.' : `Good too (the engine’s first choice is ${m.best[0]}).`}</>;
  } else feedback = <>The move was {no}{m.best[0]}.</>;
  if (retry.state === 'wrong') cls = 'bad';
  return (
    <div className="card card-pad stack">
      <div className={`feedback ${cls}`}>{feedback}</div>
      {finished && (
        <div className="small">
          <span className="muted">Engine line: </span>
          {no} {m.line.join(' ')}
        </div>
      )}
      {finished && m.threat && <div className="small muted">The opponent threatened {m.threat[0]}.</div>}
      <div className="row wrap">
        {!finished && (
          <button className="btn" onClick={onReveal}>
            <Icon name="hint" size={16} /> Show the move
          </button>
        )}
        {finished && (
          <>
            <button className="btn primary" onClick={onPlay}>
              <Icon name="play" size={16} /> Play it out vs Maia
            </button>
            <button className={`btn ${carded ? 'mine' : ''}`} onClick={onCard}>
              <Icon name={carded ? 'check' : 'plus'} size={16} /> {carded ? 'In My mistakes' : 'Train this'}
            </button>
            <button className="btn ghost" onClick={onAgain}>
              Again
            </button>
          </>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={onStop}>
          Done
        </button>
      </div>
    </div>
  );
}

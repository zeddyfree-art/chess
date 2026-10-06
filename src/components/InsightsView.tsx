import { useEffect, useMemo, useRef, useState } from 'react';
import { moveNo, PHASES, type Phase } from '../lib/analysis';
import { lineFromSans } from '../lib/chess';
import { formatDate, gameLabel, SPEED_NAMES, type GameSpeed, type PlayedGame } from '../lib/games';
import { computeInsights, filterGames, weakestPhase, type InsightFilter, type Insights, type Period } from '../lib/insights';
import { mistakeCounts } from '../lib/mistakes';
import { useApp } from '../lib/store';
import { Icon } from './Icon';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Last week' },
  { id: 'month', label: 'Last month' },
  { id: 'quarter', label: '3 months' },
  { id: 'year', label: 'Last year' },
  { id: 'all', label: 'All' },
];

const PHASE_NAMES: Record<Phase | 'gradual', string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
  gradual: 'No single big mistake',
};

const pct = (x: number | null, digits = 0) => (x === null ? '–' : `${x.toFixed(digits)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function readFilter(profileId: string): InsightFilter {
  try {
    const f = JSON.parse(localStorage.getItem(`insights-${profileId}`) ?? 'null');
    if (f) return f;
  } catch {
    /* ignore */
  }
  return { period: 'all', speeds: [], color: 'both' };
}

/** What your analysed games say together: where you lose points, and what to work on. */
export function InsightsView({ games, profileId, suggestions, onChoose }: { games: PlayedGame[]; profileId: string; suggestions: number; onChoose: () => void }) {
  const allReps = useApp((s) => s.data.repertoires);
  const reps = useMemo(() => allReps.filter((r) => r.profileId === profileId), [allReps, profileId]);
  const mistakes = useApp((s) => s.data.mistakes);
  const [filter, setFilter] = useState<InsightFilter>(() => readFilter(profileId));
  useEffect(() => {
    try {
      localStorage.setItem(`insights-${profileId}`, JSON.stringify(filter));
    } catch {
      /* ignore */
    }
  }, [filter, profileId]);

  const shown = useMemo(() => filterGames(games, filter), [games, filter]);
  const i = useMemo(() => computeInsights(shown, reps), [shown, reps]);
  const speeds = [...new Set(games.map((g) => g.speed).filter(Boolean))] as GameSpeed[];
  const cards = mistakeCounts((mistakes ?? []).filter((m) => m.profileId === profileId));
  const toggleSpeed = (s: GameSpeed) => setFilter((f) => ({ ...f, speeds: f.speeds.includes(s) ? f.speeds.filter((x) => x !== s) : [...f.speeds, s] }));

  return (
    <div className="stack insights">
      <div className="filter-row insights-filters">
        {PERIODS.map((p) => (
          <span key={p.id} className={`chip ${filter.period === p.id ? 'on' : ''}`} onClick={() => setFilter((f) => ({ ...f, period: p.id }))}>
            {p.label}
          </span>
        ))}
        <span className="filter-sep" />
        {speeds.length > 1 &&
          speeds.map((s) => (
            <span key={s} className={`chip ${filter.speeds.includes(s) ? 'on' : ''}`} onClick={() => toggleSpeed(s)}>
              {SPEED_NAMES[s]}
            </span>
          ))}
        {speeds.length > 1 && <span className="filter-sep" />}
        {(['both', 'white', 'black'] as const).map((c) => (
          <span key={c} className={`chip ${filter.color === c ? 'on' : ''}`} onClick={() => setFilter((f) => ({ ...f, color: c }))}>
            {c === 'both' ? 'Both colours' : c === 'white' ? '♔ White' : '♚ Black'}
          </span>
        ))}
      </div>

      <div className="small muted">
        {i.analysed === 0
          ? shown.length
            ? 'No analysed games in this selection yet.'
            : 'No games in this selection.'
          : `Based on ${plural(i.analysed, 'analysed game')}${i.total > i.analysed ? ` (${i.total - i.analysed} still to analyse)` : ''}.`}
        {i.analysed > 0 && i.analysed < 10 && ' With fewer than 10 games these numbers are a first impression, not a pattern.'}
      </div>

      {i.analysed > 0 && (
        <>
          <Tiles i={i} />
          <div className="insights-grid">
            <div className="stack insights-col">
              <PhaseCard i={i} />
              <DecidedCard i={i} />
            </div>
            <div className="stack insights-col">
              <MistakesCard i={i} />
              <TrendCard i={i} games={shown} />
              <OpeningsCard i={i} />
            </div>
            <RepertoireCard i={i} hasRep={reps.length > 0} />
          </div>
        </>
      )}

      <div className="card card-pad row wrap">
        <Icon name="train" size={18} />
        <span style={{ flex: 1 }}>
          <b>My mistakes:</b> {plural(cards.total, 'card')}
          {cards.due ? `, ${cards.due} due` : ''}
          {suggestions ? ` · ${plural(suggestions, 'mistake')} waiting for your choice` : ''}
        </span>
        {suggestions > 0 && (
          <button className="btn sm" onClick={onChoose}>
            Choose cards
          </button>
        )}
        <TrainButton />
      </div>
    </div>
  );
}

function TrainButton() {
  const { setTrainDeck, setView } = useApp.getState();
  return (
    <button
      className="btn sm primary"
      onClick={() => {
        setTrainDeck('mistakes');
        setView('train');
      }}
    >
      Train
    </button>
  );
}

function Tiles({ i }: { i: Insights }) {
  const n = i.results.win + i.results.draw + i.results.loss;
  const score = n ? ((i.results.win + i.results.draw / 2) / n) * 100 : null;
  return (
    <div className="tiles">
      <div className="tile">
        <span className="tile-label">Score</span>
        <span className="tile-value">{pct(score)}</span>
        <span className="tile-sub">
          {i.results.win} won · {i.results.draw} drawn · {i.results.loss} lost
        </span>
      </div>
      <div className="tile">
        <span className="tile-label">Your accuracy</span>
        <span className="tile-value">{pct(i.accuracy.mine)}</span>
        <span className="tile-sub">your opponents: {pct(i.accuracy.theirs)}</span>
      </div>
      <div className="tile">
        <span className="tile-label">Big mistakes per game</span>
        <span className="tile-value">{i.blundersPerGame === null ? '–' : i.blundersPerGame.toFixed(1)}</span>
        <span className="tile-sub">blunders and misses</span>
      </div>
      <div className="tile">
        <span className="tile-label">Winning positions converted</span>
        <span className="tile-value">{i.winning.games ? `${i.winning.won} of ${i.winning.games}` : '–'}</span>
        <span className="tile-sub">games where you stood clearly better (75%+ to win, about +3)</span>
      </div>
    </div>
  );
}

/** Where on the 50–100% scale of the phase dot plot a value sits. */
const onScale = (v: number) => `${Math.max(0, Math.min(100, ((v - 50) / 50) * 100))}%`;

function PhaseCard({ i }: { i: Insights }) {
  const weak = weakestPhase(i);
  return (
    <div className="card card-pad stack">
      <h3>By phase</h3>
      <div className="phase-rows">
        <div className="phase-row head small faint">
          <span />
          <span className="scale">
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </span>
          <span className="phase-val">You</span>
          <span className="phase-err" title="Your mistakes, blunders and misses per 10 of your moves in this phase">
            /10
          </span>
        </div>
        {PHASES.map((p) => {
          const x = i.phases[p];
          return (
            <div key={p} className="phase-row">
              <span className="phase-name">
                {PHASE_NAMES[p]}
                <span className="small faint"> · {plural(x.games, 'game')}</span>
              </span>
              <div className="dotplot" title={`You ${pct(x.mine, 1)} · opponents ${pct(x.theirs, 1)}`}>
                <div className="dp-track" />
                {x.theirs !== null && <div className="dp-dot theirs" style={{ left: onScale(x.theirs) }} />}
                {x.mine !== null && <div className="dp-dot mine" style={{ left: onScale(x.mine) }} />}
              </div>
              <span className="num phase-val">
                <b>{pct(x.mine)}</b>
              </span>
              <span className="num small muted phase-err" title="Your mistakes, blunders and misses per 10 of your moves in this phase">
                {x.errorsPer10 === null ? '–' : x.errorsPer10.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="legend small muted">
        <span>
          <i className="key-dot mine" /> your accuracy
        </span>
        <span>
          <i className="key-dot theirs" /> your opponents’
        </span>
        <span>/10: big mistakes per 10 of your moves</span>
      </div>
      <div className="takeaway">
        {weak
          ? `Your weakest phase is the ${weak}: that is where most of your points go. Look at the moments from that phase in your games first.`
          : 'No phase is clearly weaker than the others yet.'}
      </div>
    </div>
  );
}

function CountBars({ counts, order }: { counts: Record<string, number>; order: string[] }) {
  const max = Math.max(1, ...order.map((k) => counts[k]));
  return (
    <div className="count-bars">
      {order.map((k) => (
        <div key={k} className="count-row">
          <span className="count-name">{PHASE_NAMES[k as Phase]}</span>
          <div className="hbar plain">{counts[k] > 0 && <div className="hbar-fill" style={{ width: `${(counts[k] / max) * 100}%` }} />}</div>
          <span className="num count-val">{counts[k]}</span>
        </div>
      ))}
    </div>
  );
}

function DecidedCard({ i }: { i: Insights }) {
  const order = ['opening', 'middlegame', 'endgame', 'gradual'];
  const losses = i.results.loss;
  const top = losses ? (order.slice(0, 3) as Phase[]).sort((a, b) => i.lossesDecided[b] - i.lossesDecided[a])[0] : null;
  const notConverted = i.winning.games - i.winning.won;
  return (
    <div className="card card-pad stack">
      <h3>Where games turned</h3>
      <div className="small muted">Your biggest mistake in each game you lost</div>
      {losses ? <CountBars counts={i.lossesDecided} order={order} /> : <div className="small faint">No losses in this selection.</div>}
      <div className="small muted">Your opponent’s biggest mistake in each game you won</div>
      {i.results.win ? <CountBars counts={i.winsDecided} order={order} /> : <div className="small faint">No wins in this selection.</div>}
      <div className="takeaway">
        {top && i.lossesDecided[top] > 0 ? `Most of your losses turn in the ${top}. ` : ''}
        {notConverted > 0
          ? `You stood clearly better in ${plural(i.winning.games, 'game')} and did not win ${notConverted} of them: converting is worth as many points as not blundering.`
          : i.winning.games
            ? `You won every game in which you stood clearly better.`
            : ''}
        {i.losing.games > 0 ? ` You saved ${i.losing.saved} of ${plural(i.losing.games, 'game')} in which you stood clearly worse.` : ''}
      </div>
    </div>
  );
}

function MistakesCard({ i }: { i: Insights }) {
  const e = i.errors;
  const t = i.missedMoveTypes;
  const types = t.capture + t.check + t.quiet;
  const share = (x: number) => (types ? Math.round((x / types) * 100) : 0);
  let advice = '';
  if (e.total >= 3) {
    if (e.threats / e.total >= 0.35) advice = 'Many mistakes ignored a threat. Before each move, ask: what does my opponent want to do now?';
    else if (e.misses / e.total >= 0.35) advice = 'You often let your opponent’s mistake go unpunished. After each of their moves, ask: what did that move leave undefended?';
    else if (share(t.capture) + share(t.check) >= 60) advice = 'Most of the better moves were checks or captures: look at all of them first, every move.';
    else if (share(t.quiet) >= 60) advice = 'Most of the better moves were quiet moves: after checks and captures, also ask what improves your worst piece or stops their plan.';
  }
  return (
    <div className="card card-pad stack">
      <h3>Your mistakes</h3>
      <div className="mistake-kinds">
        <div>
          <b className="num">{e.misses}</b>
          <span>missed chances</span>
          <span className="small faint">your opponent had just made a mistake</span>
        </div>
        <div>
          <b className="num">{e.threats}</b>
          <span>overlooked threats</span>
          <span className="small faint">the move let a threat happen</span>
        </div>
        <div>
          <b className="num">{e.other}</b>
          <span>other mistakes</span>
          <span className="small faint">a worse plan or move</span>
        </div>
      </div>
      {types > 0 && (
        <>
          <div className="small muted">The better move you missed was…</div>
          <div className="split-bar" role="img" aria-label={`capture ${share(t.capture)}%, check ${share(t.check)}%, quiet move ${share(t.quiet)}%`}>
            {t.capture > 0 && <div className="seg s1" style={{ flex: t.capture }} />}
            {t.check > 0 && <div className="seg s2" style={{ flex: t.check }} />}
            {t.quiet > 0 && <div className="seg s3" style={{ flex: t.quiet }} />}
          </div>
          <div className="legend small muted">
            <span>
              <i className="key s1" /> a capture {share(t.capture)}%
            </span>
            <span>
              <i className="key s2" /> a check {share(t.check)}%
            </span>
            <span>
              <i className="key s3" /> a quiet move {share(t.quiet)}%
            </span>
          </div>
        </>
      )}
      <div className="takeaway">{advice || (e.total ? 'No clear pattern yet in what you miss.' : 'No mistakes or blunders in this selection.')}</div>
    </div>
  );
}

function TrendCard({ i, games }: { i: Insights; games: PlayedGame[] }) {
  const openGame = useApp((s) => s.openGame);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pts = i.trend;
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  if (pts.length < 2) {
    return (
      <div className="card card-pad stack">
        <h3>Accuracy over time</h3>
        <div className="small faint">Needs at least two analysed games.</div>
      </div>
    );
  }
  const H = 150;
  const L = 30;
  const R = 8;
  const T = 8;
  const B = 18;
  const lo = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.accuracy)) / 10) * 10);
  const x = (k: number) => L + (pts.length === 1 ? 0 : (k / (pts.length - 1)) * (width - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (100 - lo)) * (H - T - B);
  const win = Math.min(10, pts.length);
  const avg = pts.map((_, k) => {
    const s = pts.slice(Math.max(0, k - win + 1), k + 1);
    return s.reduce((a, p) => a + p.accuracy, 0) / s.length;
  });
  const ticks = [];
  for (let v = lo; v <= 100; v += lo >= 60 ? 10 : 20) ticks.push(v);
  const near = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const k = Math.round(((clientX - r.left - L) / (width - L - R)) * (pts.length - 1));
    return Math.max(0, Math.min(pts.length - 1, k));
  };
  const h = hover !== null ? pts[hover] : null;
  const hg = h ? byId.get(h.id) : undefined;
  return (
    <div className="card card-pad stack">
      <h3>Accuracy over time</h3>
      <div
        ref={box}
        className="trend"
        onPointerMove={(e) => setHover(near(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => openGame(pts[near(e.clientX)].id)}
      >
        <svg width={width} height={H}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} className="grid" />
              <text x={L - 6} y={y(v) + 3} className="axis" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />}
          {pts.map((p, k) => (
            <circle key={p.id} cx={x(k)} cy={y(p.accuracy)} r={hover === k ? 5 : 4} className="dot" />
          ))}
          <path d={`M${avg.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' L')}`} className="avg" />
          <text x={L} y={H - 4} className="axis">
            {formatDate(pts[0].at)}
          </text>
          <text x={width - R} y={H - 4} className="axis" textAnchor="end">
            {formatDate(pts[pts.length - 1].at)}
          </text>
        </svg>
        {h && (
          <div className="trend-tip" style={{ left: Math.min(width - 190, Math.max(0, x(hover!) - 90)) }}>
            <b>{Math.round(h.accuracy)}%</b> <span className="muted">· average {Math.round(avg[hover!])}%</span>
            <div className="small muted">{hg ? gameLabel(hg) : ''}</div>
          </div>
        )}
      </div>
      <div className="legend small muted">
        <span>
          <i className="key-dot" /> one game (click to open)
        </span>
        <span>
          <i className="key-line" /> average of the last {win}
        </span>
      </div>
    </div>
  );
}

function OpeningsCard({ i }: { i: Insights }) {
  const rows = i.openings.slice(0, 12);
  return (
    <div className="card card-pad stack">
      <h3>Openings</h3>
      <table className="acc-table">
        <thead>
          <tr>
            <th>Opening</th>
            <th>Games</th>
            <th>Score</th>
            <th title="Your accuracy in the opening phase">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={`${o.color}${o.name}`}>
              <td>
                {o.color === 'white' ? '♔' : '♚'} {o.name}
              </td>
              <td className="num">{o.games}</td>
              <td className="num">{Math.round(o.score * 100)}%</td>
              <td className="num">{pct(o.accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {i.openings.length > rows.length && <div className="small faint">and {i.openings.length - rows.length} more</div>}
      <div className="help">♔ you had White, ♚ Black. Names come from Lichess or the PGN file.</div>
    </div>
  );
}

function RepertoireCard({ i, hasRep }: { i: Insights; hasRep: boolean }) {
  const { openLine, openGame } = useApp.getState();
  const p = i.prep;
  const buildAt = (sans: string[]) => {
    const line = lineFromSans(sans);
    if (line) openLine(line);
  };
  return (
    <div className="card card-pad stack span-2">
      <h3>Your repertoire in your games</h3>
      {!hasRep ? (
        <div className="small muted">Build a repertoire to see where your games leave it, and which replies you still need to prepare.</div>
      ) : !p.games ? (
        <div className="small muted">None of these games started with your repertoire for that colour.</div>
      ) : (
        <>
          <div className="small">
            In {plural(p.games, 'game')} your repertoire covered the start; you followed it for <b>{p.bookMoves?.toFixed(1)}</b> moves on average.
          </div>
          <div className="prep-cols">
            <div className="stack" style={{ gap: 6 }}>
              <b className="small">Replies you have not prepared ({p.unprepared.length})</b>
              {p.unprepared.length === 0 && <div className="small faint">None: your opponents stayed within your preparation.</div>}
              {p.unprepared.slice(0, 8).map((u) => (
                <div key={`${u.key}${u.played}`} className="prep-row">
                  <span className="small">
                    {lastMoves(u.line)} <b>{moveNo(u.ply)}{u.played}</b>
                    <span className="faint"> · {plural(u.count, 'game')}</span>
                  </span>
                  <button className="btn sm ghost" title="Open this position in Build to prepare an answer" onClick={() => buildAt([...u.line, u.played])}>
                    <Icon name="board" size={14} /> Prepare
                  </button>
                </div>
              ))}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <b className="small">Where you left it yourself ({p.youLeft.length})</b>
              {p.youLeft.length === 0 && <div className="small faint">Never: you played your prepared moves.</div>}
              {p.youLeft.slice(0, 8).map((y) => (
                <div key={y.game.id} className="prep-row">
                  <span className="small">
                    <b>
                      {moveNo(y.ply)}
                      {y.played}
                    </b>{' '}
                    instead of {y.expected.join(' or ')}
                    <span className="faint"> · {gameLabel(y.game)}</span>
                  </span>
                  <button className="btn sm ghost" title="Open the game" onClick={() => openGame(y.game.id)}>
                    <Icon name="games" size={14} />
                  </button>
                  <button className="btn sm ghost" title="Open the position in Build" onClick={() => buildAt(y.game.moves.slice(0, y.ply))}>
                    <Icon name="board" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** "…2.Nc3" : the last two moves before a position, for a short label. */
function lastMoves(line: string[]): string {
  const start = Math.max(0, line.length - 3);
  const parts = line.slice(start).map((san, k) => {
    const ply = start + k;
    return ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : k === 0 ? `${Math.floor(ply / 2) + 1}…${san}` : san;
  });
  return (start > 0 ? '… ' : '') + parts.join(' ');
}

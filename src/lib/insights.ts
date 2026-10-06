// Insights: what your analysed games say together. Pure functions over games, analyses and repertoires.
//
// Most numbers are averages over games and get more reliable with more games; every block says on how many games
// it rests. Definitions:
// - Accuracy per phase: Lichess' accuracy over the moves in that phase, averaged over the games that reached it.
// - Errors per 10 moves: your mistakes, blunders and misses in a phase per 10 of your moves in that phase.
// - Where a game was decided: in a game you lost, the phase of your costliest move (if it was at least a mistake);
//   otherwise "no single big mistake". The same for your opponent in games you won.
// - Clearly winning: at some point at least 75% to win (about +3) for you; "converted" when you then won.
// - Repertoire: how far each game followed your repertoire for that colour, and who left it first.
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { keyOfPos, type Side } from './chess';
import {
  divide,
  moverOf,
  phaseOf,
  PHASES,
  summarize,
  verdicts,
  winFor,
  type KeyMoment,
  type Phase,
  type SideSummary,
} from './analysis';
import { needsAnalysis } from './analyzer';
import { outcome, type GameSpeed, type PlayedGame } from './games';
import { movesAt, type Repertoire } from './repertoire';

/** Position keys of a game, 0 = start (fast: plays the moves on one board). */
export function positionKeys(moves: readonly string[]): string[] {
  const pos = Chess.default();
  const keys = [keyOfPos(pos)];
  for (const san of moves) {
    const m = parseSan(pos, san);
    if (!m) break;
    pos.play(m);
    keys.push(keyOfPos(pos));
  }
  return keys;
}

export interface PhaseCounts {
  moves: number;
  errors: number; // mistakes + blunders + misses
  inaccuracies: number;
}

export interface GameFacts {
  keys: string[];
  phases: { middlegame: number; endgame: number };
  mine: SideSummary;
  theirs: SideSummary;
  /** Your moves and errors per phase. */
  byPhase: Record<Phase, PhaseCounts>;
  /** Your costliest move and the opponent's (ply and Win% lost). */
  myWorst: { ply: number; loss: number } | null;
  theirWorst: { ply: number; loss: number } | null;
  /** Your best and worst winning chances during the game (after the first 10 half-moves). */
  peak: number;
  low: number;
}

const factsCache = new Map<string, { at: number; facts: GameFacts }>();

/** Facts about one analysed game (cached until it is analysed again). */
export function gameFacts(g: PlayedGame): GameFacts | null {
  const a = g.analysis;
  if (!a || needsAnalysis(g)) return null;
  const hit = factsCache.get(g.id);
  if (hit && hit.at === a.analysedAt) return hit.facts;
  const keys = positionKeys(g.moves);
  const phases = divide(keys);
  const side = g.myColor;
  const v = verdicts(a.evals);
  const byPhase = Object.fromEntries(PHASES.map((p) => [p, { moves: 0, errors: 0, inaccuracies: 0 }])) as Record<Phase, PhaseCounts>;
  let myWorst: GameFacts['myWorst'] = null;
  let theirWorst: GameFacts['theirWorst'] = null;
  v.forEach((x, ply) => {
    if (moverOf(ply) === side) {
      const c = byPhase[phaseOf(ply, phases)];
      c.moves++;
      if (x.miss || x.judgment === 'mistake' || x.judgment === 'blunder') c.errors++;
      else if (x.judgment === 'inaccuracy') c.inaccuracies++;
      if (!myWorst || x.loss > myWorst.loss) myWorst = { ply, loss: x.loss };
    } else if (!theirWorst || x.loss > theirWorst.loss) theirWorst = { ply, loss: x.loss };
  });
  const later = a.evals.slice(Math.min(10, a.evals.length - 1)).map((e) => winFor(e, side));
  const facts: GameFacts = {
    keys,
    phases,
    mine: summarize(a.evals, phases, side),
    theirs: summarize(a.evals, phases, side === 'white' ? 'black' : 'white'),
    byPhase,
    myWorst,
    theirWorst,
    peak: Math.max(...later),
    low: Math.min(...later),
  };
  factsCache.set(g.id, { at: a.analysedAt, facts });
  return facts;
}

// ---------------------------------------------------------------------------
// The game against your repertoire

export type PrepCheck =
  /** No repertoire of yours covers the first position for this colour. */
  | { kind: 'none' }
  /** You played something else than your repertoire. */
  | { kind: 'you-left'; ply: number; played: string; expected: string[] }
  /** Your opponent played a move you have not prepared. */
  | { kind: 'opponent-left'; ply: number; played: string; prepared: string[] }
  /** Your preparation ended here (or the game ended inside it). */
  | { kind: 'end'; ply: number };

/** How far a game followed the player's repertoires for the colour they played. */
export function prepCheck(moves: readonly string[], keys: readonly string[], reps: readonly Repertoire[], side: Side): PrepCheck {
  const mine = reps.filter((r) => r.side === side);
  const at = (key: string) => {
    const out: string[] = [];
    for (const r of mine) for (const m of movesAt(r, key)) if (!out.includes(m.san)) out.push(m.san);
    return out;
  };
  for (let ply = 0; ply < moves.length; ply++) {
    const prepared = at(keys[ply]);
    if (!prepared.length) return ply === 0 ? { kind: 'none' } : { kind: 'end', ply };
    if (prepared.includes(moves[ply])) continue;
    return moverOf(ply) === side
      ? { kind: 'you-left', ply, played: moves[ply], expected: prepared }
      : { kind: 'opponent-left', ply, played: moves[ply], prepared };
  }
  return { kind: 'end', ply: moves.length };
}

// ---------------------------------------------------------------------------
// All games together

export type Period = 'week' | 'month' | 'quarter' | 'year' | 'all';
export const PERIOD_DAYS: Record<Period, number | null> = { week: 7, month: 31, quarter: 92, year: 365, all: null };

export interface InsightFilter {
  period: Period;
  speeds: GameSpeed[]; // empty: all
  color: Side | 'both';
}

export function filterGames(games: readonly PlayedGame[], f: InsightFilter, now = Date.now()): PlayedGame[] {
  const days = PERIOD_DAYS[f.period];
  return games.filter(
    (g) =>
      (days === null || g.playedAt >= now - days * 86_400_000) &&
      (!f.speeds.length || (g.speed && f.speeds.includes(g.speed))) &&
      (f.color === 'both' || g.myColor === f.color),
  );
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** "French Defense" from "French Defense: Winawer Variation" (Lichess) or "French Defense Winawer Variation" (Chess.com). */
export function openingFamily(name: string | undefined, eco?: string): string {
  if (!name) return eco ? `ECO ${eco}` : 'Unknown opening';
  if (name.includes(':')) return name.split(':')[0].trim();
  const words = name.split(/\s+/);
  const end = words.findIndex((w) => /^(Defen[cs]e|Opening|Gambit|Game|Attack|System|Variation)$/i.test(w));
  return words.slice(0, end >= 0 ? Math.min(end + 1, 4) : Math.min(2, words.length)).join(' ');
}

export interface Insights {
  total: number;
  analysed: number;
  results: { win: number; draw: number; loss: number };
  accuracy: { mine: number | null; theirs: number | null };
  phases: Record<Phase, { games: number; mine: number | null; theirs: number | null; errorsPer10: number | null; moves: number }>;
  /** Phase where your losses were decided (null: no single big mistake), and the same for your opponents in your wins. */
  lossesDecided: Record<Phase | 'gradual', number>;
  winsDecided: Record<Phase | 'gradual', number>;
  winning: { games: number; won: number; drawn: number; lost: number };
  losing: { games: number; saved: number };
  errors: { misses: number; threats: number; other: number; total: number };
  missedMoveTypes: { capture: number; check: number; quiet: number };
  blundersPerGame: number | null;
  trend: { id: string; at: number; accuracy: number }[];
  openings: { name: string; color: Side; games: number; score: number; accuracy: number | null }[];
  prep: {
    games: number;
    bookMoves: number | null;
    youLeft: { game: PlayedGame; ply: number; played: string; expected: string[] }[];
    unprepared: { key: string; ply: number; line: string[]; played: string; color: Side; count: number; lastGame: PlayedGame }[];
  };
}

function moveType(san: string | undefined): 'capture' | 'check' | 'quiet' {
  if (!san) return 'quiet';
  if (/[+#]/.test(san)) return 'check';
  if (san.includes('x')) return 'capture';
  return 'quiet';
}

function decidedPhase(worst: { ply: number; loss: number } | null, phases: GameFacts['phases']): Phase | 'gradual' {
  return worst && worst.loss >= 10 ? phaseOf(worst.ply, phases) : 'gradual';
}

export function computeInsights(games: readonly PlayedGame[], reps: readonly Repertoire[]): Insights {
  const done = games.map((g) => ({ g, f: gameFacts(g) })).filter((x): x is { g: PlayedGame; f: GameFacts } => !!x.f);
  const results = { win: 0, draw: 0, loss: 0 };
  const lossesDecided = { opening: 0, middlegame: 0, endgame: 0, gradual: 0 };
  const winsDecided = { opening: 0, middlegame: 0, endgame: 0, gradual: 0 };
  const winning = { games: 0, won: 0, drawn: 0, lost: 0 };
  const losing = { games: 0, saved: 0 };
  const errors = { misses: 0, threats: 0, other: 0, total: 0 };
  const missedMoveTypes = { capture: 0, check: 0, quiet: 0 };
  const phaseAcc = Object.fromEntries(PHASES.map((p) => [p, { mine: [] as number[], theirs: [] as number[], moves: 0, errors: 0 }])) as Record<
    Phase,
    { mine: number[]; theirs: number[]; moves: number; errors: number }
  >;
  const openings = new Map<string, { name: string; color: Side; games: number; points: number; acc: number[] }>();
  let blunders = 0;
  const prepGames: { depth: number }[] = [];
  const youLeft: Insights['prep']['youLeft'] = [];
  const unprepared = new Map<string, Insights['prep']['unprepared'][number]>();

  for (const { g, f } of done) {
    const o = outcome(g);
    if (o) results[o]++;
    if (o === 'loss') lossesDecided[decidedPhase(f.myWorst, f.phases)]++;
    if (o === 'win') winsDecided[decidedPhase(f.theirWorst, f.phases)]++;
    if (f.peak >= 75) {
      winning.games++;
      if (o === 'win') winning.won++;
      else if (o === 'draw') winning.drawn++;
      else if (o === 'loss') winning.lost++;
    }
    if (f.low <= 25) {
      losing.games++;
      if (o === 'win' || o === 'draw') losing.saved++;
    }
    for (const p of PHASES) {
      const m = f.mine.byPhase[p];
      const t = f.theirs.byPhase[p];
      if (m !== null) phaseAcc[p].mine.push(m);
      if (t !== null) phaseAcc[p].theirs.push(t);
      phaseAcc[p].moves += f.byPhase[p].moves;
      phaseAcc[p].errors += f.byPhase[p].errors;
    }
    blunders += f.mine.blunders + f.mine.misses;
    for (const m of g.analysis!.moments as KeyMoment[]) {
      if (m.kind === 'inaccuracy') continue;
      errors.total++;
      if (m.kind === 'miss') errors.misses++;
      else if (m.threat?.length) errors.threats++;
      else errors.other++;
      missedMoveTypes[moveType(m.best[0])]++;
    }
    const name = openingFamily(g.opening, g.eco);
    const ok = `${g.myColor}|${name}`;
    const op = openings.get(ok) ?? { name, color: g.myColor, games: 0, points: 0, acc: [] };
    op.games++;
    op.points += o === 'win' ? 1 : o === 'draw' ? 0.5 : 0;
    if (f.mine.byPhase.opening !== null) op.acc.push(f.mine.byPhase.opening);
    openings.set(ok, op);

    const prep = prepCheck(g.moves, f.keys, reps, g.myColor);
    if (prep.kind !== 'none') {
      prepGames.push({ depth: prep.ply });
      if (prep.kind === 'you-left') youLeft.push({ game: g, ply: prep.ply, played: prep.played, expected: prep.expected });
      if (prep.kind === 'opponent-left') {
        const id = `${f.keys[prep.ply]}|${prep.played}`;
        const u = unprepared.get(id);
        if (u) {
          u.count++;
          if (g.playedAt > u.lastGame.playedAt) u.lastGame = g;
        } else
          unprepared.set(id, { key: f.keys[prep.ply], ply: prep.ply, line: g.moves.slice(0, prep.ply), played: prep.played, color: g.myColor, count: 1, lastGame: g });
      }
    }
  }

  const accMine = done.map((x) => x.f.mine.accuracy).filter((x): x is number => x !== null);
  const accTheirs = done.map((x) => x.f.theirs.accuracy).filter((x): x is number => x !== null);
  const trend = done
    .filter((x) => x.f.mine.accuracy !== null)
    .map((x) => ({ id: x.g.id, at: x.g.playedAt, accuracy: x.f.mine.accuracy! }))
    .sort((a, b) => a.at - b.at);

  return {
    total: games.length,
    analysed: done.length,
    results,
    accuracy: { mine: mean(accMine), theirs: mean(accTheirs) },
    phases: Object.fromEntries(
      PHASES.map((p) => [
        p,
        {
          games: phaseAcc[p].mine.length,
          mine: mean(phaseAcc[p].mine),
          theirs: mean(phaseAcc[p].theirs),
          errorsPer10: phaseAcc[p].moves ? (phaseAcc[p].errors / phaseAcc[p].moves) * 10 : null,
          moves: phaseAcc[p].moves,
        },
      ]),
    ) as Insights['phases'],
    lossesDecided,
    winsDecided,
    winning,
    losing,
    errors,
    missedMoveTypes,
    blundersPerGame: done.length ? blunders / done.length : null,
    trend,
    openings: [...openings.values()]
      .map((o) => ({ name: o.name, color: o.color, games: o.games, score: o.points / o.games, accuracy: mean(o.acc) }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    prep: {
      games: prepGames.length,
      bookMoves: prepGames.length ? mean(prepGames.map((p) => p.depth / 2)) : null,
      youLeft: youLeft.sort((a, b) => b.game.playedAt - a.game.playedAt),
      unprepared: [...unprepared.values()].sort((a, b) => b.count - a.count || b.lastGame.playedAt - a.lastGame.playedAt),
    },
  };
}

/** The phase with the lowest accuracy, if it is clearly lower (at least 3 points and 3 games behind it). */
export function weakestPhase(i: Insights): Phase | null {
  const scored = PHASES.map((p) => ({ p, acc: i.phases[p].mine, n: i.phases[p].games })).filter((x) => x.acc !== null && x.n >= 3);
  if (scored.length < 2) return null;
  scored.sort((a, b) => a.acc! - b.acc!);
  return scored[1].acc! - scored[0].acc! >= 3 ? scored[0].p : null;
}

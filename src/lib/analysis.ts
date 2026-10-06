// What the engine thinks of a played game, and what to learn from it. Pure functions; the engine work
// itself is in analyzer.ts.
//
// The measures follow Lichess, whose formulas are public (lichess.org/page/accuracy):
// - Win% = 50 + 50 · (2 / (1 + e^(−0.00368208 · centipawns)) − 1), from the side to move's view.
// - A move's accuracy = 103.1668 · e^(−0.04354 · Win% lost) − 3.1669 (+1, at most 100).
// - Inaccuracy, mistake, blunder: a move that loses 5, 10 or 15 Win% (Lichess' 0.1/0.2/0.3 winning chances).
// - A game's accuracy: the mean of the move accuracies weighted by how sharp the position was, averaged with
//   their harmonic mean (which punishes big errors).
// - Phases: Lichess' "Divider": the middlegame starts when at most 10 pieces (not counting kings and pawns) are
//   left or a back rank has thinned out; the endgame when at most 6 are left.
// Chess.com's "Miss" is added: a mistake right after the opponent's mistake, which gives the chance back.
import type { Side } from './chess';

/** Bump to re-analyse games analysed by an older version of this code. */
export const ANALYSIS_VERSION = 1;

export type MomentKind = 'blunder' | 'mistake' | 'miss' | 'inaccuracy';

export interface KeyMoment {
  /** Index of the move in the game (0 = White's first move). */
  ply: number;
  kind: MomentKind;
  /** Win% the move lost, 0–100. */
  loss: number;
  /** Moves that would have been fine (SAN), best first. */
  best: string[];
  /** The engine's line from the position, starting with its best move (SAN). */
  line: string[];
  /** Evaluation after the best move and after the move played (White's view, see scoreCp). */
  bestEval: number;
  playedEval: number;
  /** The opponent's best answer to the move played (SAN line). */
  reply?: string[];
  /** What the opponent was threatening before the move, when the move let it happen (SAN line). */
  threat?: string[];
  /** Share of players at the analysis' Maia rating who would play one of the `best` moves / the move played. */
  maia?: { best: number; played: number };
}

export interface GameAnalysis {
  version: number;
  /** Evaluation of every position: 0 = the start, i = after move i. White's view, centipawns; a mate is
   *  ±(10000 − 10·moves), so it can be compared with centipawns (see scoreCp in evaluate.ts). */
  evals: number[];
  /** The engine's move in the position before each move (UCI), where known. */
  best: (string | null)[];
  /** 'lichess': the evaluations came with the game from Lichess (its server analysis). */
  from: 'local' | 'lichess';
  depth: number;
  moments: KeyMoment[];
  /** Rating Maia was asked about (absent when Maia was not available). */
  maiaRating?: number;
  analysedAt: number;
}

export type Judgment = 'inaccuracy' | 'mistake' | 'blunder';

export const JUDGMENT_NAMES: Record<Judgment | MomentKind, string> = {
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  miss: 'Miss',
};

export const JUDGMENT_SYMBOLS: Record<Judgment, string> = { inaccuracy: '?!', mistake: '?', blunder: '??' };

export const MATE = 10000;

/** Evaluation in centipawns (White's view) → Win% for White, 0–100. */
export function winPct(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Win% for `side`. */
export function winFor(cp: number, side: Side): number {
  const w = winPct(cp);
  return side === 'white' ? w : 100 - w;
}

/** "+1.25", "−0.40", "#3", "#−2" for an encoded evaluation. */
export function formatEval(v: number): string {
  if (Math.abs(v) > MATE - 1000) {
    const n = Math.round((MATE - Math.abs(v)) / 10);
    return `#${v < 0 ? '−' : ''}${n}`;
  }
  const p = v / 100;
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}`;
}

/** Who plays the move at index `ply` (games start from the normal starting position). */
export const moverOf = (ply: number): Side => (ply % 2 === 0 ? 'white' : 'black');

/** Win% the move at `ply` lost for the side that played it (0 if it did not get worse). */
export function lossAt(evals: readonly number[], ply: number): number {
  const side = moverOf(ply);
  return Math.max(0, winFor(evals[ply], side) - winFor(evals[ply + 1], side));
}

export function judge(loss: number): Judgment | null {
  if (loss >= 15) return 'blunder';
  if (loss >= 10) return 'mistake';
  if (loss >= 5) return 'inaccuracy';
  return null;
}

/** Accuracy of one move from the Win% before and after it (mover's view). */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

function stdDev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/** Lichess' game accuracy for `side`, optionally only over the moves `include` accepts. Null without moves. */
export function accuracy(evals: readonly number[], side: Side, include: (ply: number) => boolean = () => true): number | null {
  const wins = evals.map(winPct);
  const moves = wins.length - 1;
  if (moves < 1) return null;
  const size = Math.max(2, Math.min(8, Math.floor(wins.length / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < size - 2 && windows.length < moves; i++) windows.push(wins.slice(0, size));
  for (let i = 0; i + size <= wins.length && windows.length < moves; i++) windows.push(wins.slice(i, i + size));
  while (windows.length < moves) windows.push(wins.slice(-size));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));

  let weighted = 0;
  let weightSum = 0;
  let harmonic = 0;
  let n = 0;
  for (let ply = 0; ply < moves; ply++) {
    if (moverOf(ply) !== side || !include(ply)) continue;
    const before = side === 'white' ? wins[ply] : 100 - wins[ply];
    const after = side === 'white' ? wins[ply + 1] : 100 - wins[ply + 1];
    const acc = moveAccuracy(before, after);
    weighted += acc * weights[ply];
    weightSum += weights[ply];
    harmonic += 1 / Math.max(acc, 1);
    n++;
  }
  if (!n) return null;
  return (weighted / weightSum + n / harmonic) / 2;
}

// ---------------------------------------------------------------------------
// Phases

export type Phase = 'opening' | 'middlegame' | 'endgame';

export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

function boardOf(key: string): string[] {
  const rows = key.split(' ')[0].split('/');
  return rows.map((r) => r.replace(/\d/g, (d) => '.'.repeat(Number(d))));
}

function piecesLeft(rows: string[]): number {
  let n = 0;
  for (const r of rows) for (const c of r) if ('nbrqNBRQ'.includes(c)) n++;
  return n;
}

function backRankSparse(rows: string[]): boolean {
  const white = [...rows[7]].filter((c) => c !== '.' && c === c.toUpperCase()).length;
  const black = [...rows[0]].filter((c) => c !== '.' && c === c.toLowerCase()).length;
  return white < 4 || black < 4;
}

/** Index of the first position of the middlegame and of the endgame (positions.length when never reached). */
export function divide(positionKeys: readonly string[]): { middlegame: number; endgame: number } {
  const n = positionKeys.length;
  let middlegame = n;
  let endgame = n;
  for (let i = 0; i < n; i++) {
    const rows = boardOf(positionKeys[i]);
    const left = piecesLeft(rows);
    if (middlegame === n && (left <= 10 || backRankSparse(rows))) middlegame = i;
    if (middlegame !== n && left <= 6) {
      endgame = i;
      break;
    }
  }
  return { middlegame, endgame };
}

export function phaseOf(ply: number, d: { middlegame: number; endgame: number }): Phase {
  return ply >= d.endgame ? 'endgame' : ply >= d.middlegame ? 'middlegame' : 'opening';
}

// ---------------------------------------------------------------------------
// One game, summed up

export interface SideSummary {
  accuracy: number | null;
  byPhase: Record<Phase, number | null>;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  misses: number;
}

export interface MoveVerdict {
  loss: number;
  judgment: Judgment | null;
  miss: boolean;
}

/** Judgment of every move; a mistake or blunder right after one of the opponent's is a miss. */
export function verdicts(evals: readonly number[]): MoveVerdict[] {
  const out: MoveVerdict[] = [];
  for (let ply = 0; ply + 1 < evals.length; ply++) {
    const loss = lossAt(evals, ply);
    const judgment = judge(loss);
    const prev = out[ply - 1];
    const miss = !!prev && loss >= 10 && prev.loss >= 10;
    out.push({ loss, judgment, miss });
  }
  return out;
}

export function summarize(evals: readonly number[], d: { middlegame: number; endgame: number }, side: Side): SideSummary {
  const v = verdicts(evals);
  const s: SideSummary = {
    accuracy: accuracy(evals, side),
    byPhase: {
      opening: accuracy(evals, side, (p) => phaseOf(p, d) === 'opening'),
      middlegame: accuracy(evals, side, (p) => phaseOf(p, d) === 'middlegame'),
      endgame: accuracy(evals, side, (p) => phaseOf(p, d) === 'endgame'),
    },
    inaccuracies: 0,
    mistakes: 0,
    blunders: 0,
    misses: 0,
  };
  v.forEach((m, ply) => {
    if (moverOf(ply) !== side) return;
    if (m.miss) s.misses++;
    else if (m.judgment === 'inaccuracy') s.inaccuracies++;
    else if (m.judgment === 'mistake') s.mistakes++;
    else if (m.judgment === 'blunder') s.blunders++;
  });
  return s;
}

/** The moves worth a closer look: your mistakes and blunders (misses included), at most `max`, biggest first. */
export function candidateMoments(evals: readonly number[], side: Side, threshold = 10, max = 8): number[] {
  const plies: { ply: number; loss: number }[] = [];
  for (let ply = 0; ply + 1 < evals.length; ply++) {
    if (moverOf(ply) !== side) continue;
    const loss = lossAt(evals, ply);
    if (loss >= threshold) plies.push({ ply, loss });
  }
  return plies
    .sort((a, b) => b.loss - a.loss)
    .slice(0, max)
    .map((p) => p.ply)
    .sort((a, b) => a - b);
}

export function momentKind(evals: readonly number[], ply: number): MomentKind {
  const v = verdicts(evals);
  if (v[ply]?.miss) return 'miss';
  const loss = v[ply]?.loss ?? 0;
  return loss >= 15 ? 'blunder' : loss >= 10 ? 'mistake' : 'inaccuracy';
}

/** Worth a closer look: a mistake or blunder, or a smaller slip that let a clearly better position (70%+ to win)
 *  get away. Those are often the most instructive (a win that was there), and they sit close to the mistake line,
 *  where a slightly deeper or shallower search tips the verdict either way. */
export function isMoment(evals: readonly number[], ply: number): boolean {
  const loss = lossAt(evals, ply);
  return loss >= 10 || (loss >= 7 && winFor(evals[ply], moverOf(ply)) >= 70);
}

/** Below this share of players at your level finding the move, it counts as an engine move: shown, not suggested. */
export const LEARNABLE = 0.08;

/** Whether a moment is suggested as a training card: learnable at your level (when Maia could tell), or a threat
 *  you overlooked (seeing the threat is the lesson, even when the best answer is hard to find). */
export function isLearnable(m: KeyMoment): boolean {
  return !m.maia || m.maia.best >= LEARNABLE || !!m.threat?.length;
}

/** "23.", "23…" */
export function moveNo(ply: number): string {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}.` : `${n}…`;
}

const pct = (x: number) => (x >= 0.995 ? '99%' : x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

/** A few sentences on what happened at a moment, in plain words. */
export function explainMoment(
  m: Pick<KeyMoment, 'ply' | 'kind' | 'best' | 'line' | 'bestEval' | 'playedEval' | 'reply' | 'threat' | 'maia'>,
  ctx: { played: string; previous?: string; rating?: number },
): string[] {
  const out: string[] = [];
  const no = moveNo(m.ply);
  const best = m.best[0];
  const swing = `${formatEval(m.bestEval)} → ${formatEval(m.playedEval)}`;
  if (m.kind === 'miss' && ctx.previous) {
    out.push(`Your opponent's ${moveNo(m.ply - 1)}${ctx.previous} was a mistake, and ${no}${best} would have punished it. ${no}${ctx.played} let the chance go (${swing}).`);
  } else if (m.threat?.length) {
    // A capture or check is a threat; a quiet move is a plan (like …f6 closing a file).
    const forcing = /[x+#]/.test(m.threat[0]);
    out.push(
      `Your opponent ${forcing ? 'was threatening' : 'was about to play'} ${moveNo(m.ply + 1)}${m.threat[0]}, and ${no}${ctx.played} did not ${forcing ? 'stop' : 'prevent'} it (${swing}). Better was ${no}${best}.`,
    );
  } else {
    out.push(
      `${no}${ctx.played} ${m.kind === 'blunder' ? 'threw away a lot' : m.kind === 'inaccuracy' ? 'let part of your advantage go' : 'gave away part of your position'} (${swing}). Better was ${no}${best}.`,
    );
  }
  if (m.reply?.length && !m.threat?.length) out.push(`After ${ctx.played}, the strongest answer is ${moveNo(m.ply + 1)}${m.reply.slice(0, 3).join(' ')}.`);
  if (m.best.length > 1) out.push(`${m.best.slice(1).join(' and ')} ${m.best.length > 2 ? 'were' : 'was'} fine too.`);
  if (m.maia && ctx.rating) {
    const share = pct(m.maia.best);
    const rating = Math.round(ctx.rating / 50) * 50;
    out.push(
      m.maia.best >= LEARNABLE
        ? `About ${share} of players around ${rating} find ${best} here: worth learning.`
        : m.threat?.length
          ? `Only ${share} of players around ${rating} find ${best}; the lesson here is to see ${moveNo(m.ply + 1)}${m.threat[0]} coming.`
          : `Only ${share} of players around ${rating} find ${best}: more an engine move than something to drill.`,
    );
  }
  return out;
}

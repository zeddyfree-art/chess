// Repertoire checks: gaps against what people actually play (Lichess database) and
// move quality (engine).
import { keyToFen, playSan, type Side } from './chess';
import { evaluate, scoreCp, type Evaluation } from './evaluate';
import { AuthRequiredError, fetchExplorer, totalGames, type ExplorerResult } from './lichess';
import { buildTree, edgeId, isMine, movesAt, ROOT, type EngineFlag, type Repertoire, type TreeNode } from './repertoire';

export interface LineRef {
  /** Position the finding is about. */
  key: string;
  /** SAN moves from the start position to `key`. */
  line: string[];
}

export interface Gap extends LineRef {
  san: string;
  /** Share of games at this position in which the opponent plays this move. */
  share: number;
  /** Estimated share of *all* your games (with this colour) that reach this gap, over every move order. */
  reach: number;
  games: number;
  /** Number of move orders (within your repertoire) that lead to this position. */
  routes: number;
}

export interface LineEnd extends LineRef {
  reach: number;
  games: number;
  topMoves: { san: string; share: number }[];
  routes: number;
}

export interface GapReport {
  gaps: Gap[];
  lineEnds: LineEnd[];
  /** Share of games that stays inside prepared territory (until your lines end). */
  coverage: number;
  positions: number;
  errors: string[];
}

export interface GapOptions {
  ratings: number[];
  speeds: string[];
  /** Ignore everything that happens in fewer than this share of your games. */
  minReach: number;
  maxPly: number;
}

type Explore = (key: string) => Promise<ExplorerResult>;

/** Walks the repertoire against the database, half-move by half-move. A position you can reach by several move
 *  orders (1.d4 Nf6 2.c4 e6 and 1.d4 e6 2.c4 Nf6) is looked at once, with the shares of all routes added up, so
 *  the percentages are of all your games, whichever way they got there. */
export async function findGaps(
  rep: Repertoire,
  opts: GapOptions,
  onProgress: (done: number, current: string[]) => void,
  signal: AbortSignal,
  explorer?: Explore,
): Promise<GapReport> {
  const report: GapReport = { gaps: [], lineEnds: [], coverage: 1, positions: 0, errors: [] };
  let uncovered = 0;
  const gaps = new Map<string, Gap & { best: number }>();
  const ends = new Map<string, LineEnd & { best: number }>();

  const explore = async (key: string): Promise<ExplorerResult | null> => {
    try {
      return await (explorer ?? ((k: string) => fetchExplorer({ db: 'lichess', fen: keyToFen(k), ratings: opts.ratings, speeds: opts.speeds })))(key);
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      report.errors.push((e as Error).message);
      return null;
    }
  };

  // Positions waiting per half-move: reach summed over the routes that arrive there, and the line of the likeliest one.
  type Entry = { reach: number; line: string[]; best: number; routes: number };
  const levels = new Map<number, Map<string, Entry>>();
  const arrive = (ply: number, key: string, reach: number, line: string[], routes = 1) => {
    let level = levels.get(ply);
    if (!level) levels.set(ply, (level = new Map()));
    const e = level.get(key);
    if (!e) level.set(key, { reach, line, best: reach, routes });
    else {
      e.reach += reach;
      e.routes += routes;
      if (reach > e.best) {
        e.best = reach;
        e.line = line;
      }
    }
  };
  arrive(0, ROOT, 1, []);

  for (let ply = 0; ply <= opts.maxPly && [...levels.keys()].some((p) => p >= ply); ply++) {
    const level = levels.get(ply);
    if (!level) continue;
    levels.delete(ply);
    for (const [key, { reach, line, routes }] of [...level].sort((a, b) => b[1].reach - a[1].reach)) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (ply >= opts.maxPly || reach < opts.minReach) continue;
      const prepared = movesAt(rep, key);

      if (isMine(rep, key)) {
        for (const m of prepared) arrive(ply + 1, m.to, reach, [...line, m.san], routes);
        continue;
      }

      onProgress(++report.positions, line);
      const stats = await explore(key);
      if (!stats) continue;
      const total = totalGames(stats);
      if (!total) continue;

      if (!prepared.length) {
        if (line.length) {
          const prev = ends.get(key);
          if (prev) {
            prev.reach += reach;
            prev.routes += routes;
          } else
            ends.set(key, {
              key,
              line,
              reach,
              best: reach,
              routes,
              games: total,
              topMoves: stats.moves.slice(0, 3).map((m) => ({ san: m.san, share: totalGames(m) / total })),
            });
        }
        continue;
      }

      for (const em of stats.moves) {
        const share = totalGames(em) / total;
        const repMove = prepared.find((m) => m.san === em.san);
        if (repMove) arrive(ply + 1, repMove.to, reach * share, [...line, repMove.san], routes);
        else {
          uncovered += reach * share;
          const id = `${key}|${em.san}`;
          const g = gaps.get(id);
          if (g) {
            g.reach += reach * share;
            g.routes += routes;
          } else gaps.set(id, { key, line, san: em.san, share, reach: reach * share, best: reach, games: totalGames(em), routes });
        }
      }
    }
  }

  report.coverage = Math.max(0, 1 - uncovered);
  report.gaps = [...gaps.values()].filter((g) => g.reach >= opts.minReach).map(({ best: _b, ...g }) => g).sort((a, b) => b.reach - a.reach);
  report.lineEnds = [...ends.values()].map(({ best: _b, ...e }) => e).sort((a, b) => b.reach - a.reach);
  return report;
}

// ---------------------------------------------------------------------------

export interface EngineIssue extends LineRef {
  id: string;
  san: string;
  flag: EngineFlag;
}

export interface EngineOptions {
  maxPly: number;
  localDepth: number;
  /** Only report moves losing at least this many centipawns. */
  threshold: number;
}

function lineScore(evaluation: Evaluation, index = 0) {
  const l = evaluation.lines[index];
  return l ? scoreCp(l) : 0;
}

/** Evaluates every one of your moves; returns the flags to store and the issues above the threshold. */
export async function engineCheck(
  rep: Repertoire,
  opts: EngineOptions,
  onProgress: (done: number, total: number, line: string[]) => void,
  signal: AbortSignal,
): Promise<{ flags: Record<string, EngineFlag>; issues: EngineIssue[] }> {
  const items: { node: TreeNode; line: string[] }[] = [];
  const walk = (nodes: TreeNode[], line: string[]) => {
    for (const n of nodes) {
      if (n.ply >= opts.maxPly) continue;
      if (n.mine) items.push({ node: n, line });
      walk(n.children, [...line, n.san]);
    }
  };
  walk(buildTree(rep), []);

  const sign = (side: Side) => (side === 'white' ? 1 : -1);
  const flags: Record<string, EngineFlag> = {};
  const issues: EngineIssue[] = [];
  let done = 0;
  for (const { node, line } of items) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress(done, items.length, [...line, node.san]);
    const before = await evaluate(node.from, { multiPv: 3, localDepth: opts.localDepth });
    const best = before.lines[0];
    if (!best) {
      done++;
      continue;
    }
    const idx = before.lines.findIndex((l) => l.uci[0] === node.uci);
    let mine: number;
    let depth = before.depth;
    if (idx >= 0) mine = lineScore(before, idx);
    else {
      const played = playSan(node.from, node.san);
      const after = played ? await evaluate(played.to, { multiPv: 1, localDepth: opts.localDepth }) : null;
      mine = after && after.lines.length ? lineScore(after) : lineScore(before);
      depth = Math.min(depth, after?.depth ?? depth);
    }
    const loss = Math.max(0, (lineScore(before) - mine) * sign(rep.side));
    const flag: EngineFlag = {
      loss: Math.round(loss),
      bestSan: best.san[0] ?? '',
      bestCp: best.mate !== undefined ? null : (best.cp ?? null),
      depth,
      at: Date.now(),
    };
    flags[edgeId(node.from, node.uci)] = flag;
    if (loss >= opts.threshold) issues.push({ key: node.from, line, id: node.id, san: node.san, flag });
    done++;
  }
  onProgress(done, items.length, []);
  issues.sort((a, b) => b.flag.loss - a.flag.loss);
  return { flags, issues };
}

export function lossLabel(loss: number): { symbol: string; tone: 'ok' | 'dubious' | 'mistake' | 'blunder' } {
  if (loss >= 200) return { symbol: '??', tone: 'blunder' };
  if (loss >= 100) return { symbol: '?', tone: 'mistake' };
  if (loss >= 50) return { symbol: '?!', tone: 'dubious' };
  return { symbol: '', tone: 'ok' };
}

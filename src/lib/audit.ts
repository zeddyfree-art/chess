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
  /** Estimated share of *all* your games (with this colour) that reach this gap. */
  reach: number;
  games: number;
}

export interface LineEnd extends LineRef {
  reach: number;
  games: number;
  topMoves: { san: string; share: number }[];
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

export async function findGaps(
  rep: Repertoire,
  opts: GapOptions,
  onProgress: (done: number, current: string[]) => void,
  signal: AbortSignal,
): Promise<GapReport> {
  const report: GapReport = { gaps: [], lineEnds: [], coverage: 1, positions: 0, errors: [] };
  let uncovered = 0;
  const expanded = new Set<string>();

  const explore = async (key: string): Promise<ExplorerResult | null> => {
    try {
      return await fetchExplorer({ db: 'lichess', fen: keyToFen(key), ratings: opts.ratings, speeds: opts.speeds });
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      report.errors.push((e as Error).message);
      return null;
    }
  };

  const visit = async (key: string, reach: number, line: string[]) => {
    if (signal.aborted) throw new DOMException('Afgebroken', 'AbortError');
    if (expanded.has(key) || line.length >= opts.maxPly || reach < opts.minReach) return;
    expanded.add(key);
    const prepared = movesAt(rep, key);

    if (isMine(rep, key)) {
      for (const m of prepared) await visit(m.to, reach, [...line, m.san]);
      return;
    }

    onProgress(++report.positions, line);
    const stats = await explore(key);
    if (!stats) return;
    const total = totalGames(stats);
    if (!total) return;

    if (!prepared.length) {
      if (line.length) {
        report.lineEnds.push({
          key,
          line,
          reach,
          games: total,
          topMoves: stats.moves.slice(0, 3).map((m) => ({ san: m.san, share: totalGames(m) / total })),
        });
      }
      return;
    }

    for (const em of stats.moves) {
      const share = totalGames(em) / total;
      const repMove = prepared.find((m) => m.san === em.san);
      if (repMove) {
        await visit(repMove.to, reach * share, [...line, repMove.san]);
      } else {
        uncovered += reach * share;
        if (reach * share >= opts.minReach) {
          report.gaps.push({ key, line, san: em.san, share, reach: reach * share, games: totalGames(em) });
        }
      }
    }
  };

  await visit(ROOT, 1, []);
  report.coverage = Math.max(0, 1 - uncovered);
  report.gaps.sort((a, b) => b.reach - a.reach);
  report.lineEnds.sort((a, b) => b.reach - a.reach);
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
    if (signal.aborted) throw new DOMException('Afgebroken', 'AbortError');
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

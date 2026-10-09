// Training in whole lines: which lines to play so that every move to review comes up, in few lines (greedy: each line
// follows the branches with the most moves to review).
// You play all of your moves in a line (from the start, or from the branch you train), the opponent's are played for
// you. The moves to review are the targets; the rest of the line is played for the reflex.
import { edgeId, isMine, movesAt, splitEdgeId, type Repertoire } from './repertoire';

export interface PlannedMove {
  from: string;
  to: string;
  uci: string;
  san: string;
  mine: boolean;
  /** Edge id: the card of this move when it is yours. */
  id: string;
}

/** Shortest sequence of moves from `start` to `target` within the repertoire (null when not reachable). */
function pathBetween(rep: Repertoire, start: string, target: string): PlannedMove[] | null {
  if (start === target) return [];
  const prev = new Map<string, PlannedMove>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length) {
    const key = queue.shift()!;
    for (const m of movesAt(rep, key)) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      prev.set(m.to, { from: key, to: m.to, uci: m.uci, san: m.san, mine: isMine(rep, key), id: edgeId(key, m.uci) });
      if (m.to === target) {
        const path: PlannedMove[] = [];
        for (let cur = target; cur !== start; cur = prev.get(cur)!.from) path.unshift(prev.get(cur)!);
        return path;
      }
      queue.push(m.to);
    }
  }
  return null;
}

/**
 * The next line: from `start` to the first remaining target (in `order`, the tree order), then on to the end of the
 * line, at each of your turns taking a target if there is one and otherwise your main move, and at each of the
 * opponent's turns the reply with the most targets after it. The line stops where your next move would be beyond
 * the training depth or where nothing is prepared. The targets it passes are taken out of `targets` and returned.
 */
export function planLine(
  rep: Repertoire,
  opts: { start: string; targets: Set<string>; order: string[]; inDepth: (from: string) => boolean },
): { moves: PlannedMove[]; covers: Set<string> } | null {
  const { start, targets, inDepth } = opts;
  for (;;) {
    const first = opts.order.find((id) => targets.has(id));
    if (!first) return null;
    const { from, uci } = splitEdgeId(first);
    const prefix = pathBetween(rep, start, from);
    const move = movesAt(rep, from).find((m) => m.uci === uci);
    if (!prefix || !move) {
      targets.delete(first); // gone from the repertoire, or not in this branch
      continue;
    }
    const moves = [...prefix, { from, to: move.to, uci, san: move.san, mine: true, id: first }];

    // How many targets lie after a position (shared continuations counted once per route; good enough to choose).
    const memo = new Map<string, number>();
    const onPath = new Set<string>();
    const ahead = (key: string): number => {
      const known = memo.get(key);
      if (known !== undefined) return known;
      if (onPath.has(key)) return 0;
      onPath.add(key);
      let n = 0;
      for (const m of movesAt(rep, key)) n += (targets.has(edgeId(key, m.uci)) ? 1 : 0) + ahead(m.to);
      onPath.delete(key);
      memo.set(key, n);
      return n;
    };

    const visited = new Set(moves.map((m) => m.from));
    let pos = move.to;
    while (!visited.has(pos)) {
      visited.add(pos);
      const options = movesAt(rep, pos);
      if (!options.length) break;
      if (isMine(rep, pos)) {
        if (!inDepth(pos)) break;
        const m = options.find((x) => targets.has(edgeId(pos, x.uci))) ?? options[0];
        moves.push({ from: pos, to: m.to, uci: m.uci, san: m.san, mine: true, id: edgeId(pos, m.uci) });
        pos = m.to;
      } else {
        let best = options[0];
        let bestN = -1;
        for (const x of options) {
          const n = ahead(x.to);
          if (n > bestN) {
            best = x;
            bestN = n;
          }
        }
        // End after your last move: an opponent's move with nothing (within reach) to answer is left out.
        if (!movesAt(rep, best.to).length || !inDepth(best.to)) break;
        moves.push({ from: pos, to: best.to, uci: best.uci, san: best.san, mine: false, id: edgeId(pos, best.uci) });
        pos = best.to;
      }
    }

    const covers = new Set(moves.filter((m) => m.mine && targets.has(m.id)).map((m) => m.id));
    for (const id of covers) targets.delete(id);
    return { moves, covers };
  }
}

// "Is my move good too?" A training card or a retry knows the engine's best moves; any other move is checked
// with a short local Stockfish search, and counts when it keeps (nearly) as much as the best move.
import { keyToFen, type Side } from './chess';
import { engine } from './engine';
import { scoreCp } from './evaluate';
import { winFor } from './analysis';

/** Win% a move may give away compared with the best move and still count as good (as when the cards were made). */
export const GOOD_ENOUGH = 5;

/** Evaluates the position after your move (`after`, a position key) against the best move's evaluation. */
export async function isGoodToo(after: string, side: Side, bestEval: number): Promise<{ good: boolean; eval: number } | null> {
  const [line] = await engine.analyse(keyToFen(after), { depth: 14, movetime: 1500 });
  if (!line) return null;
  const ev = scoreCp(line);
  return { good: winFor(ev, side) >= winFor(bestEval, side) - GOOD_ENOUGH, eval: ev };
}

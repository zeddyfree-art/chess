// The practice opponent. Like Noctie: in the opening it plays what real people at
// its level play (Lichess database, or your prepared lines), and once out of book a
// human-like network (Maia-3) takes over.
import { keyToFen, playSan, playUci, type PlayedMove } from './chess';
import { fetchExplorer, getToken, RATING_BUCKETS, totalGames } from './lichess';
import { sampleMove } from './maiaEncoding';
import { maiaPredict } from './maia';
import { movesAt, type Repertoire } from './repertoire';

export type MoveSource = 'repertoire' | 'database' | 'maia';

export interface OpponentSettings {
  /** Opponent strength (Maia rating and database rating group). */
  level: number;
  /** Your own rating (Maia uses it as "who am I playing against"). */
  playerRating: number;
  /** 'repertoire': stick to your prepared lines while they last.
   *  'realistic': play what people at this level actually play (may leave your prep). */
  mode: 'repertoire' | 'realistic';
  speeds: string[];
}

export interface OpponentMove {
  move: PlayedMove;
  source: MoveSource;
  /** Probability of this move under the chosen source (for display). */
  p?: number;
}

/** Minimum number of database games before we trust the statistics over Maia. */
const MIN_GAMES = 25;

export function bucketFor(level: number): number {
  let b: number = RATING_BUCKETS[0];
  for (const r of RATING_BUCKETS) if (level >= r) b = r;
  return b;
}

function weighted<T>(items: { item: T; w: number }[], rand = Math.random): T | null {
  const total = items.reduce((a, b) => a + b.w, 0);
  if (!items.length || total <= 0) return items[0]?.item ?? null;
  let r = rand() * total;
  for (const x of items) {
    r -= x.w;
    if (r <= 0) return x.item;
  }
  return items[items.length - 1].item;
}

async function databaseStats(key: string, s: OpponentSettings) {
  if (!getToken()) return null;
  try {
    return await fetchExplorer({ db: 'lichess', fen: keyToFen(key), ratings: [bucketFor(s.level)], speeds: s.speeds });
  } catch {
    return null;
  }
}

export async function chooseOpponentMove(rep: Repertoire | null, key: string, s: OpponentSettings): Promise<OpponentMove | null> {
  const prepared = rep ? movesAt(rep, key) : [];
  const stats = await databaseStats(key, s);
  const total = stats ? totalGames(stats) : 0;

  // 1. Your prepared lines, weighted by how often people play them.
  if (s.mode === 'repertoire' && prepared.length) {
    const pick = weighted(
      prepared.map((m) => {
        const hit = stats?.moves.find((x) => x.san === m.san);
        return { item: m, w: total ? Math.max(1, hit ? totalGames(hit) : 0) : 1 };
      }),
    )!;
    const move = playSan(key, pick.san);
    if (move) return { move, source: 'repertoire' };
  }

  // 2. Real games at this level.
  if (stats && total >= MIN_GAMES && stats.moves.length) {
    const pick = weighted(stats.moves.map((m) => ({ item: m, w: totalGames(m) })))!;
    const move = playSan(key, pick.san);
    if (move) return { move, source: 'database', p: totalGames(pick) / total };
  }

  // 3. Maia.
  const { moves } = await maiaPredict(key, s.level, s.playerRating);
  const pick = sampleMove(moves);
  if (!pick) return null;
  const move = playUci(key, pick.uci);
  return move ? { move, source: 'maia', p: pick.p } : null;
}

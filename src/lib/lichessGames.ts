// Your own games from Lichess (public API, no login needed; when you are logged in to Lichess in this app
// the download is faster). Games Lichess has analysed come with its evaluations, so they need no first
// engine pass here.
import { playSan, START_KEY } from './chess';
import { MATE } from './analysis';
import type { GameResult, GameSpeed, PgnGame } from './games';
import { getToken, LICHESS } from './lichess';

interface LichessPlayer {
  user?: { name: string; id: string };
  rating?: number;
  aiLevel?: number;
}

interface LichessEval {
  eval?: number;
  mate?: number;
  best?: string;
}

/** One game as the export API sends it (ndjson). */
export interface LichessGameJson {
  id: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  createdAt?: number;
  lastMoveAt?: number;
  status?: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  opening?: { eco?: string; name?: string };
  moves?: string;
  analysis?: LichessEval[];
  /** Clock of the mover after each move, in centiseconds (when asked for). */
  clocks?: number[];
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
  initialFen?: string;
}

export interface LichessQuery {
  username: string;
  since?: number;
  speeds?: GameSpeed[];
  ratedOnly?: boolean;
  max?: number;
  signal?: AbortSignal;
  /** Called as games come in (the download streams). */
  onProgress?: (count: number) => void;
}

const TERMINATION: Record<string, string> = {
  mate: 'Checkmate',
  resign: 'Resignation',
  stalemate: 'Stalemate',
  timeout: 'Left the game',
  draw: 'Draw',
  outoftime: 'Time forfeit',
  cheat: 'Cheat detected',
  variantEnd: 'Variant ending',
  unknownFinish: 'Unknown',
};

const playerName = (p: LichessPlayer) => p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');

const encodeEval = (e: LichessEval): number | null =>
  e.mate !== undefined ? Math.sign(e.mate) * (MATE - Math.abs(e.mate) * 10) : e.eval !== undefined ? e.eval : null;

/** A Lichess export game as an importable game; a string says why it was left out. */
export function fromLichessJson(g: LichessGameJson): PgnGame | string {
  if (g.variant && g.variant !== 'standard') return 'other chess variants';
  if (g.initialFen) return 'not from the starting position';
  if (g.status === 'aborted' || g.status === 'noStart' || g.status === 'created' || g.status === 'started') return 'aborted or unfinished';
  const moves: string[] = [];
  let key = START_KEY;
  for (const san of (g.moves ?? '').split(' ').filter(Boolean)) {
    const m = playSan(key, san);
    if (!m) return 'an illegal move';
    moves.push(m.san);
    key = m.to;
  }
  if (moves.length < 2) return 'fewer than two moves';
  const result: GameResult = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2';
  const out: PgnGame = {
    sourceId: `lichess:${g.id}`,
    url: `${LICHESS}/${g.id}`,
    white: playerName(g.players.white),
    black: playerName(g.players.black),
    whiteElo: g.players.white.rating,
    blackElo: g.players.black.rating,
    result,
    playedAt: g.lastMoveAt ?? g.createdAt ?? Date.now(),
    speed: (g.speed as GameSpeed | undefined) ?? undefined,
    timeControl: g.clock ? `${g.clock.initial}+${g.clock.increment}` : g.daysPerTurn ? `1/${g.daysPerTurn * 86400}` : '-',
    rated: g.rated,
    opening: g.opening?.name,
    eco: g.opening?.eco,
    termination: TERMINATION[g.status ?? ''],
    moves,
  };
  if (g.clocks?.length) {
    // One entry per move; some exports put the starting time first.
    const c = g.clocks.length === moves.length + 1 ? g.clocks.slice(1) : g.clocks;
    out.clocks = moves.map((_, i) => (c[i] === undefined ? null : c[i] / 100));
  }
  if (g.analysis?.length) {
    // analysis[i] is about the position after move i+1, and its `best` about the move that should have been played.
    out.lichessEvals = [null, ...g.analysis.slice(0, moves.length).map(encodeEval)];
    out.lichessBest = g.analysis.slice(0, moves.length).map((e) => e.best ?? null);
  }
  return out;
}

export class LichessUserNotFound extends Error {
  constructor(user: string) {
    super(`Lichess has no player called “${user}”.`);
  }
}

/** Downloads a player's games, newest first. */
export async function fetchLichessGames(q: LichessQuery): Promise<{ games: PgnGame[]; skipped: { reason: string; n: number }[] }> {
  const params = new URLSearchParams({ moves: 'true', evals: 'true', opening: 'true', clocks: 'true', ongoing: 'false', finished: 'true' });
  if (q.since) params.set('since', String(q.since));
  if (q.max) params.set('max', String(q.max));
  if (q.speeds?.length) params.set('perfType', q.speeds.join(','));
  if (q.ratedOnly) params.set('rated', 'true');
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${LICHESS}/api/games/user/${encodeURIComponent(q.username.trim())}?${params}`, { headers, signal: q.signal }).catch((e) => {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Could not reach Lichess. Check your internet connection.');
  });
  if (res.status === 404) throw new LichessUserNotFound(q.username);
  if (res.status === 429) throw new Error('Lichess asks to slow down. Try again in a minute.');
  if (!res.ok) throw new Error(`Lichess responded ${res.status}.`);

  const games: PgnGame[] = [];
  const skipped = new Map<string, number>();
  const take = (line: string) => {
    if (!line.trim()) return;
    let json: LichessGameJson;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const g = fromLichessJson(json);
    if (typeof g === 'string') skipped.set(g, (skipped.get(g) ?? 0) + 1);
    else games.push(g);
    q.onProgress?.(games.length);
  };

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        take(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    take(buf + decoder.decode());
  } else {
    for (const line of (await res.text()).split('\n')) take(line);
  }
  return { games, skipped: [...skipped].map(([reason, n]) => ({ reason, n })) };
}

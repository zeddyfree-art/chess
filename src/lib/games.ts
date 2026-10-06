// Games you played (imported from Lichess or a PGN file), kept apart from the repertoires: they are
// stored per player, analysed by the engine (analysis.ts) and turned into training cards on request.
import { parsePgn, type Game, type PgnNodeData } from 'chessops/pgn';
import { START_KEY, playSan, type PlayedMove, type Side } from './chess';
import type { GameAnalysis } from './analysis';

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type GameSpeed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

export interface PlayedGame {
  /** `<profile id>|<source id>`: the same game can belong to two players of this app (who played each other). */
  id: string;
  profileId: string;
  source: 'lichess' | 'pgn';
  /** Where the game can be seen online, when known. */
  url?: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  myColor: Side;
  result: GameResult;
  /** When the game ended (or started, if that is all the file says). */
  playedAt: number;
  speed?: GameSpeed;
  timeControl?: string;
  rated?: boolean;
  opening?: string;
  eco?: string;
  /** How it ended, in words ("Resignation", "Time forfeit", …), when known. */
  termination?: string;
  /** The moves (SAN) from the starting position. */
  moves: string[];
  addedAt: number;
  updatedAt: number;
  analysis?: GameAnalysis;
  /** Evaluations that came with the game (Lichess' own server analysis), used instead of a first engine pass:
   *  per position (0 = start), White's view in centipawns (mates encoded as in analysis.ts); null where unknown. */
  lichessEvals?: (number | null)[];
  /** Lichess' better move for the position before each move, where it gave one (UCI). */
  lichessBest?: (string | null)[];
  /** Mistakes (by half-move index) you chose not to train, so they are not suggested again. */
  dismissed?: number[];
}

export interface GamesData {
  version: 1;
  games: PlayedGame[];
  /** Deleted games (id → time), so a deletion survives syncing. */
  deleted: Record<string, number>;
}

export const EMPTY_GAMES: GamesData = { version: 1, games: [], deleted: {} };

export const SPEED_NAMES: Record<GameSpeed, string> = {
  ultraBullet: 'UltraBullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Daily',
};

export const gameId = (profileId: string, sourceId: string) => `${profileId}|${sourceId}`;

/** The moves of a game as steps from the starting position; stops at the first move that is not legal. */
export function gameLine(moves: readonly string[]): PlayedMove[] {
  const out: PlayedMove[] = [];
  let key = START_KEY;
  for (const san of moves) {
    const m = playSan(key, san);
    if (!m) break;
    out.push(m);
    key = m.to;
  }
  return out;
}

export function opponentOf(g: PlayedGame): { name: string; elo?: number } {
  return g.myColor === 'white' ? { name: g.black, elo: g.blackElo } : { name: g.white, elo: g.whiteElo };
}

export function myElo(g: PlayedGame): number | undefined {
  return g.myColor === 'white' ? g.whiteElo : g.blackElo;
}

/** 'win' | 'loss' | 'draw' | null (unfinished) from the player's point of view. */
export function outcome(g: PlayedGame): 'win' | 'loss' | 'draw' | null {
  if (g.result === '1/2-1/2') return 'draw';
  if (g.result === '*') return null;
  return (g.result === '1-0') === (g.myColor === 'white') ? 'win' : 'loss';
}

export function formatDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "vs Kierkov1954 (1267) · 8 Sep 2026" */
export function gameLabel(g: PlayedGame): string {
  const opp = opponentOf(g);
  return `vs ${opp.name}${opp.elo ? ` (${opp.elo})` : ''} · ${formatDate(g.playedAt)}`;
}

/** Lichess' speed categories from a PGN TimeControl ("600+5", "1/259200" for daily, "-" for none). */
export function speedFromTimeControl(tc: string | undefined): GameSpeed | undefined {
  if (!tc || tc === '?') return undefined;
  if (tc === '-' || tc.includes('/')) return 'correspondence';
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc);
  if (!m) return undefined;
  const estimate = Number(m[1]) + 40 * Number(m[2] ?? 0);
  if (estimate < 30) return 'ultraBullet';
  if (estimate < 180) return 'bullet';
  if (estimate < 480) return 'blitz';
  if (estimate < 1500) return 'rapid';
  return 'classical';
}

// ---------------------------------------------------------------------------
// PGN files

export interface PgnGame {
  sourceId: string;
  url?: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: GameResult;
  playedAt: number;
  speed?: GameSpeed;
  timeControl?: string;
  rated?: boolean;
  opening?: string;
  eco?: string;
  termination?: string;
  moves: string[];
  lichessEvals?: (number | null)[];
  lichessBest?: (string | null)[];
}

export interface PgnGamesResult {
  games: PgnGame[];
  /** Games that could not be used, by reason. */
  skipped: { reason: string; n: number }[];
  /** Player names in the file, most frequent first (to find out which one is you). */
  names: { name: string; n: number }[];
}

/** A short, stable fingerprint, so importing the same file twice does not add the games twice. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function parseDate(date: string | undefined, time?: string): number | undefined {
  const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/.exec(date ?? '');
  if (!m) return undefined;
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time ?? '');
  return Date.UTC(+m[1], +m[2] - 1, +m[3], t ? +t[1] : 12, t ? +t[2] : 0, t ? +(t[3] ?? 0) : 0);
}

function sourceIdOf(h: Map<string, string>, moves: string[]): { sourceId: string; url?: string } {
  const site = h.get('Site') ?? '';
  const link = h.get('Link') ?? '';
  const lichess = /lichess\.org\/([A-Za-z0-9]{8})/.exec(site) ?? /lichess\.org\/([A-Za-z0-9]{8})/.exec(link);
  if (lichess) return { sourceId: `lichess:${lichess[1]}`, url: `https://lichess.org/${lichess[1]}` };
  const chesscom = /chess\.com\/(?:game\/)?(?:live|daily)\/(?:game\/)?(\d+)/.exec(link) ?? /chess\.com\/(?:game\/)?(?:live|daily)\/(?:game\/)?(\d+)/.exec(site);
  if (chesscom) return { sourceId: `chesscom:${chesscom[1]}`, url: link || site };
  const fingerprint = [h.get('White'), h.get('Black'), h.get('Date'), h.get('Round'), moves.join(' ')].join('|');
  return { sourceId: `pgn:${hash(fingerprint)}` };
}

/** "French-Defense-Winawer-Variation" from a Chess.com opening link. */
function openingFromUrl(url: string | undefined): string | undefined {
  const slug = /\/openings\/([^?#]+)/.exec(url ?? '')?.[1];
  if (!slug) return undefined;
  return decodeURIComponent(slug)
    .replace(/-\d.*$/, '') // drop the move list Chess.com appends
    .replace(/-/g, ' ')
    .trim();
}

const RESULTS: GameResult[] = ['1-0', '0-1', '1/2-1/2', '*'];

function fromPgnGame(g: Game<PgnNodeData>): PgnGame | string {
  const h = g.headers;
  const variant = (h.get('Variant') ?? 'standard').toLowerCase();
  if (variant !== 'standard' && variant !== 'from position') return 'other chess variants';
  if (h.get('FEN') || h.get('SetUp') === '1') return 'not from the starting position';

  const moves: string[] = [];
  let key = START_KEY;
  for (const node of g.moves.mainline()) {
    const m = playSan(key, node.san);
    if (!m) return moves.length ? 'an illegal move' : 'no moves';
    moves.push(m.san);
    key = m.to;
  }
  if (moves.length < 2) return 'fewer than two moves';

  const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : undefined);
  const result = (RESULTS as string[]).includes(h.get('Result') ?? '') ? (h.get('Result') as GameResult) : '*';
  const ended = parseDate(h.get('EndDate'), h.get('EndTime'));
  const started = parseDate(h.get('UTCDate') ?? h.get('Date'), h.get('UTCTime') ?? h.get('StartTime'));
  const event = h.get('Event') ?? '';
  const { sourceId, url } = sourceIdOf(h, moves);
  return {
    sourceId,
    url,
    white: h.get('White') || 'White',
    black: h.get('Black') || 'Black',
    whiteElo: num(h.get('WhiteElo')),
    blackElo: num(h.get('BlackElo')),
    result,
    playedAt: ended ?? started ?? Date.now(),
    speed: speedFromTimeControl(h.get('TimeControl')),
    timeControl: h.get('TimeControl'),
    rated: /\brated\b/i.test(event) ? !/\bcasual\b/i.test(event) : undefined,
    opening: h.get('Opening') || openingFromUrl(h.get('ECOUrl')),
    eco: h.get('ECO'),
    termination: h.get('Termination'),
    moves,
  };
}

export function parsePgnGames(text: string): PgnGamesResult {
  const games: PgnGame[] = [];
  const skipped = new Map<string, number>();
  const names = new Map<string, { name: string; n: number }>();
  for (const g of parsePgn(text)) {
    const parsed = fromPgnGame(g);
    if (typeof parsed === 'string') {
      skipped.set(parsed, (skipped.get(parsed) ?? 0) + 1);
      continue;
    }
    games.push(parsed);
    for (const name of [parsed.white, parsed.black]) {
      const k = name.toLowerCase();
      const e = names.get(k) ?? { name, n: 0 };
      e.n++;
      names.set(k, e);
    }
  }
  return {
    games,
    skipped: [...skipped].map(([reason, n]) => ({ reason, n })),
    names: [...names.values()].sort((a, b) => b.n - a.n),
  };
}

/** Which colour `names` (any of the player's usernames) played, or null if neither player is them. */
export function colorOf(g: { white: string; black: string }, names: readonly string[]): Side | null {
  const set = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (set.has(g.white.toLowerCase())) return 'white';
  if (set.has(g.black.toLowerCase())) return 'black';
  return null;
}

export function toPlayedGame(g: PgnGame, profileId: string, myColor: Side, source: PlayedGame['source'] = 'pgn'): PlayedGame {
  const now = Date.now();
  const { sourceId, ...rest } = g;
  return { ...rest, id: gameId(profileId, sourceId), profileId, source, myColor, addedAt: now, updatedAt: now };
}

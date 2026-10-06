// Tactical themes of a mistake, read from the lines the analysis already stored: the engine's line from the
// position (what you missed) and the opponent's best answer to your move (what you allowed). Simple, explainable
// rules, in the spirit of Lichess' puzzle themes:
// - mate: the line ends in checkmate;
// - fork: a move after which the moved piece attacks two valuable pieces (or the king and a piece), and
//   material is won in the line;
// - pin: a move after which a bishop, rook or queen attacks a piece with a more valuable piece (or the king)
//   behind it on the same line;
// - hanging piece / lost material: the answer to your move wins at least a piece / two pawns' worth;
// - winning material: the better line wins at least two pawns' worth;
// - sacrifice: the better move gives up material that the line does not get back at once, and still stands well;
// - promotion: the line promotes a pawn;
// - threat: you overlooked what the opponent was threatening (from the analysis).
import { attacks, between } from 'chessops';
import type { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import type { Piece, Role, Square } from 'chessops/types';
import { keyToFen, posFromFen, type Side } from './chess';

export type Theme =
  | 'missed-mate'
  | 'allowed-mate'
  | 'missed-fork'
  | 'allowed-fork'
  | 'missed-pin'
  | 'allowed-pin'
  | 'hanging'
  | 'lost-material'
  | 'missed-material'
  | 'sacrifice'
  | 'promotion'
  | 'threat';

export const THEME_NAMES: Record<Theme, string> = {
  'missed-mate': 'Missed mate',
  'allowed-mate': 'Allowed mate',
  'missed-fork': 'Missed fork',
  'allowed-fork': 'Allowed a fork',
  'missed-pin': 'Missed pin',
  'allowed-pin': 'Allowed a pin',
  hanging: 'Left a piece hanging',
  'lost-material': 'Lost material',
  'missed-material': 'Missed winning material',
  sacrifice: 'Missed sacrifice',
  promotion: 'Promotion',
  threat: 'Overlooked threat',
};

/** What to practise when a theme keeps coming back. */
export const THEME_ADVICE: Record<Theme, string> = {
  'missed-mate': 'Look for checks first, every move: mates hide behind them.',
  'allowed-mate': 'Before each move, check every check your opponent could give in reply.',
  'missed-fork': 'Look for squares where your knight or queen attacks two things at once.',
  'allowed-fork': 'Before you move, look for squares where an enemy knight or queen would attack two of your pieces.',
  'missed-pin': 'Line up your bishops, rooks and queen with the enemy king and queen.',
  'allowed-pin': 'Watch out for your pieces standing in line with your king or queen.',
  hanging: 'Blunder check: after your move, which of your pieces are attacked and not defended?',
  'lost-material': 'Blunder check: after your move, what can your opponent capture?',
  'missed-material': 'After each move of your opponent, ask: what did it leave undefended?',
  sacrifice: 'When the enemy king is exposed, also consider giving material to open it up.',
  promotion: 'Passed pawns run fast in the endgame: count the moves to promotion.',
  threat: 'Before each move, ask: what does my opponent want to do now?',
};

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

function material(pos: Chess, side: Side): number {
  let total = 0;
  for (const sq of pos.board[side]) {
    const role = pos.board.getRole(sq);
    if (role) total += VALUE[role];
  }
  return total;
}

const balance = (pos: Chess, side: Side) => material(pos, side) - material(pos, side === 'white' ? 'black' : 'white');

/** Plays a SAN line on a copy; returns the positions before each move and the moves (stops at an illegal one). */
function replay(start: Chess, sans: readonly string[]) {
  const pos = start.clone();
  const steps: { before: Chess; to: Square; piece: Piece; san: string }[] = [];
  for (const san of sans) {
    const m = parseSan(pos, san);
    if (!m || !('from' in m)) break;
    const piece = pos.board.get(m.from);
    if (!piece) break;
    const before = pos.clone();
    pos.play(m);
    steps.push({ before, to: m.to, piece: m.promotion ? { ...piece, role: m.promotion } : piece, san });
  }
  return { end: pos, steps };
}

/** After a move to `to`: does the moved piece attack two valuable enemy pieces (or the king and a piece)? */
function isFork(after: Chess, to: Square, piece: Piece): boolean {
  const enemy = piece.color === 'white' ? 'black' : 'white';
  const hit = attacks(piece, to, after.board.occupied).intersect(after.board[enemy]);
  let targets = 0;
  for (const sq of hit) {
    const role = after.board.getRole(sq)!;
    if (role === 'king' || (role !== 'pawn' && VALUE[role] >= Math.max(3, VALUE[piece.role]))) targets++;
  }
  return targets >= 2;
}

/** After a move to `to`: does a sliding piece pin or skewer (a piece with a more valuable one, or the king, behind it)? */
function isPin(after: Chess, to: Square, piece: Piece): boolean {
  if (piece.role !== 'bishop' && piece.role !== 'rook' && piece.role !== 'queen') return false;
  const enemy = piece.color === 'white' ? 'black' : 'white';
  const occupied = after.board.occupied;
  const first = attacks(piece, to, occupied).intersect(after.board[enemy]);
  for (const sq of first) {
    const front = after.board.getRole(sq)!;
    const behind = attacks(piece, to, occupied.without(sq)).diff(attacks(piece, to, occupied)).intersect(after.board[enemy]);
    for (const b of behind) {
      if (!between(to, b).has(sq)) continue;
      const back = after.board.getRole(b)!;
      if ((back === 'king' && front !== 'pawn') || VALUE[back] > VALUE[front] + 1) return true;
    }
  }
  return false;
}

interface Line {
  start: Chess;
  sans: readonly string[];
  /** Whose moves we look at for forks and pins (the side that benefits from the line). */
  side: Side;
}

function lineThemes({ start, sans, side }: Line): { mate: boolean; fork: boolean; pin: boolean; gain: number; promotion: boolean; sacrifice: boolean } {
  const { end, steps } = replay(start, sans);
  const gain = balance(end, side) - balance(start, side);
  let fork = false;
  let pin = false;
  for (let i = 0; i < Math.min(steps.length, 5); i++) {
    const s = steps[i];
    if (s.piece.color !== side) continue;
    const after = i + 1 < steps.length ? steps[i + 1].before : end;
    if (!fork && isFork(after, s.to, s.piece) && gain >= 2) fork = true;
    if (!pin && isPin(after, s.to, s.piece) && gain >= 2) pin = true;
  }
  // A sacrifice: after the first two half-moves the side is down material, and the line does not regain it right away.
  const twoIn = steps.length >= 2 ? (steps[2]?.before ?? end) : end;
  const sacrifice = steps.length >= 2 && steps[0].piece.color === side && balance(twoIn, side) - balance(start, side) <= -2;
  return { mate: end.isCheckmate(), fork, pin, gain, promotion: sans.some((x) => x.includes('=')), sacrifice };
}

/** Themes of one mistake. `key` is the position before your move; `best` the engine's line from there;
 *  `reply` the opponent's best answer to the move you played. */
export function themesOf(m: { key: string; side: Side; played: string; line: readonly string[]; reply?: readonly string[]; threat?: readonly string[]; bestEval: number }): Theme[] {
  const out: Theme[] = [];
  let start: Chess;
  try {
    start = posFromFen(keyToFen(m.key));
  } catch {
    return out;
  }
  const enemy: Side = m.side === 'white' ? 'black' : 'white';
  // What you missed: the engine's line from the position.
  const missed = lineThemes({ start, sans: m.line, side: m.side });
  if (missed.mate) out.push('missed-mate');
  if (missed.fork) out.push('missed-fork');
  if (missed.pin) out.push('missed-pin');
  if (missed.sacrifice && !missed.mate) out.push('sacrifice');
  else if (missed.gain >= 2 && !missed.fork && !missed.pin && !missed.mate) out.push('missed-material');
  if (missed.promotion) out.push('promotion');

  // What you allowed: the opponent's best answer after your move.
  if (m.reply?.length) {
    const played = replay(start, [m.played]);
    if (played.steps.length) {
      const allowed = lineThemes({ start: played.end, sans: m.reply, side: enemy });
      const lost = allowed.gain;
      if (allowed.mate) out.push('allowed-mate');
      if (allowed.fork) out.push('allowed-fork');
      if (allowed.pin) out.push('allowed-pin');
      if (!allowed.fork && !allowed.pin && !allowed.mate && lost >= 2) {
        const first = replay(played.end, m.reply.slice(0, 1)).steps[0];
        const captured = first ? played.end.board.getRole(first.to) : undefined;
        out.push(captured && captured !== 'pawn' && lost >= 3 ? 'hanging' : 'lost-material');
      }
    }
  }
  if (m.threat?.length) out.push('threat');
  return [...new Set(out)];
}

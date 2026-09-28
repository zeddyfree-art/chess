// Thin helpers around chessops. Everything else in the app talks in FEN strings,
// SAN and UCI so that data stays plain JSON.
import { Chess } from 'chessops/chess';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import { chessgroundDests } from 'chessops/compat';
import { makeSquare, makeUci, parseSquare, parseUci } from 'chessops/util';
import type { Move, NormalMove, Role } from 'chessops/types';

export type Side = 'white' | 'black';

export const START_FEN = INITIAL_FEN;

export function posFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

/** Position identity: board, side to move, castling rights and a *legal* en-passant square.
 *  Move counters are dropped so transpositions map to the same key. */
export function keyOfPos(pos: Chess): string {
  return makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ');
}

export function fenKey(fen: string): string {
  return keyOfPos(posFromFen(fen));
}

/** A key is a valid FEN once we append dummy counters. */
export function keyToFen(key: string): string {
  return `${key} 0 1`;
}

export const START_KEY = fenKey(START_FEN);

export function turnOfKey(key: string): Side {
  return key.split(' ')[1] === 'w' ? 'white' : 'black';
}

export interface PlayedMove {
  san: string;
  uci: string;
  from: string; // key before
  to: string; // key after
}

function play(pos: Chess, move: Move): PlayedMove {
  const from = keyOfPos(pos);
  const san = makeSan(pos, move);
  const uci = makeUci(move);
  pos.play(move);
  return { san, uci, from, to: keyOfPos(pos) };
}

export function playSan(key: string, san: string): PlayedMove | null {
  const pos = posFromFen(keyToFen(key));
  const move = parseSan(pos, san);
  if (!move) return null;
  return play(pos, move);
}

/** Accepts both chessops castling (e1h1) and standard UCI castling (e1g1). */
export function playUci(key: string, uci: string): PlayedMove | null {
  const pos = posFromFen(keyToFen(key));
  const move = normalizeUci(pos, uci);
  if (!move || !pos.isLegal(move)) return null;
  return play(pos, move);
}

export function normalizeUci(pos: Chess, uci: string): Move | undefined {
  const move = parseUci(uci);
  if (!move || !('from' in move)) return move;
  const piece = pos.board.get(move.from);
  if (piece?.role === 'king' && Math.abs((move.from & 7) - (move.to & 7)) === 2) {
    const rookFile = (move.to & 7) > (move.from & 7) ? 7 : 0;
    return { from: move.from, to: (move.from & ~7) + rookFile };
  }
  return move;
}

export function dests(key: string) {
  return chessgroundDests(posFromFen(keyToFen(key)));
}

/** Converts a chessground drag (king e1->g1 or e1->h1 both allowed) into a legal move. */
export function moveFromBoard(key: string, orig: string, dest: string, promotion?: Role): PlayedMove | null {
  const pos = posFromFen(keyToFen(key));
  const from = parseSquare(orig);
  const to = parseSquare(dest);
  if (from === undefined || to === undefined) return null;
  const piece = pos.board.get(from);
  let move: NormalMove = { from, to };
  if (piece?.role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0)) move.promotion = promotion ?? 'queen';
  if (piece?.role === 'king') {
    const normalized = normalizeUci(pos, `${orig}${dest}`);
    if (normalized && 'from' in normalized) move = normalized;
  }
  if (!pos.isLegal(move)) return null;
  return play(pos, move);
}

/** For drawing arrows: castling is shown as the king moving two squares. */
export function uciToArrow(uci: string): [string, string] {
  const from = uci.slice(0, 2);
  let to = uci.slice(2, 4);
  if ((from === 'e1' || from === 'e8') && ['a1', 'h1', 'a8', 'h8'].includes(to)) {
    to = (to[0] === 'h' ? 'g' : 'c') + to[1];
  }
  return [from, to];
}

export function isCheck(key: string): boolean {
  return posFromFen(keyToFen(key)).isCheck();
}

export function sanToUci(key: string, san: string): string | null {
  return playSan(key, san)?.uci ?? null;
}

/** "5." / "5..." prefix for a move played at `ply` (0 = white's first move). */
export function moveNumber(ply: number, always = false): string {
  const n = Math.floor(ply / 2) + 1;
  if (ply % 2 === 0) return `${n}.`;
  return always ? `${n}...` : '';
}

export function formatLine(sans: string[], startPly = 0): string {
  return sans
    .map((san, i) => {
      const ply = startPly + i;
      const num = ply % 2 === 0 ? `${moveNumber(ply)} ` : i === 0 ? `${moveNumber(ply, true)} ` : '';
      return num + san;
    })
    .join(' ');
}

export { makeSquare };

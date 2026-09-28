// Board and move encoding for Maia-3 (CSSLab). The network always sees the position
// from the side to move's point of view: when Black is to move the board is mirrored
// (ranks flipped, colours swapped) and moves are mirrored back afterwards.
//
// Inputs:  tokens [1, 64, 12]  one-hot pieces per square (a1 = 0 … h8 = 63),
//                              channels P N B R Q K (side to move) then p n b r q k
//          elo_self [1], elo_oppo [1]  plain ratings (600–2600)
// Outputs: logits_move [1, 4352]  from*64+to, then 256 promotions (a7a8q, a7a8r, …)
//          logits_value [1, 3]    loss / draw / win for the side to move
import type { Chess } from 'chessops/chess';
import { makeSan } from 'chessops/san';
import { makeSquare } from 'chessops/util';
import type { NormalMove, Role } from 'chessops/types';

export const MOVE_COUNT = 4352;
const ROLES: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const PROMOS: Role[] = ['queen', 'rook', 'bishop', 'knight'];
const PROMO_CHAR: Record<string, string> = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };

const mirror = (sq: number) => sq ^ 56;

export function encodeBoard(pos: Chess): Float32Array {
  const flip = pos.turn === 'black';
  const t = new Float32Array(64 * 12);
  for (const sq of pos.board.occupied) {
    const piece = pos.board.get(sq)!;
    const own = piece.color === pos.turn;
    const channel = ROLES.indexOf(piece.role) + (own ? 0 : 6);
    t[(flip ? mirror(sq) : sq) * 12 + channel] = 1;
  }
  return t;
}

/** Index in Maia's move vector, for a move given in the (possibly mirrored) frame. */
export function moveIndex(from: number, to: number, promotion?: Role): number {
  if (!promotion) return from * 64 + to;
  return 4096 + ((from & 7) * 8 + (to & 7)) * 4 + PROMOS.indexOf(promotion);
}

export interface LegalMove {
  move: NormalMove; // chessops move (castling = king takes own rook)
  index: number;
}

/** All legal moves with their Maia index. Castling is king-two-squares for Maia. */
export function legalMoves(pos: Chess): LegalMove[] {
  const flip = pos.turn === 'black';
  const out: LegalMove[] = [];
  const ctx = pos.ctx();
  for (const [from, dests] of pos.allDests(ctx)) {
    const piece = pos.board.get(from)!;
    for (const to of dests) {
      const castle = piece.role === 'king' && pos.board.get(to)?.color === pos.turn;
      const target = castle ? (from & ~7) + ((to & 7) > (from & 7) ? 6 : 2) : to;
      const f = flip ? mirror(from) : from;
      const tt = flip ? mirror(target) : target;
      const lastRank = to >> 3 === (pos.turn === 'white' ? 7 : 0);
      if (piece.role === 'pawn' && lastRank) {
        for (const promotion of PROMOS) out.push({ move: { from, to, promotion }, index: moveIndex(f, tt, promotion) });
      } else out.push({ move: { from, to }, index: moveIndex(f, tt) });
    }
  }
  return out;
}

export interface MovePrediction {
  uci: string; // chessops UCI
  san: string;
  move: NormalMove;
  p: number;
}

/** Softmax over the legal moves only; sorted by probability. */
export function decodePolicy(pos: Chess, logits: Float32Array, legal = legalMoves(pos)): MovePrediction[] {
  if (!legal.length) return [];
  const max = Math.max(...legal.map((l) => logits[l.index]));
  const exp = legal.map((l) => Math.exp(logits[l.index] - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return legal
    .map((l, i) => ({
      move: l.move,
      uci: makeSquare(l.move.from) + makeSquare(l.move.to) + (l.move.promotion ? PROMO_CHAR[l.move.promotion] : ''),
      san: makeSan(pos, l.move),
      p: exp[i] / sum,
    }))
    .sort((a, b) => b.p - a.p);
}

/** Win probability for White from the loss/draw/win logits of the side to move. */
export function decodeValue(pos: Chess, wdl: Float32Array): number {
  const m = Math.max(wdl[0], wdl[1], wdl[2]);
  const [l, d, w] = [wdl[0], wdl[1], wdl[2]].map((x) => Math.exp(x - m));
  const win = (w + 0.5 * d) / (l + d + w);
  return pos.turn === 'white' ? win : 1 - win;
}

/** Human-like choice: sample by probability, ignoring very unlikely moves. */
export function sampleMove(preds: MovePrediction[], minP = 0.02, rand = Math.random): MovePrediction | null {
  if (!preds.length) return null;
  const pool = preds.filter((p) => p.p >= minP);
  const list = pool.length ? pool : preds.slice(0, 1);
  const total = list.reduce((a, b) => a + b.p, 0);
  let r = rand() * total;
  for (const p of list) {
    r -= p.p;
    if (r <= 0) return p;
  }
  return list[list.length - 1];
}

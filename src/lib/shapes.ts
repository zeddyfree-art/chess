// Board drawings (arrows and circles). They are stored the way PGN writes them:
// "Gc3b5" is a green arrow from c3 to b5, "Rc7" a red circle on c7. Lichess, Chessable and ChessBase
// all write these as [%cal Gc3b5,Rf4f7] (arrows) and [%csl Rc7] (circles) inside a move comment.
import type { CommentShape } from 'chessops/pgn';
import { makeSquare, parseSquare } from 'chessops/util';

export type ShapeBrush = 'green' | 'red' | 'blue' | 'yellow';

/** The subset of chessground's DrawShape that we store. A circle has no `dest`. */
export interface BoardShape {
  orig: string;
  dest?: string;
  brush: ShapeBrush;
}

const LETTER: Record<ShapeBrush, string> = { green: 'G', red: 'R', blue: 'B', yellow: 'Y' };
const BRUSH: Record<string, ShapeBrush> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow' };
const TOKEN = /^([GRBY])([a-h][1-8])([a-h][1-8])?$/;

/** Upper bound per position; a guard against corrupt or hostile data, far above what anyone draws. */
export const MAX_SHAPES = 40;

export function tokenToShape(token: string): BoardShape | null {
  const m = TOKEN.exec(token);
  if (!m) return null;
  const [, letter, orig, dest] = m;
  return dest && dest !== orig ? { orig, dest, brush: BRUSH[letter] } : { orig, brush: BRUSH[letter] };
}

/** Null for brushes we do not store (the app's own helper arrows use others). */
export function shapeToToken(s: { orig: string; dest?: string; brush?: string }): string | null {
  const letter = LETTER[s.brush as ShapeBrush];
  if (!letter || !/^[a-h][1-8]$/.test(s.orig)) return null;
  if (s.dest && s.dest !== s.orig) return /^[a-h][1-8]$/.test(s.dest) ? `${letter}${s.orig}${s.dest}` : null;
  return `${letter}${s.orig}`;
}

const endpoints = (token: string) => token.slice(1);

/** Stored tokens as shapes for the board; anything unreadable is dropped. */
export function tokensToShapes(tokens: readonly string[] | undefined): BoardShape[] {
  const out: BoardShape[] = [];
  for (const t of tokens ?? []) {
    const s = tokenToShape(t);
    if (s) out.push(s);
  }
  return out;
}

/** Shapes drawn on the board as tokens. Drawing the same endpoints twice keeps the last one. */
export function shapesToTokens(shapes: readonly { orig: string; dest?: string; brush?: string }[]): string[] {
  const byEnds = new Map<string, string>();
  for (const s of shapes) {
    const t = shapeToToken(s);
    if (t) byEnds.set(endpoints(t), t);
  }
  return [...byEnds.values()].slice(0, MAX_SHAPES);
}

/** Adds `extra` to `existing`. What is already there wins when both draw on the same squares. */
export function mergeTokens(existing: readonly string[] | undefined, extra: readonly string[]): string[] {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map(endpoints));
  for (const t of extra) {
    if (out.length >= MAX_SHAPES) break;
    if (!tokenToShape(t) || seen.has(endpoints(t))) continue;
    seen.add(endpoints(t));
    out.push(t);
  }
  return out;
}

/** chessops' comment shapes (from `parseComment`) as tokens. */
export function commentShapesToTokens(shapes: readonly CommentShape[]): string[] {
  const out: string[] = [];
  for (const s of shapes) {
    const orig = makeSquare(s.from);
    const t = shapeToToken({ orig, dest: s.to === s.from ? undefined : makeSquare(s.to), brush: s.color });
    if (t) out.push(t);
  }
  return out;
}

/** Tokens as chessops comment shapes, for `makeComment`. */
export function tokensToCommentShapes(tokens: readonly string[] | undefined): CommentShape[] {
  const out: CommentShape[] = [];
  for (const t of tokens ?? []) {
    const s = tokenToShape(t);
    if (!s) continue;
    const from = parseSquare(s.orig);
    const to = parseSquare(s.dest ?? s.orig);
    if (from !== undefined && to !== undefined) out.push({ color: s.brush, from, to });
  }
  return out;
}

/** Removes PGN command comments that are left after chessops took out the ones it understands,
 *  for example Chessable's `[%mdl 32768]`. */
export function cleanCommentText(text: string): string {
  return text
    .replace(/\[%[A-Za-z]+(?:\s[^\]]*)?\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

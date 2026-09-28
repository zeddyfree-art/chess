// PGN import (with variations, e.g. a Chessbook or Lichess-study export) and export.
import { ChildNode, defaultGame, makePgn, parseComment, parsePgn, startingPosition, type Node, type PgnNodeData } from 'chessops/pgn';
import { makeSan, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { Chess } from 'chessops/chess';
import { keyOfPos, type PlayedMove } from './chess';
import { addLine, movesAt, reachable, ROOT, setMoveComment, type Repertoire } from './repertoire';

export interface ImportResult {
  rep: Repertoire;
  games: number;
  added: number;
  errors: string[];
}

export function importPgn(rep: Repertoire, text: string): ImportResult {
  const games = parsePgn(text);
  const errors: string[] = [];
  let result = rep;
  let added = 0;

  games.forEach((game, gi) => {
    const label = game.headers.get('Event') || game.headers.get('ChapterName') || `game ${gi + 1}`;
    const start = startingPosition(game.headers);
    if (start.isErr) {
      errors.push(`${label}: invalid starting position`);
      return;
    }
    const startPos = start.value as Chess;
    const startKey = keyOfPos(startPos);
    if (startKey !== ROOT && !reachable(result.positions).has(startKey)) {
      errors.push(`${label}: starts from a position that is not in your repertoire (skipped)`);
      return;
    }

    const edges: (PlayedMove & { comment?: string })[] = [];
    const visit = (node: Node<PgnNodeData>, pos: Chess) => {
      for (const child of node.children) {
        const p = pos.clone();
        const move = parseSan(p, child.data.san);
        if (!move) {
          errors.push(`${label}: unreadable move "${child.data.san}" (branch skipped)`);
          continue;
        }
        const from = keyOfPos(p);
        const san = makeSan(p, move);
        const uci = makeUci(move);
        p.play(move);
        const comment = (child.data.comments ?? []).map((c) => parseComment(c).text.trim()).filter(Boolean).join(' ');
        edges.push({ from, san, uci, to: keyOfPos(p), comment: comment || undefined });
        visit(child, p);
      }
    };
    visit(game.moves, startPos);

    const before = countMoves(result);
    result = addLine(result, edges);
    for (const e of edges) {
      const existing = movesAt(result, e.from).find((m) => m.uci === e.uci);
      if (e.comment && existing && !existing.comment) result = setMoveComment(result, e.from, e.uci, e.comment);
    }
    added += countMoves(result) - before;
  });

  if (!games.length) errors.push('No PGN games found.');
  return { rep: result, games: games.length, added, errors };
}

function countMoves(rep: Repertoire) {
  let n = 0;
  for (const v of Object.values(rep.positions)) n += v.length;
  return n;
}

/** One PGN game with all lines as variations. Transpositions are cut off with a comment,
 *  because the continuation is already written out elsewhere in the file. */
export function exportPgn(rep: Repertoire): string {
  const game = defaultGame<PgnNodeData>(
    () =>
      new Map([
        ['Event', rep.name],
        ['Site', 'Repertoire'],
        ['White', rep.side === 'white' ? 'Repertoire' : '?'],
        ['Black', rep.side === 'black' ? 'Repertoire' : '?'],
        ['Result', '*'],
      ]),
  );
  const expanded = new Set<string>([ROOT]);
  const build = (parent: Node<PgnNodeData>, key: string) => {
    for (const m of movesAt(rep, key)) {
      const comments: string[] = [];
      if (m.comment) comments.push(m.comment);
      const transposition = expanded.has(m.to);
      if (!transposition && rep.notes[m.to]) comments.push(rep.notes[m.to]);
      if (transposition) comments.push('transposition');
      const child = new ChildNode<PgnNodeData>({ san: m.san, comments: comments.length ? comments : undefined });
      parent.children.push(child);
      if (!transposition) {
        expanded.add(m.to);
        build(child, m.to);
      }
    }
  };
  build(game.moves, ROOT);
  return makePgn(game);
}

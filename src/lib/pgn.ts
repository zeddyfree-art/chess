// PGN import (with variations, e.g. a Chessbook, Chessable or Lichess-study export) and export.
// Comments keep their arrows and circles ([%cal …] / [%csl …]) in both directions.
import { ChildNode, defaultGame, defaultHeaders, makeComment, makePgn, parseComment, parsePgn, startingPosition, type Game, type Node, type PgnNodeData } from 'chessops/pgn';
import type { Chess } from 'chessops/chess';
import { keyOfPos, playSan, turnOfKey, type PlayedMove } from './chess';
import { mergeNags, cleanNags } from './nags';
import { movesAt, reachable, ROOT, type RepMove, type Repertoire } from './repertoire';
import { cleanCommentText, commentShapesToTokens, mergeTokens, tokensToCommentShapes } from './shapes';

export interface ImportOptions {
  /** What to do with an imported move of your own when the repertoire already has a different move
   *  of yours in that position. `both` keeps both (each counts as correct in training),
   *  `keep-mine` skips the imported move and everything after it. */
  conflicts?: 'both' | 'keep-mine';
}

export interface ImportResult {
  rep: Repertoire;
  /** Games (chapters) in the file. */
  games: number;
  /** New half-moves. */
  added: number;
  /** Distinct half-moves of the file that the repertoire already had. */
  alreadyHad: number;
  /** Distinct half-moves that could be read from the file (new, already there, or skipped as clashes). */
  found: number;
  /** New move comments. */
  comments: number;
  /** New arrows and circles. */
  drawings: number;
  /** New annotation symbols (!, ?!, ±, …). */
  symbols: number;
  /** Moves of your own added next to a different move of yours that the repertoire already had. */
  alternatives: number;
  /** Imported moves (with their branches) skipped because you already play something else there. */
  skippedConflicts: number;
  /** Chapters skipped entirely. */
  skippedGames: number;
  errors: string[];
}

/** Moves that are not real moves: Chessable writes setup lines as "1. d4 -- 2. Nc3 --". */
const PASS = new Set(['--', 'Z0', '0000', '@@@@']);

export const parseGames = (text: string): Game<PgnNodeData>[] => parsePgn(text);

export function importPgn(rep: Repertoire, text: string, opts: ImportOptions = {}): ImportResult {
  return importGames(rep, parseGames(text), opts);
}

export function importGames(rep: Repertoire, games: Game<PgnNodeData>[], opts: ImportOptions = {}): ImportResult {
  const keepMine = opts.conflicts === 'keep-mine';
  const now = Date.now();
  // Everything below works on one private copy (copy-on-write per position) instead of rebuilding the
  // whole repertoire for every chapter: a big book has hundreds of chapters and thousands of moves.
  const positions: Record<string, RepMove[]> = { ...rep.positions };
  const owned = new Set<string>();
  let shapes: Record<string, string[]> | undefined;
  const steps = new Map<string, PlayedMove | null>();
  const seen = new Set<string>();
  const skipped = new Set<string>();

  const warnings = new Map<string, { n: number; examples: string[] }>();
  const warn = (kind: string, example?: string) => {
    const w = warnings.get(kind) ?? { n: 0, examples: [] };
    w.n++;
    if (example && w.examples.length < 3 && !w.examples.includes(example)) w.examples.push(example);
    warnings.set(kind, w);
  };

  let added = 0;
  let alreadyHad = 0;
  let comments = 0;
  let drawings = 0;
  let symbols = 0;
  let alternatives = 0;
  let skippedConflicts = 0;
  let skippedGames = 0;

  const own = (key: string): RepMove[] => {
    if (!owned.has(key)) {
      positions[key] = [...(positions[key] ?? [])];
      owned.add(key);
    }
    return positions[key];
  };

  // Comments before the first move belong to the position the game starts from.
  let notes: Record<string, string> | undefined;
  const addStartComment = (key: string, raw: string) => {
    const parsed = parseComment(tidyShapes(raw));
    const tokens = commentShapesToTokens(parsed.shapes);
    if (tokens.length) {
      shapes ??= { ...rep.shapes };
      const merged = mergeTokens(shapes[key], tokens);
      const gained = merged.length - (shapes[key]?.length ?? 0);
      if (gained > 0) {
        shapes[key] = merged;
        drawings += gained;
      }
    }
    const text = cleanCommentText(parsed.text);
    if (text && !(notes ?? rep.notes)[key]) {
      notes ??= { ...rep.notes };
      notes[key] = text;
      comments++;
    }
  };

  const visit = (node: Node<PgnNodeData>, from: string) => {
    for (const child of node.children) {
      const san = child.data.san;
      if (PASS.has(san)) {
        warn('pass');
        continue;
      }
      const stepKey = `${from}\t${san}`;
      let step = steps.get(stepKey);
      if (step === undefined) {
        step = playSan(from, san);
        steps.set(stepKey, step);
      }
      if (!step) {
        warn('unreadable', san);
        continue;
      }

      const list = positions[from];
      const known = list?.find((m) => m.uci === step.uci);
      const edge = `${from}|${step.uci}`;
      const firstVisit = !seen.has(edge);
      const clash = !known && turnOfKey(from) === rep.side && (rep.positions[from]?.length ?? 0) > 0;
      if (clash && keepMine) {
        if (!skipped.has(edge)) skippedConflicts++;
        skipped.add(edge);
        continue;
      }

      let text = '';
      let tokens: string[] = [];
      for (const c of child.data.comments ?? []) {
        const parsed = parseComment(tidyShapes(c));
        if (parsed.shapes.length) tokens = tokens.concat(commentShapesToTokens(parsed.shapes));
        const t = cleanCommentText(parsed.text);
        // "transposition" is the marker our own export puts where a line continues elsewhere.
        if (t && t !== 'transposition') text = text ? `${text}\n\n${t}` : t;
      }

      const nags = cleanNags(child.data.nags);
      if (!known) {
        if (clash) alternatives++;
        own(from).push({
          san: step.san,
          uci: step.uci,
          to: step.to,
          ...(text ? { comment: text } : {}),
          ...(nags.length ? { nags } : {}),
          addedAt: now,
        });
        added++;
        if (text) comments++;
        symbols += nags.length;
      } else {
        if (firstVisit) alreadyHad++;
        const newNags = nags.length ? mergeNags(known.nags, nags) : undefined;
        const gainedNags = newNags ? newNags.length - (known.nags?.length ?? 0) : 0;
        if ((text && !known.comment) || gainedNags > 0) {
          const moves = own(from);
          const i = moves.findIndex((m) => m.uci === step.uci);
          moves[i] = { ...moves[i], ...(text && !known.comment ? { comment: text } : {}), ...(gainedNags > 0 ? { nags: newNags } : {}) };
          if (text && !known.comment) comments++;
          symbols += Math.max(0, gainedNags);
        }
      }
      seen.add(edge);

      if (tokens.length) {
        shapes ??= { ...rep.shapes };
        const merged = mergeTokens(shapes[step.to], tokens);
        const gained = merged.length - (shapes[step.to]?.length ?? 0);
        if (gained > 0) {
          shapes[step.to] = merged;
          drawings += gained;
        }
      }
      visit(child, step.to);
    }
  };

  for (const game of games) {
    const variant = game.headers.get('Variant');
    if (variant && !/^(standard|chess|from position)$/i.test(variant)) {
      skippedGames++;
      warn('variant', variant);
      continue;
    }
    const start = startingPosition(game.headers);
    if (start.isErr) {
      skippedGames++;
      warn('badstart');
      continue;
    }
    const startKey = keyOfPos(start.value as Chess);
    if (startKey !== ROOT && !reachable(positions).has(startKey)) {
      skippedGames++;
      warn('elsewhere');
      continue;
    }
    for (const c of game.comments ?? []) addStartComment(startKey, c);
    visit(game.moves, startKey);
  }

  const errors: string[] = [];
  const times = (n: number) => (n > 1 ? ` (${n}×)` : '');
  for (const [kind, w] of warnings) {
    if (kind === 'pass')
      errors.push(`${w.n} setup ${w.n === 1 ? 'line uses' : 'lines use'} a pass move ("--", how Chessable writes setups where the opponent does nothing); the moves after it were skipped`);
    else if (kind === 'unreadable') errors.push(`Unreadable or illegal moves were skipped: ${w.examples.join(', ')}${w.n > w.examples.length ? ', …' : ''}${times(w.n)}`);
    else if (kind === 'variant') errors.push(`Skipped ${w.n} ${w.n === 1 ? 'game' : 'games'} of another chess variant (${w.examples.join(', ')})`);
    else if (kind === 'badstart') errors.push(`Skipped ${w.n} ${w.n === 1 ? 'game' : 'games'} with an invalid starting position`);
    else if (kind === 'elsewhere')
      errors.push(`Skipped ${w.n} ${w.n === 1 ? 'game' : 'games'} that start from a position that is not in your repertoire`);
  }
  if (!games.length) errors.push('No PGN games found.');

  const changed = added > 0 || comments > 0 || drawings > 0 || symbols > 0;
  const next: Repertoire = changed ? { ...rep, positions, ...(notes ? { notes } : {}), ...(shapes ? { shapes } : {}), updatedAt: now } : rep;
  return { rep: next, games: games.length, added, alreadyHad, found: seen.size + skipped.size, comments, drawings, symbols, alternatives, skippedConflicts, skippedGames, errors };
}

/** Some programs write "[%cal Ge2e4, Rd7d5]" with spaces; chessops only reads the commas-only form. */
function tidyShapes(comment: string): string {
  if (!comment.includes('[%c')) return comment;
  return comment.replace(/\[%(cal|csl)\s+([^\]]*)\]/g, (_, cmd: string, body: string) => `[%${cmd} ${body.replace(/\s*,\s*/g, ',').trim()}]`);
}

/** PGN comments end at the first closing brace. */
const safe = (text: string) => text.replace(/}/g, ')');

/** One PGN game with all lines as variations. Transpositions are cut off with a comment,
 *  because the continuation is already written out elsewhere in the file. */
export function exportPgn(rep: Repertoire): string {
  // All seven mandatory tags (Event, Site, Date, Round, White, Black, Result), so every program accepts the file.
  const game = defaultGame<PgnNodeData>(() => {
    const headers = defaultHeaders();
    headers.set('Event', rep.name);
    headers.set('Site', 'Repertoire');
    headers.set('White', rep.side === 'white' ? 'Repertoire' : '?');
    headers.set('Black', rep.side === 'black' ? 'Repertoire' : '?');
    return headers;
  });
  const expanded = new Set<string>([ROOT]);
  const build = (parent: Node<PgnNodeData>, key: string) => {
    for (const m of movesAt(rep, key)) {
      const comments: string[] = [];
      const transposition = expanded.has(m.to);
      const shapes = transposition ? [] : tokensToCommentShapes(rep.shapes?.[m.to]);
      if (m.comment || shapes.length) comments.push(safe(makeComment({ text: m.comment ?? '', shapes })));
      if (!transposition && rep.notes[m.to]) comments.push(safe(rep.notes[m.to]));
      if (transposition) comments.push('transposition');
      const child = new ChildNode<PgnNodeData>({
        san: m.san,
        nags: m.nags?.length ? m.nags : undefined,
        comments: comments.length ? comments : undefined,
      });
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

import { describe, expect, it } from 'vitest';
import { playSan, START_KEY } from './chess';
import { exportPgn, importPgn } from './pgn';
import { addLine, deleteMove, movesAt, newRepertoire, setMoveNags, setShapes, stats, type Repertoire } from './repertoire';
import { cleanNags, mergeNags, nagText, toggleNag } from './nags';
import { cleanCommentText, mergeTokens, shapesToTokens, tokensToShapes } from './shapes';

const white = () => newRepertoire('p', 'w', 'white');
const after = (...sans: string[]) => {
  let key = START_KEY;
  for (const s of sans) key = playSan(key, s)!.to;
  return key;
};

describe('arrows and circles in PGN comments', () => {
  it('reads Lichess-style comments (commands and text in one comment)', () => {
    const res = importPgn(white(), '1. e4 { [%csl Ge4,Rd5][%cal Ge2e4,Rd7d5] The centre } e5 *');
    const key = after('e4');
    expect(res.rep.shapes![key]).toEqual(['Ge4', 'Rd5', 'Ge2e4', 'Rd7d5']);
    expect(movesAt(res.rep, START_KEY)[0].comment).toBe('The centre');
    expect(res.drawings).toBe(4);
    expect(res.comments).toBe(1);
  });

  it('reads Chessable-style comments (commands in their own comment, plus an internal [%mdl] code)', () => {
    const pgn = '1. d4 {[%cal Gd2d4]} d5 2. Nc3 {[%cal Gc3b5][%csl Rc7]} { Idea: Nb5! [%mdl 32768] } Nf6 *';
    const res = importPgn(white(), pgn);
    expect(res.rep.shapes![after('d4', 'd5', 'Nc3')]).toEqual(['Gc3b5', 'Rc7']);
    expect(res.rep.shapes![after('d4')]).toEqual(['Gd2d4']);
    const nc3 = movesAt(res.rep, after('d4', 'd5')).find((m) => m.san === 'Nc3')!;
    expect(nc3.comment).toBe('Idea: Nb5!');
  });

  it('keeps line breaks of long comments', () => {
    const res = importPgn(white(), '1. e4 { First paragraph.\n\nSecond paragraph. } *');
    expect(movesAt(res.rep, START_KEY)[0].comment).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('shows the drawing of the position after the move, shared by every move order', () => {
    const a = importPgn(white(), '1. d4 Nf6 2. c4 { [%cal Gc4c5] } *').rep;
    const b = importPgn(a, '1. c4 Nf6 2. d4 { [%csl Rd4] } *').rep;
    // 1.d4 Nf6 2.c4 and 1.c4 Nf6 2.d4 are the same position, so both drawings are there.
    expect(b.shapes![after('d4', 'Nf6', 'c4')]).toEqual(['Gc4c5', 'Rd4']);
  });

  it('exports drawings as [%csl]/[%cal] and reads them back unchanged', () => {
    let rep = addLine(white(), [playSan(START_KEY, 'e4')!, playSan(after('e4'), 'e5')!]);
    rep = setShapes(rep, after('e4'), ['Gg1f3', 'Rd5', 'Ye4']);
    const pgn = exportPgn(rep);
    expect(pgn).toContain('[%csl Rd5,Ye4]');
    expect(pgn).toContain('[%cal Gg1f3]');
    const back = importPgn(white(), pgn);
    expect(new Set(back.rep.shapes![after('e4')])).toEqual(new Set(['Gg1f3', 'Rd5', 'Ye4']));
  });

  it('exports comments that contain a closing brace without breaking the PGN', () => {
    const rep = addLine(white(), [playSan(START_KEY, 'e4')!]);
    const withComment = { ...rep, positions: { [START_KEY]: [{ ...rep.positions[START_KEY][0], comment: 'the set {a, b} of ideas' }] } };
    const back = importPgn(white(), exportPgn(withComment as Repertoire));
    expect(back.errors).toEqual([]);
    expect(movesAt(back.rep, START_KEY)[0].comment).toContain('a, b');
  });

  it('does not turn the "transposition" marker of an export into a comment', () => {
    let rep = addLine(white(), [playSan(START_KEY, 'd4')!, playSan(after('d4'), 'Nf6')!, playSan(after('d4', 'Nf6'), 'c4')!]);
    rep = addLine(rep, [playSan(START_KEY, 'c4')!, playSan(after('c4'), 'Nf6')!, playSan(after('c4', 'Nf6'), 'd4')!]);
    const back = importPgn(white(), exportPgn(rep));
    expect(Object.values(back.rep.positions).flat().some((m) => m.comment)).toBe(false);
  });
});

describe('importing into an existing repertoire', () => {
  const base = () => importPgn(white(), '1. e4 { keep me } e5 2. Nf3 Nc6 *').rep;

  it('adds only what is new and reports what was already there', () => {
    const res = importPgn(base(), '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6) *');
    expect(res.added).toBe(3);
    expect(res.alreadyHad).toBe(4);
    expect(stats(res.rep).lineEnds).toBe(2);
  });

  it('leaves an existing comment alone and only fills empty ones', () => {
    const res = importPgn(base(), '1. e4 { replaced? } e5 { black reply } *');
    expect(movesAt(res.rep, START_KEY)[0].comment).toBe('keep me');
    expect(movesAt(res.rep, after('e4'))[0].comment).toBe('black reply');
    expect(res.comments).toBe(1);
  });

  it('adds drawings to what is already drawn without duplicating', () => {
    const once = importPgn(base(), '1. e4 { [%cal Ge2e4] } e5 *');
    const twice = importPgn(once.rep, '1. e4 { [%cal Ge2e4,Rf1c4] } e5 *');
    expect(twice.rep.shapes![after('e4')]).toEqual(['Ge2e4', 'Rf1c4']);
    expect(twice.drawings).toBe(1);
    expect(importPgn(twice.rep, '1. e4 { [%cal Ge2e4,Rf1c4] } *').rep).toBe(twice.rep);
  });

  it('changes nothing (same object) when everything is already there', () => {
    const rep = base();
    const res = importPgn(rep, '1. e4 e5 *');
    expect(res.rep).toBe(rep);
    expect(res.added).toBe(0);
  });

  it('does not touch the repertoire it was given', () => {
    const rep = base();
    const snapshot = JSON.stringify(rep);
    importPgn(rep, '1. e4 { other } e5 { x [%cal Ge7e5] } 2. Nf3 Nc6 3. Bb5 *');
    expect(JSON.stringify(rep)).toBe(snapshot);
  });

  it('can keep your own move when the file suggests another one', () => {
    const pgn = '1. d4 d5 2. c4 *';
    const both = importPgn(base(), pgn, { conflicts: 'both' });
    expect(movesAt(both.rep, START_KEY).map((m) => m.san)).toEqual(['e4', 'd4']);
    const mine = importPgn(base(), pgn, { conflicts: 'keep-mine' });
    expect(movesAt(mine.rep, START_KEY).map((m) => m.san)).toEqual(['e4']);
    expect(mine.skippedConflicts).toBe(1);
    expect(mine.added).toBe(0);
  });

  it('keep-mine still allows alternatives within the same import and new opponent replies', () => {
    const res = importPgn(base(), '1. e4 c5 2. Nf3 (2. c3) d6 *', { conflicts: 'keep-mine' });
    // After 1.e4 c5 we had nothing yet, so both of the file's alternatives are new.
    expect(movesAt(res.rep, after('e4', 'c5')).map((m) => m.san)).toEqual(['Nf3', 'c3']);
    expect(res.skippedConflicts).toBe(0);
  });

  it('for Black repertoires, the conflict rule applies to Black moves', () => {
    const black = importPgn(newRepertoire('p', 'b', 'black'), '1. e4 e5 *').rep;
    const res = importPgn(black, '1. e4 c5 (1... e6) *', { conflicts: 'keep-mine' });
    expect(movesAt(res.rep, after('e4')).map((m) => m.san)).toEqual(['e5']);
    expect(res.skippedConflicts).toBe(2);
  });
});

describe('problems in a file', () => {
  it('groups pass moves and illegal moves into one warning each and keeps the rest', () => {
    const pgn = ['[Event "a"]', '', '1. d4 -- 2. Nc3 -- *', '', '[Event "b"]', '', '1. d4 -- 2. Bf4 -- *', '', '[Event "c"]', '', '1. e4 e5 2. Ke3 *'].join('\n');
    const res = importPgn(white(), pgn);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0]).toMatch(/^2 setup lines use a pass move/);
    expect(res.errors[1]).toContain('Ke3');
    expect(movesAt(res.rep, START_KEY).map((m) => m.san)).toEqual(['d4', 'e4']);
  });

  it('skips chapters that start from a position that is not in the repertoire', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n2. Nf3 Nc6 *`;
    const res = importPgn(white(), pgn);
    expect(res.skippedGames).toBe(1);
    expect(res.added).toBe(0);
    expect(res.errors[0]).toMatch(/not in your repertoire/);
    // ...but is read when the repertoire reaches that position.
    const known = importPgn(white(), '1. e4 e5 *').rep;
    expect(importPgn(known, pgn).added).toBe(2);
  });

  it('reports an empty file, and text that is not a PGN', () => {
    expect(importPgn(white(), '   ').errors).toEqual(['No PGN games found.']);
    const junk = importPgn(white(), 'this is not a pgn at all');
    expect(junk.found).toBe(0);
    expect(junk.added).toBe(0);
  });

  it('counts the moves it could read, whether new or already there', () => {
    const base = importPgn(white(), '1. e4 e5 *').rep;
    expect(importPgn(base, '1. e4 e5 2. Nf3 *').found).toBe(3);
    expect(importPgn(base, '1. e4 e5 *').found).toBe(2);
  });
});

describe('shape helpers', () => {
  it('converts between tokens and board shapes, dropping what it cannot read', () => {
    expect(tokensToShapes(['Gc3b5', 'Rc7', 'Xa1', 'Gz9', ''])).toEqual([
      { orig: 'c3', dest: 'b5', brush: 'green' },
      { orig: 'c7', brush: 'red' },
    ]);
    expect(
      shapesToTokens([
        { orig: 'e2', dest: 'e4', brush: 'green' },
        { orig: 'e2', dest: 'e4', brush: 'red' }, // same squares: the last colour wins
        { orig: 'd4', brush: 'blue' },
        { orig: 'a1', dest: 'a2', brush: 'paleBlue' }, // the app's own helper arrows are not stored
      ]),
    ).toEqual(['Re2e4', 'Bd4']);
  });

  it('merges without duplicates; what is there stays', () => {
    expect(mergeTokens(['Ge2e4'], ['Re2e4', 'Rd5', 'Rd5', 'bogus'])).toEqual(['Ge2e4', 'Rd5']);
  });

  it('removes leftover [%…] commands but not normal brackets', () => {
    expect(cleanCommentText('Good [%mdl 32768] move [see 12]')).toBe('Good  move [see 12]');
  });

  it('setShapes stores, clears and reports no change', () => {
    const rep = setShapes(white(), 'k', ['Ge2e4']);
    expect(rep.shapes).toEqual({ k: ['Ge2e4'] });
    expect(setShapes(rep, 'k', ['Ge2e4'])).toBe(rep);
    expect(setShapes(rep, 'k', []).shapes).toEqual({});
  });

  it('drawings of deleted branches disappear with them', () => {
    let rep = addLine(white(), [playSan(START_KEY, 'e4')!, playSan(after('e4'), 'e5')!]);
    rep = setShapes(setShapes(rep, after('e4'), ['Ge2e4']), after('e4', 'e5'), ['Rd5']);
    const pruned = deleteMove(rep, after('e4'), 'e7e5');
    expect(Object.keys(pruned.shapes!)).toEqual([after('e4')]);
    expect(Object.keys(deleteMove(rep, START_KEY, 'e2e4').shapes!)).toEqual([]);
  });
});

describe('annotation symbols (NAGs)', () => {
  it('reads $-codes and !/? suffixes and keeps them per move', () => {
    const res = importPgn(white(), '1. e4! e5 $14 2. Nf3 $146 $36 Nc6?! *');
    expect(movesAt(res.rep, START_KEY)[0].nags).toEqual([1]);
    expect(movesAt(res.rep, after('e4'))[0].nags).toEqual([14]);
    expect(movesAt(res.rep, after('e4', 'e5'))[0].nags).toEqual([36, 146]);
    expect(movesAt(res.rep, after('e4', 'e5', 'Nf3'))[0].nags).toEqual([6]);
    expect(res.symbols).toBe(5);
  });

  it('writes them back and reads them again', () => {
    const rep = importPgn(white(), '1. e4 !! e5 $16 *').rep;
    const pgn = exportPgn(rep);
    expect(pgn).toMatch(/e4 \$3/);
    const back = importPgn(white(), pgn).rep;
    expect(movesAt(back, START_KEY)[0].nags).toEqual([3]);
    expect(movesAt(back, after('e4'))[0].nags).toEqual([16]);
  });

  it('fills in missing symbols but never overrules an existing rating', () => {
    const base = importPgn(white(), '1. e4! e5 *').rep;
    const res = importPgn(base, '1. e4?! $146 e5 $14 *');
    expect(movesAt(res.rep, START_KEY)[0].nags).toEqual([1, 146]); // kept "!", added the novelty
    expect(movesAt(res.rep, after('e4'))[0].nags).toEqual([14]);
    expect(res.symbols).toBe(2);
    expect(importPgn(res.rep, '1. e4! $146 e5 $14 *').rep).toBe(res.rep);
  });

  it('keeps symbols it does not know', () => {
    const rep = importPgn(white(), '1. e4 $250 *').rep;
    expect(movesAt(rep, START_KEY)[0].nags).toEqual([250]);
    expect(nagText([250]).rest).toBe('$250');
  });

  it('shows move symbols behind the move and the others after it', () => {
    expect(nagText([5, 16, 146])).toEqual({ move: '!?', rest: '± N' });
    expect(nagText(undefined)).toEqual({ move: '', rest: '' });
  });

  it('toggles: one rating per kind, again removes it, other symbols stay', () => {
    expect(toggleNag([1, 146], 4)).toEqual([4, 146]);
    expect(toggleNag([4, 146], 4)).toEqual([146]);
    expect(toggleNag([16], 14)).toEqual([14]);
    expect(toggleNag([16], 1)).toEqual([1, 16]);
  });

  it('cleans and merges lists', () => {
    expect(cleanNags([14, 1, 14, 0, 300, 2.5, 'x'])).toEqual([1, 14]);
    expect(cleanNags(undefined)).toEqual([]);
    expect(mergeNags([1], [2, 16, 16])).toEqual([1, 16]);
  });

  it('setMoveNags stores and clears', () => {
    const rep = importPgn(white(), '1. e4 *').rep;
    const marked = setMoveNags(rep, START_KEY, 'e2e4', [1, 16]);
    expect(movesAt(marked, START_KEY)[0].nags).toEqual([1, 16]);
    expect('nags' in movesAt(setMoveNags(marked, START_KEY, 'e2e4', []), START_KEY)[0]).toBe(false);
  });
});

describe('what other programs write', () => {
  it('reads arrows written with spaces after the commas', () => {
    const res = importPgn(white(), '1. e4 { [%cal Ge2e4, Rd7d5 ,Bg1f3] [%csl Ge4, Rd5] } e5 *');
    expect(res.rep.shapes![after('e4')]).toEqual(['Ge2e4', 'Rd7d5', 'Bg1f3', 'Ge4', 'Rd5']);
  });

  it('accepts Lichess "From Position" games', () => {
    const known = importPgn(white(), '1. e4 *').rep;
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const res = importPgn(known, `[Variant "From Position"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n1... e5 2. Nf3 *`);
    expect(res.skippedGames).toBe(0);
    expect(res.added).toBe(2);
    expect(importPgn(known, '[Variant "Atomic"]\n\n1. e4 *').skippedGames).toBe(1);
  });

  it('reads the comment before the first move as the note and drawings of the start position', () => {
    const known = importPgn(white(), '1. e4 e5 *').rep;
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const res = importPgn(known, `[SetUp "1"]\n[FEN "${fen}"]\n\n{ The open game [%csl Ge4] [%cal Gg1f3] } 2. Nf3 *`);
    const key = after('e4', 'e5');
    expect(res.rep.notes[key]).toBe('The open game');
    expect(res.rep.shapes![key]).toEqual(['Ge4', 'Gg1f3']);
    // an existing note stays
    const again = importPgn(res.rep, `[SetUp "1"]\n[FEN "${fen}"]\n\n{ Another text } 2. Nf3 *`);
    expect(again.rep.notes[key]).toBe('The open game');
  });

  it('ignores clocks and engine evaluations but keeps the words', () => {
    const res = importPgn(white(), '1. e4 { [%clk 0:04:32] [%eval 0.3] Solid [%emt 0:00:03] } e5 *');
    expect(movesAt(res.rep, START_KEY)[0].comment).toBe('Solid');
  });

  it('understands castling written with zeros, ; comments and % lines', () => {
    const res = importPgn(white(), '%escaped\n1. e4 e5 2. Nf3 Nc6 ; rest of the line\n3. Bc4 Nf6 4. 0-0 *');
    expect(res.errors).toEqual([]);
    expect(res.added).toBe(7);
  });

  it('writes all seven mandatory tags on export', () => {
    const tags = exportPgn(white()).split('\n').filter((l) => l.startsWith('[')).map((l) => l.slice(1, l.indexOf(' ')));
    expect(tags).toEqual(['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result']);
  });
});

import { describe, expect, it } from 'vitest';
import { lineFromSans } from './chess';
import { mergeData } from './merge';
import { addLine, inTrainDepth, maxMyMoveNumber, newRepertoire, setTrainDepth, type Repertoire } from './repertoire';
import { buildQueue, counts, gradeCard, Rating, syncCards } from './srs';
import type { AppData } from './store';

const withLines = (rep: Repertoire, lines: string[][]) => syncCards(lines.reduce((r, l) => addLine(r, lineFromSans(l)!), rep));
const sans = (rep: Repertoire, q: { from: string; uci: string }[]) =>
  q.map((i) => Object.values(rep.positions).flat().find((m) => m.uci === i.uci && rep.positions[i.from]?.includes(m))!.san);

describe('training depth', () => {
  // White: 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4, and 1.e4 c5 2.Nf3 d6 3.d4.
  const rep = withLines(newRepertoire('p', 'e4', 'white'), [
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'],
    ['e4', 'c5', 'Nf3', 'd6', 'd4'],
  ]);

  it('knows how deep the lines go', () => {
    expect(maxMyMoveNumber(rep)).toBe(4);
  });

  it('limits new moves, reviews and the counts to the moves up to the depth', () => {
    const two = setTrainDepth(rep, 2);
    expect(sans(two, buildQueue(two, { newLimit: 50 }))).toEqual(['e4', 'Nf3', 'Nf3']);
    expect(counts(two)).toMatchObject({ fresh: 3, deeper: 3, total: 3 });
    expect(counts(rep)).toMatchObject({ fresh: 6, deeper: 0 });
  });

  it('keeps the schedule of deeper cards, and brings them back when you go deeper', () => {
    const later = Date.now() + 400 * 86400e3;
    const id = Object.keys(rep.cards).find((k) => k.endsWith(lineFromSans(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])!.at(-1)!.uci))!;
    const learned = { ...rep, cards: { ...rep.cards, [id]: gradeCard(rep.cards[id], Rating.Good) } };
    const two = setTrainDepth(learned, 2);
    expect(buildQueue(two, { newLimit: 0, now: later })).toHaveLength(0); // Bb5 is due, but deeper
    expect(two.cards[id]).toBe(learned.cards[id]);
    const three = setTrainDepth(two, 3);
    expect(buildQueue(three, { newLimit: 0, now: later }).map((i) => i.id)).toEqual([id]);
  });

  it('measures a position by its shortest move order', () => {
    // 1.d4 Nf6 2.c4 e6 3.Nc3 and the transposition 1.c4 e6 2.d4 Nf6: the Nc3 position is reached at move 3 either way,
    // but 1.Nf3 d5 2.d4 Nf6 3.c4 e6 4.Nc3 reaches the same position only at move 4.
    const r = withLines(newRepertoire('p', 'qg', 'white'), [
      ['d4', 'Nf6', 'c4', 'e6', 'Nc3'],
      ['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'e6', 'Nc3'],
    ]);
    const nc3From = lineFromSans(['d4', 'Nf6', 'c4', 'e6'])!.at(-1)!.to;
    expect(inTrainDepth(setTrainDepth(r, 3))(nc3From)).toBe(true);
    expect(inTrainDepth(setTrainDepth(r, 2))(nc3From)).toBe(false);
  });

  it('for Black, move 1 is the reply to White’s first move', () => {
    const b = withLines(newRepertoire('p', 'scandi', 'black'), [['e4', 'd5', 'exd5', 'Qxd5']]);
    expect(sans(b, buildQueue(setTrainDepth(b, 1), { newLimit: 9 }))).toEqual(['d5']);
    expect(sans(b, buildQueue(setTrainDepth(b, 2), { newLimit: 9 }))).toEqual(['d5', 'Qxd5']);
  });

  it('syncs: a depth set on one device reaches the other, and so does going back to all moves', () => {
    const profile = { id: 'p', name: 'F', ratings: [], speeds: [], updatedAt: 1 } as unknown as AppData['profiles'][number];
    const data = (r: Repertoire): AppData => ({ version: 1, profiles: [profile], repertoires: [r], activeProfileId: 'p', activeRepId: r.id, lastBackupAt: null });
    const base = { ...rep, updatedAt: 1 };
    const phone = { ...setTrainDepth(base, 5), updatedAt: 2 };
    const merged = mergeData(data(base), data(phone), { repertoires: [base] } as never);
    expect(merged.repertoires[0].trainDepth).toBe(5);
    const back = { ...setTrainDepth(phone, undefined), updatedAt: 3 };
    expect(mergeData(data(back), data(phone), { repertoires: [phone] } as never).repertoires[0].trainDepth).toBeUndefined();
  });
});

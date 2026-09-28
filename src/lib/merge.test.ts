import { describe, expect, it } from 'vitest';
import { playSan, START_KEY, type PlayedMove } from './chess';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { encodeBoard, legalMoves, moveIndex, sampleMove } from './maiaEncoding';
import { mergeData } from './merge';
import { addLine, newRepertoire, type Repertoire } from './repertoire';
import { gradeCard, Rating, syncCards } from './srs';
import { EMPTY_DATA, type AppData, type Profile } from './store';

function line(sans: string[]): PlayedMove[] {
  const out: PlayedMove[] = [];
  let key = START_KEY;
  for (const san of sans) {
    const m = playSan(key, san)!;
    out.push(m);
    key = m.to;
  }
  return out;
}

const profile = (id: string, updatedAt = 1): Profile => ({ id, name: id, color: '#000', ratings: [], speeds: [], updatedAt });

function rep(id: string, profileId: string, sans: string[], updatedAt: number): Repertoire {
  const r = syncCards(addLine({ ...newRepertoire(profileId, id, 'white'), id }, line(sans)));
  return { ...r, updatedAt };
}

const data = (patch: Partial<AppData>): AppData => ({ ...EMPTY_DATA, ...patch });

describe('mergeData', () => {
  it('keeps items that exist on only one side', () => {
    const a = data({ profiles: [profile('p')], repertoires: [rep('r1', 'p', ['e4'], 10)] });
    const b = data({ profiles: [profile('p')], repertoires: [rep('r2', 'p', ['d4'], 20)] });
    const m = mergeData(a, b);
    expect(m.repertoires.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('takes the newer edit of the same repertoire but keeps newer training from the other side', () => {
    const older = rep('r', 'p', ['e4', 'e5', 'Nf3'], 10);
    const id = Object.keys(older.cards)[0];
    const trained = { ...older, cards: { ...older.cards, [id]: gradeCard(older.cards[id], Rating.Good, 5000) }, updatedAt: 15 };
    const edited = { ...rep('r', 'p', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 30) };
    const m = mergeData(data({ profiles: [profile('p')], repertoires: [trained] }), data({ profiles: [profile('p')], repertoires: [edited] }));
    const r = m.repertoires[0];
    expect(Object.keys(r.positions).length).toBe(Object.keys(edited.positions).length);
    expect(r.cards[id].last_review).toBe(5000);
  });

  it('respects deletions made after the last edit, but not before', () => {
    const r = rep('r', 'p', ['e4'], 10);
    const deletedLater = data({ profiles: [profile('p')], repertoires: [], deleted: { r: 20 } });
    expect(mergeData(data({ profiles: [profile('p')], repertoires: [r] }), deletedLater).repertoires).toEqual([]);
    const editedAfterDelete = { ...r, updatedAt: 30 };
    expect(mergeData(data({ profiles: [profile('p')], repertoires: [editedAfterDelete] }), deletedLater).repertoires).toHaveLength(1);
  });

  it('drops repertoires whose profile was deleted and keeps the local selection', () => {
    const a = data({ profiles: [profile('p'), profile('q')], repertoires: [rep('r', 'q', ['e4'], 5)], activeProfileId: 'p' });
    const b = data({ profiles: [profile('p')], deleted: { q: 50 }, activeProfileId: 'x' });
    const m = mergeData(a, b);
    expect(m.profiles.map((p) => p.id)).toEqual(['p']);
    expect(m.repertoires).toEqual([]);
    expect(m.activeProfileId).toBe('p');
  });
});

describe('maia encoding', () => {
  const pos = (fen: string) => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

  it('mirrors the board when black is to move', () => {
    const t = encodeBoard(pos('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));
    // Black's own king (e8) appears on e1 in channel 5 (own king).
    expect(t[4 * 12 + 5]).toBe(1);
    // White's advanced pawn (e4) appears on e5 as an opponent pawn (channel 6).
    expect(t[36 * 12 + 6]).toBe(1);
  });

  it('indexes castling as a two-square king move and promotions after 4096', () => {
    const p = pos('r3k2r/8/8/8/8/8/1p6/R3K2R b KQkq - 0 1');
    const idx = new Set(legalMoves(p).map((l) => l.index));
    // Black O-O, mirrored: e1g1.
    expect(idx.has(moveIndex(4, 6))).toBe(true);
    // b2-b1=Q, mirrored: b7-b8 queen.
    expect(idx.has(moveIndex(49, 57, 'queen'))).toBe(true);
    expect(moveIndex(48, 56, 'queen')).toBe(4096);
  });

  it('samples only reasonably likely moves', () => {
    const preds = [
      { uci: 'a', san: 'a', move: { from: 0, to: 1 }, p: 0.7 },
      { uci: 'b', san: 'b', move: { from: 0, to: 2 }, p: 0.29 },
      { uci: 'c', san: 'c', move: { from: 0, to: 3 }, p: 0.01 },
    ];
    for (const r of [0, 0.5, 0.99, 0.9999]) expect(sampleMove(preds, 0.02, () => r)!.uci).not.toBe('c');
  });
});

import { describe, expect, it } from 'vitest';
import { playSan, START_KEY, type PlayedMove } from './chess';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { encodeBoard, legalMoves, moveIndex, sampleMove } from './maiaEncoding';
import { mergeData, sameSyncedContent } from './merge';
import { addLine, deleteMove, movesAt, newRepertoire, setMoveComment, setNote, setShapes, type Repertoire } from './repertoire';
import { classify } from './sync';
import { gradeCard, Rating, syncCards } from './srs';
import { EMPTY_DATA, useApp, type AppData, type Profile } from './store';

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

const after = (...sans: string[]) => line(sans).at(-1)!.to;

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

  it('keeps a restored repertoire even when another device already holds its deletion mark', () => {
    const r = rep('r', 'p', ['e4'], 10);
    const restored = { ...r, updatedAt: 200 }; // restoring bumps the timestamp past the deletion
    const local = data({ profiles: [profile('p')], repertoires: [restored] });
    const remote = data({ profiles: [profile('p')], repertoires: [], deleted: { r: 150 } });
    expect(mergeData(local, remote).repertoires.map((x) => x.id)).toEqual(['r']);
    // ...and the other way round: the device that only knows the deletion learns about the restored copy.
    expect(mergeData(remote, local).repertoires.map((x) => x.id)).toEqual(['r']);
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

describe('classify (what counts as an edit for syncing)', () => {
  const base = data({ profiles: [profile('p')], repertoires: [rep('r', 'p', ['e4', 'e5'], 10)] });
  const withRep = (r: Repertoire) => ({ ...base, repertoires: [r] });

  it('treats drawing an arrow like any other edit, so it syncs right away', () => {
    const r = base.repertoires[0];
    expect(classify(base, withRep(setShapes(r, START_KEY, ['Ge2e4'])))).toBe('edit');
  });

  it('keeps counting comments as edits and grades as training', () => {
    const r = base.repertoires[0];
    const id = Object.keys(r.cards)[0];
    expect(classify(base, withRep({ ...r, cards: { ...r.cards, [id]: gradeCard(r.cards[id], Rating.Good, 5000) } }))).toBe('training');
    expect(classify(base, withRep({ ...r, notes: { x: 'note' } }))).toBe('edit');
  });
});

describe('three-way merge (what each device changed since its last sync)', () => {
  const p = profile('p');
  const wrap = (r: Repertoire) => data({ profiles: [p], repertoires: [r] });
  const base = (r: Repertoire) => ({ profiles: [p], repertoires: [r], deleted: {} });
  const add = (r: Repertoire, sans: string[], at: number) => ({ ...syncCards(addLine(r, line(sans))), updatedAt: at });
  const synced = () => ({ ...rep('r', 'p', ['e4', 'e5', 'Nf3'], 100) });
  const train = (r: Repertoire, at: number) => {
    const id = Object.keys(r.cards)[0];
    return { ...r, cards: { ...r.cards, [id]: gradeCard(r.cards[id], Rating.Good, at) } };
  };
  const sans = (r: Repertoire) => new Set(Object.values(r.positions).flat().map((m) => m.san));

  it('an old copy that was only trained does not overwrite lines added elsewhere (with base)', () => {
    const b = synced();
    const desktop = setShapes(add(b, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 200), START_KEY, ['Ge2e4']);
    const phone = { ...train(b, 300), updatedAt: 300 }; // old data, even with a training-bumped timestamp
    const m = mergeData(wrap(phone), wrap(desktop), base(b)).repertoires[0];
    expect(sans(m)).toEqual(new Set(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']));
    expect(m.shapes).toEqual({ [START_KEY]: ['Ge2e4'] });
    const id = Object.keys(b.cards)[0];
    expect(m.cards[id].last_review).toBe(300); // the phone's review is kept
  });

  it('...and without a base (first sync after this update) nothing is lost either', () => {
    const b = synced();
    const desktop = add(b, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 200);
    const phone = { ...train(b, 300), updatedAt: 300 };
    for (const [a, c] of [[phone, desktop], [desktop, phone]]) {
      expect(sans(mergeData(wrap(a), wrap(c), null).repertoires[0])).toEqual(new Set(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']));
    }
  });

  it('a branch pruned on one device disappears on the other', () => {
    const b = add(synced(), ['e4', 'c5', 'Nf3'], 100);
    const desktop = { ...deleteMove(b, after('e4'), 'c7c5'), updatedAt: 200 };
    const phone = train(b, 300);
    const m = mergeData(wrap(phone), wrap(desktop), base(b)).repertoires[0];
    expect(sans(m).has('c5')).toBe(false);
    expect(Object.keys(m.cards).every((id) => !id.startsWith(after('e4', 'c5')))).toBe(true);
  });

  it('edits on both devices are combined: one adds, the other prunes elsewhere', () => {
    const b = add(synced(), ['e4', 'c5', 'Nf3'], 100);
    const desktop = { ...deleteMove(b, after('e4'), 'c7c5'), updatedAt: 200 };
    const phone = add(b, ['d4', 'd5', 'c4'], 150);
    for (const [a, c] of [[phone, desktop], [desktop, phone]]) {
      const m = mergeData(wrap(a), wrap(c), base(b)).repertoires[0];
      expect(sans(m)).toEqual(new Set(['e4', 'e5', 'Nf3', 'd4', 'd5', 'c4']));
    }
  });

  it('a comment changed on one side is taken; changed on both, the latest edit wins', () => {
    const b = synced();
    const withComment = (r: Repertoire, text: string, at: number) => ({ ...setMoveComment(r, START_KEY, 'e2e4', text), updatedAt: at });
    const other = add(b, ['d4'], 150); // edited too, but not this comment
    expect(movesAt(mergeData(wrap(other), wrap(withComment(b, 'desk', 120)), base(b)).repertoires[0], START_KEY)[0].comment).toBe('desk');
    const m = mergeData(wrap(withComment(b, 'phone', 300)), wrap(withComment(b, 'desk', 200)), base(b)).repertoires[0];
    expect(movesAt(m, START_KEY)[0].comment).toBe('phone');
  });

  it('removing a note or drawing on one side removes it everywhere', () => {
    const b = setShapes(setNote(synced(), after('e4'), 'note'), after('e4'), ['Rd5']);
    const desktop = { ...setShapes(setNote(b, after('e4'), ''), after('e4'), []), updatedAt: 200 };
    const phone = add(b, ['d4'], 150);
    const m = mergeData(wrap(phone), wrap(desktop), base(b)).repertoires[0];
    expect(m.notes).toEqual({});
    expect(m.shapes).toEqual({});
    expect(sans(m).has('d4')).toBe(true);
  });

  it('training progress still merges per card', () => {
    const b = synced();
    const [id1, id2] = Object.keys(add(b, ['d4', 'd5', 'c4'], 100).cards);
    const both = add(b, ['d4', 'd5', 'c4'], 100);
    const x = { ...both, cards: { ...both.cards, [id1]: gradeCard(both.cards[id1], Rating.Good, 500) } };
    const y = { ...both, cards: { ...both.cards, [id2]: gradeCard(both.cards[id2], Rating.Again, 600) } };
    const m = mergeData(wrap(x), wrap(y), base(both)).repertoires[0];
    expect(m.cards[id1].last_review).toBe(500);
    expect(m.cards[id2].last_review).toBe(600);
  });
});

describe('training does not count as an edit', () => {
  it('keeps the repertoire edit time when only cards change, and bumps it for real edits', () => {
    const r = rep('r', 'p', ['e4', 'e5', 'Nf3'], 100);
    useApp.setState({ data: data({ profiles: [profile('p')], repertoires: [r] }) });
    const id = Object.keys(r.cards)[0];
    useApp.getState().updateRep('r', (x) => ({ ...x, cards: { ...x.cards, [id]: gradeCard(x.cards[id], Rating.Good) } }), 'training', { undoable: false });
    const trained = useApp.getState().data.repertoires[0];
    expect(trained.cards[id].reps).toBe(1);
    expect(trained.updatedAt).toBe(100);
    useApp.getState().updateRep('r', (x) => setNote(x, START_KEY, 'n'), 'note');
    expect(useApp.getState().data.repertoires[0].updatedAt).toBeGreaterThan(100);
  });
});

describe('sameSyncedContent', () => {
  it('sees equal content in different objects and order, and any real difference', () => {
    const r1 = rep('a', 'p', ['e4'], 1);
    const r2 = rep('b', 'p', ['d4'], 1);
    const x = data({ profiles: [profile('p')], repertoires: [r1, r2] });
    expect(sameSyncedContent(x, data({ profiles: [profile('p')], repertoires: [structuredClone(r2), structuredClone(r1)] }))).toBe(true);
    expect(sameSyncedContent(x, data({ profiles: [profile('p')], repertoires: [r1, setNote(r2, START_KEY, 'n')] }))).toBe(false);
    expect(sameSyncedContent(x, data({ profiles: [profile('p')], repertoires: [r1] }))).toBe(false);
    expect(sameSyncedContent(x, { ...x, deleted: { z: 1 } })).toBe(false);
    expect(sameSyncedContent(x, { ...x, activeRepId: 'b' })).toBe(true);
  });
});

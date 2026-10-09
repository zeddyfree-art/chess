import { beforeEach, describe, expect, it } from 'vitest';
import { lineFromSans } from './chess';
import { mergeData, type SyncBase } from './merge';
import { addLine, newRepertoire, setPaused, type Repertoire } from './repertoire';
import { buildQueue, counts, gradeCard, Rating, resetCards, State, syncCards } from './srs';
import { EMPTY_DATA, useApp, type AppData } from './store';

const rep0 = () => syncCards(addLine(newRepertoire('p', 'e4', 'white'), lineFromSans(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])!));
const learnAll = (r: Repertoire, at: number) => ({
  ...r,
  cards: Object.fromEntries(Object.entries(r.cards).map(([id, c]) => [id, gradeCard(c, Rating.Good, at)])),
});
const profile = { id: 'p', name: 'F', ratings: [], speeds: [], updatedAt: 1 } as unknown as AppData['profiles'][number];
const data = (r: Repertoire): AppData => ({ ...EMPTY_DATA, profiles: [profile], repertoires: [r], activeProfileId: 'p', activeRepId: r.id });

describe('pausing training', () => {
  it('a paused repertoire asks for nothing, and its schedule is kept', () => {
    const r = learnAll(rep0(), 1000);
    const later = Date.now() + 365 * 86400e3;
    expect(counts(r, later).due).toBe(3);
    const paused = setPaused(r, true);
    expect(counts(paused, later)).toMatchObject({ due: 0, fresh: 0, learned: 3, paused: true });
    expect(paused.cards).toBe(r.cards);
    expect(counts(setPaused(paused, false), later).due).toBe(3);
    expect(buildQueue(r, { newLimit: 0, now: later })).toHaveLength(3);
  });

  it('pausing syncs like the other repertoire settings', () => {
    const base = { ...rep0(), updatedAt: 1 };
    const phone = { ...setPaused(base, true), updatedAt: 2 };
    const b: SyncBase = { profiles: [profile], repertoires: [base], deleted: {} };
    expect(mergeData(data(base), data(phone), b).repertoires[0].paused).toBe(true);
    const resumed = { ...setPaused(phone, false), updatedAt: 3 };
    expect(mergeData(data(resumed), data(phone), { ...b, repertoires: [phone] }).repertoires[0].paused).toBeUndefined();
  });
});

describe('resetting training', () => {
  it('makes the cards new again, all of them or only some', () => {
    const r = learnAll(rep0(), 1000);
    const all = resetCards(r, undefined, 5000);
    expect(Object.values(all.cards).every((c) => c.state === State.New && c.changedAt === 5000)).toBe(true);
    const one = Object.keys(r.cards)[0];
    const some = resetCards(r, new Set([one]), 5000);
    expect(some.cards[one].state).toBe(State.New);
    expect(Object.values(some.cards).filter((c) => c.state === State.New)).toHaveLength(1);
  });

  it('wins over older reviews on another device, but not over newer ones', () => {
    const trained = learnAll(rep0(), 1000);
    const reset = resetCards(trained, undefined, 5000); // here
    const [a, b] = Object.keys(trained.cards);
    // The other device reviewed card a before the reset, and card b after it.
    const other = { ...trained, cards: { ...trained.cards, [b]: gradeCard(trained.cards[b], Rating.Good, 9000) } };
    const merged = mergeData(data(reset), data(other)).repertoires[0];
    expect(merged.cards[a].state).toBe(State.New);
    expect(merged.cards[b].last_review).toBe(9000);
  });
});

describe('undoing a reset', () => {
  beforeEach(() => useApp.setState({ data: data(learnAll(rep0(), 1000)), undo: [], redo: [] }));

  it('brings the progress back, and that wins when syncing with a device that already got the reset', () => {
    const { updateRep, undoLast } = useApp.getState();
    const before = useApp.getState().data.repertoires[0];
    updateRep(before.id, (r) => resetCards(r), 'reset');
    const afterReset = useApp.getState().data.repertoires[0];
    expect(counts(afterReset).learned).toBe(0);
    undoLast();
    const undone = useApp.getState().data.repertoires[0];
    expect(counts(undone).learned).toBe(3);
    for (const [id, c] of Object.entries(undone.cards)) expect(c.last_review).toBe(before.cards[id].last_review);
    // The other device has the reset already; the undo is newer.
    const merged = mergeData(data(undone), data(afterReset)).repertoires[0];
    expect(counts(merged).learned).toBe(3);
  });

  it('an undo of an edit keeps the training done since', () => {
    const { updateRep, undoLast } = useApp.getState();
    const r = useApp.getState().data.repertoires[0];
    updateRep(r.id, (x) => ({ ...x, name: 'renamed' }), 'rename');
    const id = Object.keys(r.cards)[0];
    updateRep(r.id, (x) => ({ ...x, cards: { ...x.cards, [id]: gradeCard(x.cards[id], Rating.Good, 99_000) } }), 'training', { undoable: false });
    undoLast();
    const now = useApp.getState().data.repertoires[0];
    expect(now.name).toBe('e4');
    expect(now.cards[id].last_review).toBe(99_000);
  });
});

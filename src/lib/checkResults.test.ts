import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { engineChanged, engineStatus, gapFilters, gapsChanged, gapStatus, lineEndStatus, mergeChecks, savedEngine, savedGaps } from './checkResults';
import { mergeData } from './merge';
import type { AppData } from './store';
import { addLine, deleteMove, newRepertoire } from './repertoire';

const key = (sans: string[]) => (sans.length ? lineFromSans(sans)!.at(-1)!.to : START_KEY);
const withLine = (rep: ReturnType<typeof newRepertoire>, sans: string[]) => addLine(rep, lineFromSans(sans)!);

describe('what has been done since a check', () => {
  const base = withLine(newRepertoire('p', 'e4', 'white'), ['e4', 'e5', 'Nf3', 'Nc6', 'Ba6']);

  it('a missing reply is half done with the reply, done with your answer too', () => {
    const gap = { key: key(['e4']), san: 'c5' };
    expect(gapStatus(base, gap).state).toBe('open');
    expect(gapStatus(withLine(base, ['e4', 'c5']), gap).state).toBe('partial');
    expect(gapStatus(withLine(base, ['e4', 'c5', 'Nf3']), gap).state).toBe('done');
  });

  it('a line that ended early is done once it goes on', () => {
    const end = { key: key(['e4', 'e5', 'Nf3', 'Nc6', 'Ba6']) };
    expect(lineEndStatus(base, end).state).toBe('open');
    expect(lineEndStatus(withLine(base, ['e4', 'e5', 'Nf3', 'Nc6', 'Ba6', 'bxa6']), end).state).toBe('done');
  });

  it('a dubious move is done when replaced, when the better move is added, or when a new check finds it fine', () => {
    const at = key(['e4', 'e5', 'Nf3', 'Nc6']);
    const ba6 = lineFromSans(['e4', 'e5', 'Nf3', 'Nc6', 'Ba6'])!.at(-1)!;
    const id = `${at}|${ba6.uci}`;
    const issue = { key: at, san: 'Ba6', id, flag: { loss: 580, bestSan: 'Bb5', bestCp: 30, depth: 16, at: 1000 } };
    expect(engineStatus(base, issue, 50).state).toBe('open');
    expect(engineStatus(withLine(base, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), issue, 50)).toMatchObject({ state: 'done', note: 'Bb5 added' });
    expect(engineStatus(deleteMove(base, at, ba6.uci), issue, 50)).toMatchObject({ state: 'done', note: 'move changed' });
    const rechecked = { ...base, engine: { [id]: { ...issue.flag, loss: 20, at: 2000 } } };
    expect(engineStatus(rechecked, issue, 50).state).toBe('done');
  });
});

describe('check results between devices', () => {
  const report = (n: number) => ({ gaps: [], lineEnds: [], coverage: n, positions: 1, errors: [] });
  const g = (at: number) => ({ report: report(at), at, minReach: 0.02 });
  const e = (at: number) => ({ issues: [], at, threshold: 50 });

  it('keeps the newest search and the newest engine check per repertoire, and drops gone repertoires', () => {
    const local = { a: { gaps: g(5), engine: e(1) }, gone: { gaps: g(9) } };
    const remote = { a: { gaps: g(3), engine: e(7) }, b: { engine: e(2) } };
    const m = mergeChecks(local, remote, new Set(['a', 'b']));
    expect(m.a.gaps!.at).toBe(5);
    expect(m.a.engine!.at).toBe(7);
    expect(m.b.engine!.at).toBe(2);
    expect(m.gone).toBeUndefined();
  });

  it('returns the same object when nothing changes (so it does not count as an edit)', () => {
    const local = { a: { gaps: g(5) } };
    expect(mergeChecks(local, { a: { gaps: g(3) } }, new Set(['a']))).toBe(local);
  });

  it('travels with the data when two devices are merged', () => {
    const rep = newRepertoire('p', 'e4', 'white');
    const profile = { id: 'p', name: 'F', ratings: [], speeds: [], updatedAt: 1 } as unknown as AppData['profiles'][number];
    const base: AppData = { version: 1, profiles: [profile], repertoires: [rep], activeProfileId: 'p', activeRepId: rep.id, lastBackupAt: null };
    const phone = { ...base, checks: { [rep.id]: { gaps: g(10) } } };
    const desktop = { ...base, checks: { [rep.id]: { engine: e(20) } } };
    const merged = mergeData(desktop, phone);
    expect(merged.checks![rep.id]).toMatchObject({ gaps: { at: 10 }, engine: { at: 20 } });
  });
});

describe('changed since the check', () => {
  const rep = withLine(newRepertoire('p', 'e4', 'white'), ['e4', 'e5', 'Nf3']);
  const filters = gapFilters({ ratings: [1600], speeds: ['blitz'], maxPly: 20 });
  const report = { gaps: [], lineEnds: [], coverage: 1, positions: 1, errors: [] };

  it('notices new moves, but not comments or training', () => {
    const saved = savedGaps(rep, report, 0.02, filters);
    expect(gapsChanged(rep, saved, filters)).toBeNull();
    expect(gapsChanged({ ...rep, notes: { x: 'a note' }, cards: {} }, saved, filters)).toBeNull();
    expect(gapsChanged(withLine(rep, ['e4', 'c5']), saved, filters)).toBe('repertoire');
    expect(gapsChanged(rep, saved, gapFilters({ ratings: [1800], speeds: ['blitz'], maxPly: 20 }))).toBe('filters');
    expect(gapsChanged(rep, { ...saved, repHash: undefined }, filters)).toBe('unknown');
  });

  it('the engine check only cares about your own moves', () => {
    const saved = savedEngine(rep, [], 50, 16);
    expect(engineChanged(withLine(rep, ['e4', 'c5']), saved)).toBeNull(); // only an opponent move
    expect(engineChanged(withLine(rep, ['e4', 'c5', 'Nf3']), saved)).toBe('repertoire');
  });
});

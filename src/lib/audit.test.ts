import { describe, expect, it } from 'vitest';
import { findGaps } from './audit';
import { fenKey, lineFromSans, START_KEY } from './chess';
import { addLine, newRepertoire } from './repertoire';
import type { ExplorerResult } from './lichess';

const key = (sans: string[]) => (sans.length ? lineFromSans(sans)!.at(-1)!.to : START_KEY);
const stats = (moves: [string, number][]): ExplorerResult =>
  ({
    white: moves.reduce((a, [, n]) => a + n, 0),
    draws: 0,
    black: 0,
    moves: moves.map(([san, n]) => ({ san, uci: '', white: n, draws: 0, black: 0, averageRating: 1500 })),
  }) as unknown as ExplorerResult;

describe('finding gaps', () => {
  // White: 1.d4, then 2.c4 against both 1…Nf6 and 1…e6; both reach 1.d4 Nf6 2.c4 e6, where only 3.Nc3 d5 is prepared.
  let rep = newRepertoire('p', 'QG', 'white');
  for (const l of [
    ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'd5'],
    ['d4', 'e6', 'c4', 'Nf6'],
  ])
    rep = addLine(rep, lineFromSans(l)!);
  const db = new Map<string, ExplorerResult>([
    [key(['d4']), stats([['Nf6', 60], ['e6', 40]])],
    [key(['d4', 'Nf6', 'c4']), stats([['e6', 50], ['g6', 50]])],
    [key(['d4', 'e6', 'c4']), stats([['Nf6', 75], ['d5', 25]])],
    [key(['d4', 'Nf6', 'c4', 'e6', 'Nc3']), stats([['Bb4', 50], ['d5', 30], ['b6', 20]])],
  ]);
  const explorer = async (k: string) => db.get(k) ?? stats([]);

  it('adds up every move order that reaches a position', async () => {
    const r = await findGaps(rep, { ratings: [], speeds: [], minReach: 0.001, maxPly: 20 }, () => {}, new AbortController().signal, explorer);
    const bb4 = r.gaps.find((g) => g.san === 'Bb4')!;
    // Reach of the Nimzo position: 0.6·0.5 (via 1…Nf6) + 0.4·0.75 (via 1…e6) = 0.6; Bb4 is half of that.
    expect(bb4.reach).toBeCloseTo(0.3);
    expect(bb4.routes).toBe(2);
    expect(r.gaps.find((g) => g.san === 'g6')!.reach).toBeCloseTo(0.3);
    expect(r.gaps.find((g) => g.san === 'd5' && g.line.length === 3)!.reach).toBeCloseTo(0.1);
    // Inside the preparation: 1 − (g6 0.3 + d5 0.1 + Bb4 0.3 + b6 0.12).
    expect(r.coverage).toBeCloseTo(0.18);
    expect(fenKey(`${bb4.key} 0 1`)).toBe(key(['d4', 'Nf6', 'c4', 'e6', 'Nc3']));
  });

  it('leaves out what you meet too rarely', async () => {
    const r = await findGaps(rep, { ratings: [], speeds: [], minReach: 0.2, maxPly: 20 }, () => {}, new AbortController().signal, explorer);
    expect(r.gaps.map((g) => g.san).sort()).toEqual(['Bb4', 'g6']);
  });
});

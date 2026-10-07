import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lineFromSans } from './chess';
import { addLine, newRepertoire, type Repertoire } from './repertoire';

// A fake engine: the best move is always worth +0.30 and is never one of the repertoire's moves, so after each of your
// moves the position after it is evaluated too, at a score that depends on the position (some moves come out dubious).
const calls: string[] = [];
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
vi.mock('./evaluate', async (orig) => {
  const real = await orig<typeof import('./evaluate')>();
  return {
    ...real,
    evaluate: async (key: string, o: { multiPv: number }) => {
      calls.push(key);
      const cp = o.multiPv > 1 ? 30 : (hash(key) % 300) - 150;
      return { source: 'local', depth: 16, lines: [{ cp, uci: ['a1a1'], san: ['Bb5'] }] };
    },
  };
});

const { engineCheck } = await import('./audit');

const line = (rep: Repertoire, sans: string[]) => addLine(rep, lineFromSans(sans)!);
const opts = { threshold: 50, maxPly: 24, localDepth: 16 };
const run = (rep: Repertoire, known?: Repertoire['engine']) => engineCheck(rep, opts, () => {}, new AbortController().signal, known);

describe('engine check again', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('keeps earlier evaluations and only evaluates new moves, with the same result as evaluating everything', async () => {
    let rep = line(newRepertoire('p', 'e4', 'white'), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    const first = await run(rep);
    expect(first.evaluated).toBe(3);
    rep = { ...rep, engine: first.flags };

    // One new white move (and the black reply before it).
    rep = line(rep, ['e4', 'c5', 'Nf3']);
    calls.length = 0;
    const again = await run(rep, rep.engine);
    expect(again).toMatchObject({ evaluated: 1, reused: 3 });
    expect(calls).toHaveLength(2); // the position before 2.Nf3, and the one after it (not among the candidates)

    calls.length = 0;
    const full = await run(rep);
    expect(full.evaluated).toBe(4);
    const strip = (r: typeof full) => Object.fromEntries(Object.entries(r.flags).map(([id, f]) => [id, { ...f, at: 0 }]));
    expect(strip(again)).toEqual(strip(full));
    expect(full.issues.length).toBeGreaterThan(0);
    expect(again.issues.map((i) => i.id)).toEqual(full.issues.map((i) => i.id));
  });

  it('evaluates again what was evaluated less deep than asked', async () => {
    let rep = line(newRepertoire('p', 'e4', 'white'), ['e4', 'e5', 'Nf3']);
    const first = await run(rep);
    rep = { ...rep, engine: Object.fromEntries(Object.entries(first.flags).map(([id, f]) => [id, { ...f, depth: 12 }])) };
    const again = await run(rep, rep.engine);
    expect(again).toMatchObject({ evaluated: 2, reused: 0 });
  });
});

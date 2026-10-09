import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { planLine } from './linePlan';
import { addLine, edgeId, inTrainDepth, myEdgesInOrder, newRepertoire, setTrainDepth, type Repertoire } from './repertoire';

const build = (lines: string[][]) => lines.reduce((r, l) => addLine(r, lineFromSans(l)!), newRepertoire('p', 'e4', 'white'));
const key = (sans: string[]) => (sans.length ? lineFromSans(sans)!.at(-1)!.to : START_KEY);
const id = (_rep: Repertoire, sans: string[]) => edgeId(key(sans.slice(0, -1)), lineFromSans(sans)!.at(-1)!.uci);
const sans = (moves: { san: string }[]) => moves.map((m) => m.san).join(' ');

const rep = build([
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4'],
  ['e4', 'e5', 'Nf3', 'd6', 'd4'],
  ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'],
  ['e4', 'c5', 'Nf3', 'Nc6', 'd4'],
]);
const order = myEdgesInOrder(rep).map((e) => edgeId(e.from, e.uci));
const plan = (targets: Set<string>, r = rep, start = START_KEY) => planLine(r, { start, targets, order, inDepth: inTrainDepth(r) });

describe('planning whole lines', () => {
  it('plays a line from the start through the target to the end of the line', () => {
    const targets = new Set([id(rep, ['e4', 'c5', 'Nf3', 'd6', 'd4'])]);
    const p = plan(targets)!;
    expect(sans(p.moves)).toBe('e4 c5 Nf3 d6 d4 cxd4 Nxd4');
    expect(targets.size).toBe(0);
  });

  it('chooses the opponent reply that leads to more targets, and covers several in one line', () => {
    const t = new Set([id(rep, ['e4', 'e5', 'Nf3', 'd6', 'd4']), id(rep, ['e4', 'e5', 'Nf3'])]);
    const p = plan(t)!;
    // Nf3 first (tree order); after it, 2...d6 leads to the other target, 2...Nc6 to none.
    expect(sans(p.moves)).toBe('e4 e5 Nf3 d6 d4');
    expect(p.covers.size).toBe(2);
    expect(plan(t)).toBeNull();
  });

  it('every target comes up, in as few lines as the tree allows', () => {
    const all = new Set(order);
    const lines: string[] = [];
    for (let p = plan(all); p; p = plan(all)) lines.push(sans(p.moves));
    expect(lines).toEqual([
      'e4 e5 Nf3 Nc6 Bb5 a6 Ba4',
      'e4 e5 Nf3 d6 d4',
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4',
      'e4 c5 Nf3 Nc6 d4',
    ]);
  });

  it('stops at the training depth', () => {
    const r = setTrainDepth(rep, 2);
    const t = new Set([id(r, ['e4', 'e5', 'Nf3'])]);
    expect(sans(plan(t, r)!.moves)).toBe('e4 e5 Nf3');
  });

  it('starts at the branch you train from', () => {
    const start = key(['e4', 'c5']);
    const t = new Set([id(rep, ['e4', 'c5', 'Nf3', 'Nc6', 'd4'])]);
    expect(sans(plan(t, rep, start)!.moves)).toBe('Nf3 Nc6 d4');
  });

  it('drops targets that are not reachable from the start', () => {
    const start = key(['e4', 'c5']);
    const t = new Set([id(rep, ['e4', 'e5', 'Nf3'])]);
    expect(plan(t, rep, start)).toBeNull();
    expect(t.size).toBe(0);
  });
});

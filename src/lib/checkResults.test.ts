import { describe, expect, it } from 'vitest';
import { lineFromSans, START_KEY } from './chess';
import { engineStatus, gapStatus, lineEndStatus } from './checkResults';
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

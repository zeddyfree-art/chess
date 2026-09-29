import { describe, expect, it } from 'vitest';
import { fenKey, moveFromBoard, playSan, playUci, START_KEY, type PlayedMove } from './chess';
import {
  addLine,
  buildTree,
  deleteMove,
  deletionImpact,
  edgeId,
  findPath,
  myEdgesInOrder,
  newRepertoire,
  ROOT,
  stats,
  toMoves,
  type Repertoire,
} from './repertoire';
import { exportPgn, importPgn } from './pgn';
import { buildQueue, gradeCard, Rating, State, syncCards } from './srs';

function line(sans: string[], from = START_KEY): PlayedMove[] {
  const out: PlayedMove[] = [];
  let key = from;
  for (const san of sans) {
    const m = playSan(key, san);
    if (!m) throw new Error(`illegal ${san}`);
    out.push(m);
    key = m.to;
  }
  return out;
}

function rep(side: 'white' | 'black', ...lines: string[][]): Repertoire {
  let r = newRepertoire('p', 'test', side);
  for (const l of lines) r = addLine(r, line(l));
  return r;
}

describe('chess helpers', () => {
  it('normalizes en passant and move counters in keys', () => {
    // After 1.e4 there is no legal en-passant capture, so the ep square is dropped.
    const afterE4 = playSan(START_KEY, 'e4')!;
    expect(afterE4.to).toBe(fenKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));
    expect(afterE4.to.split(' ')).toHaveLength(4);
  });

  it('handles castling from the board and standard UCI', () => {
    const l = line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const key = l.at(-1)!.to;
    const viaG1 = moveFromBoard(key, 'e1', 'g1');
    const viaH1 = moveFromBoard(key, 'e1', 'h1');
    expect(viaG1?.san).toBe('O-O');
    expect(viaH1?.uci).toBe(viaG1?.uci);
    expect(playUci(key, 'e1g1')?.san).toBe('O-O');
  });
});

describe('repertoire graph', () => {
  it('shares transpositions', () => {
    const r = rep('white', ['d4', 'Nf6', 'c4', 'e6'], ['c4', 'e6', 'd4', 'Nf6', 'Nc3']);
    const tree = buildTree(r);
    const transpositions: string[] = [];
    const walk = (ns: typeof tree) =>
      ns.forEach((n) => {
        if (n.transposition) transpositions.push(n.san);
        walk(n.children);
      });
    walk(tree);
    expect(transpositions).toEqual(['Nf6']);
    // Nc3 was added via the c4 move order but hangs under the shared position.
    const endKey = line(['d4', 'Nf6', 'c4', 'e6']).at(-1)!.to;
    expect(r.positions[endKey].map((m) => m.san)).toEqual(['Nc3']);
  });

  it('deletes a branch and garbage-collects, but keeps transposed positions still reachable', () => {
    let r = rep('white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], ['e4', 'c5', 'Nf3', 'd6', 'd4']);
    r = syncCards(r);
    expect(Object.keys(r.cards)).toHaveLength(5);
    const e5 = line(['e4', 'e5']);
    const impact = deletionImpact(r, e5[1].from, e5[1].uci);
    expect(impact).toEqual({ plies: 4, moves: 2, cards: 2 });
    const after = deleteMove(r, e5[1].from, e5[1].uci);
    expect(stats(after).plies).toBe(5);
    expect(Object.keys(after.cards)).toHaveLength(3);
  });

  it('finds the shortest path to a position', () => {
    const r = rep('black', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
    const target = line(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4']).at(-1)!.to;
    expect(findPath(r, target)?.map((s) => s.san)).toEqual(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4']);
    expect(findPath(r, ROOT)).toEqual([]);
  });

  it('counts only our moves as cards', () => {
    const r = syncCards(rep('black', ['e4', 'c5', 'Nf3', 'd6'], ['d4', 'Nf6']));
    expect(myEdgesInOrder(r).map((e) => e.san)).toEqual(['c5', 'd6', 'Nf6']);
    expect(Object.keys(r.cards)).toHaveLength(3);
  });
});

describe('pgn', () => {
  it('imports variations and exports them again', () => {
    const pgn = `[Event "Test"]

1. e4 e5 (1... c5 2. Nf3 {Open Sicilian} d6 3. d4) 2. Nf3 Nc6 3. Bb5 *`;
    const res = importPgn(newRepertoire('p', 't', 'white'), pgn);
    expect(res.errors).toEqual([]);
    expect(res.added).toBe(9);
    const c5 = line(['e4', 'c5', 'Nf3']).at(-1)!;
    expect(res.rep.positions[c5.from].find((m) => m.san === 'Nf3')?.comment).toBe('Open Sicilian');

    const again = importPgn(newRepertoire('p', 't', 'white'), exportPgn(res.rep));
    expect(stats(again.rep).plies).toBe(9);
  });

  it('reports illegal moves instead of crashing', () => {
    const res = importPgn(newRepertoire('p', 't', 'white'), '1. e4 e5 2. Ke3 *');
    expect(res.added).toBe(2);
    expect(res.errors.length).toBe(1);
  });
});

describe('srs', () => {
  it('schedules reviews and queues new cards after due ones', () => {
    let r = syncCards(rep('white', ['e4', 'e5', 'Nf3'], ['e4', 'c5', 'c3']));
    const first = myEdgesInOrder(r)[0];
    const id = edgeId(first.from, first.uci);
    expect(r.cards[id].state).toBe(State.New);
    const now = Date.now();
    r = { ...r, cards: { ...r.cards, [id]: gradeCard(r.cards[id], Rating.Good, now) } };
    expect(r.cards[id].state).not.toBe(State.New);
    expect(r.cards[id].due).toBeGreaterThan(now);
    const queue = buildQueue(r, { newLimit: 10, now });
    expect(queue.map((q) => q.san)).toEqual(['Nf3', 'c3']);
    const later = buildQueue(r, { newLimit: 0, now: now + 1000 * 60 * 60 * 24 * 30 });
    expect(later.map((q) => q.san)).toEqual(['e4']);
  });
});

describe('counting moves', () => {
  it('counts a move as White\'s move plus Black\'s reply', () => {
    expect(toMoves(0)).toBe(0);
    expect(toMoves(1)).toBe(1); // 1.e4
    expect(toMoves(2)).toBe(1); // 1.e4 e5
    expect(toMoves(3)).toBe(2); // 1.e4 e5 2.Nf3
    expect(toMoves(20)).toBe(10);
  });

  it('reports one line in books\' terms, with half-moves alongside', () => {
    const r = rep('white', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    const st = stats(r);
    expect(st.plies).toBe(6);
    expect(st.moves).toBe(3); // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6
    expect(st.myMoves).toBe(3);
    expect(st.oppMoves).toBe(3);
    expect(st.lineEnds).toBe(1);
    expect(st.longest).toBe(3);
    expect(st.avgLine).toBe(3);
  });

  it('counts branches once and reports lines separately', () => {
    // 1.e4 e5 2.Nf3 Nc6 | 1.e4 c5 2.Nf3 | 1.d4 d5  ->  e4 e5 Nf3 Nc6 c5 Nf3 d4 d5 = 8 half-moves
    const r = rep('white', ['e4', 'e5', 'Nf3', 'Nc6'], ['e4', 'c5', 'Nf3'], ['d4', 'd5']);
    const st = stats(r);
    expect(st.plies).toBe(8);
    expect(st.moves).toBe(4);
    expect(st.lineEnds).toBe(3);
    expect(st.longest).toBe(2);
  });

  it('shows a removed leaf reply as one move, not zero', () => {
    const r = rep('white', ['e4', 'e5']);
    const l = line(['e4', 'e5']);
    expect(deletionImpact(r, l[1].from, l[1].uci)).toEqual({ plies: 1, moves: 1, cards: 0 });
  });
});

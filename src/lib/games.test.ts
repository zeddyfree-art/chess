import { describe, expect, it } from 'vitest';
import { DAILY_EVALS, DAILY_PGN } from './__fixtures__/dailyGame';
import {
  accuracy,
  candidateMoments,
  divide,
  explainMoment,
  formatEval,
  judge,
  lossAt,
  momentKind,
  phaseOf,
  summarize,
  verdicts,
  winPct,
} from './analysis';
import { START_KEY } from './chess';
import { colorOf, gameLine, parsePgnGames, speedFromTimeControl, toPlayedGame, type GamesData, type PlayedGame } from './games';
import { mergeGames, sameGames } from './gamesStore';
import { fromLichessJson, type LichessGameJson } from './lichessGames';
import { addCards, cardFromMoment, mergeMistakes, mistakeQueue } from './mistakes';
import { nullMoveKey } from './analyzer';
import { gradeCard, Rating } from './srs';
import { classify } from './sync';
import { EMPTY_DATA } from './store';

const daily = () => {
  const parsed = parsePgnGames(DAILY_PGN);
  return toPlayedGame(parsed.games[0], 'p1', 'white');
};

describe('reading played games from PGN', () => {
  it('reads a pasted game with broken move numbers', () => {
    const r = parsePgnGames(DAILY_PGN);
    expect(r.games).toHaveLength(1);
    const g = r.games[0];
    expect(g.moves).toHaveLength(78);
    expect(g.moves.slice(28, 30)).toEqual(['Bh4', 'Nbd7']); // "2. Bh4" was move 15
    expect(g.result).toBe('0-1');
    expect(g.speed).toBe('correspondence');
    expect(g.whiteElo).toBe(1299);
    expect(g.playedAt).toBe(Date.UTC(2026, 9, 4, 12));
    expect(g.sourceId).toBe('chesscom:123456789');
    expect(g.opening).toBe('French Defense Winawer Variation');
    expect(r.names.map((n) => n.name)).toEqual(['Player', 'Opponent']);
  });

  it('finds which side you played by any of your names', () => {
    expect(colorOf({ white: 'Player', black: 'Opponent' }, ['someone', 'player'])).toBe('white');
    expect(colorOf({ white: 'Player', black: 'Opponent' }, ['OPPONENT'])).toBe('black');
    expect(colorOf({ white: 'Player', black: 'Opponent' }, ['x'])).toBeNull();
  });

  it('knows Lichess and fingerprints other games so they are not imported twice', () => {
    const lichess = parsePgnGames('[Site "https://lichess.org/AbCd1234"]\n[White "a"]\n[Black "b"]\n\n1. e4 e5 2. Nf3 *').games[0];
    expect(lichess.sourceId).toBe('lichess:AbCd1234');
    expect(lichess.url).toBe('https://lichess.org/AbCd1234');
    const a = parsePgnGames('[White "a"]\n[Black "b"]\n[Date "2026.01.02"]\n\n1. e4 e5 2. Nf3 *').games[0];
    const b = parsePgnGames('[White "a"]\n[Black "b"]\n[Date "2026.01.02"]\n\n1. e4 e5 2. Nf3 Nc6 *').games[0];
    expect(a.sourceId).toMatch(/^pgn:/);
    expect(a.sourceId).not.toBe(b.sourceId);
    expect(parsePgnGames('[White "a"]\n[Black "b"]\n[Date "2026.01.02"]\n\n1. e4 e5 2. Nf3 *').games[0].sourceId).toBe(a.sourceId);
  });

  it('skips games it cannot use, and says why', () => {
    const r = parsePgnGames('[Variant "Chess960"]\n\n1. e4 *\n\n[FEN "8/8/8/8/8/8/8/K1k5 w - - 0 1"]\n[SetUp "1"]\n\n1. Kb1 *\n\n1. e4 *');
    expect(r.games).toHaveLength(0);
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { reason: 'other chess variants', n: 1 },
        { reason: 'not from the starting position', n: 1 },
        { reason: 'fewer than two moves', n: 1 },
      ]),
    );
  });

  it('turns time controls into Lichess speeds', () => {
    expect(speedFromTimeControl('60+0')).toBe('bullet');
    expect(speedFromTimeControl('180+2')).toBe('blitz');
    expect(speedFromTimeControl('600+5')).toBe('rapid');
    expect(speedFromTimeControl('1800+0')).toBe('classical');
    expect(speedFromTimeControl('-')).toBe('correspondence');
    expect(speedFromTimeControl(undefined)).toBeUndefined();
  });
});

describe('Lichess export', () => {
  const json: LichessGameJson = {
    id: 'q7ZvsdUF',
    rated: true,
    variant: 'standard',
    speed: 'blitz',
    createdAt: 1,
    lastMoveAt: 2,
    status: 'mate',
    players: { white: { user: { name: 'Alice', id: 'alice' }, rating: 1500 }, black: { user: { name: 'Bob', id: 'bob' }, rating: 1480 } },
    winner: 'white',
    opening: { eco: 'C20', name: "King's Pawn Game" },
    moves: 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#',
    clock: { initial: 300, increment: 3 },
    analysis: [{ eval: 30 }, { eval: 25 }, { eval: 10 }, { eval: 15 }, { eval: 5 }, { mate: 1, best: 'g7g6' }],
  };

  it('reads a game with Lichess’ own evaluations', () => {
    const g = fromLichessJson(json);
    if (typeof g === 'string') throw new Error(g);
    expect(g.sourceId).toBe('lichess:q7ZvsdUF');
    expect(g.moves).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(g.result).toBe('1-0');
    expect(g.timeControl).toBe('300+3');
    expect(g.termination).toBe('Checkmate');
    // Position 0 has no evaluation; position i is after move i; a mate in 1 is encoded above any centipawns.
    expect(g.lichessEvals).toEqual([null, 30, 25, 10, 15, 5, 9990]);
    expect(g.lichessBest?.[5]).toBe('g7g6');
  });

  it('leaves out variants and aborted games', () => {
    expect(fromLichessJson({ ...json, variant: 'chess960' })).toBe('other chess variants');
    expect(fromLichessJson({ ...json, status: 'aborted' })).toBe('aborted or unfinished');
    expect(fromLichessJson({ ...json, initialFen: '8/8/8/8/8/8/8/K1k5 w - - 0 1' })).toBe('not from the starting position');
  });
});

describe('judging the moves (Lichess’ method)', () => {
  it('converts evaluations to winning chances', () => {
    expect(winPct(0)).toBe(50);
    expect(winPct(300) + winPct(-300)).toBeCloseTo(100);
    expect(winPct(5000)).toBeCloseTo(winPct(1000));
    expect(formatEval(125)).toBe('+1.3');
    expect(formatEval(-40)).toBe('−0.4');
    expect(formatEval(9970)).toBe('#3');
    expect(formatEval(-9980)).toBe('#−2');
  });

  it('labels the game’s turning points', () => {
    const v = verdicts(DAILY_EVALS);
    // 22…Nh7?? gave White a winning position, 23.e4 gave it back: a miss.
    expect(v[43].judgment).toBe('blunder');
    expect(v[44]).toMatchObject({ judgment: 'blunder', miss: true });
    expect(momentKind(DAILY_EVALS, 44)).toBe('miss');
    // 25.Qf3 and 32.Rc1 were plain blunders, 26.e5 a mistake.
    expect(momentKind(DAILY_EVALS, 48)).toBe('blunder');
    expect(momentKind(DAILY_EVALS, 62)).toBe('blunder');
    expect(judge(lossAt(DAILY_EVALS, 50))).toBe('mistake');
    // 18.Nxf6+ (missing 18.Nxg5) stayed under the inaccuracy line.
    expect(v[34].judgment).toBeNull();
    expect(candidateMoments(DAILY_EVALS, 'white')).toEqual([44, 48, 50, 62]);
  });

  it('computes accuracy, overall and per phase', () => {
    const keys = [START_KEY, ...gameLine(daily().moves).map((m) => m.to)];
    const d = divide(keys);
    expect(d.middlegame).toBeGreaterThan(14);
    expect(d.middlegame).toBeLessThan(30);
    expect(d.endgame).toBeGreaterThan(60);
    expect(phaseOf(44, d)).toBe('middlegame');
    expect(phaseOf(76, d)).toBe('endgame');
    const white = accuracy(DAILY_EVALS, 'white')!;
    const black = accuracy(DAILY_EVALS, 'black')!;
    expect(white).toBeGreaterThan(75);
    expect(white).toBeLessThan(95);
    expect(black).toBeGreaterThan(white - 10);
    const s = summarize(DAILY_EVALS, d, 'white');
    expect(s.blunders + s.misses).toBe(3);
    expect(s.mistakes).toBe(1);
    expect(s.byPhase.opening!).toBeGreaterThan(s.byPhase.middlegame!);
  });

  it('explains a moment in words', () => {
    const text = explainMoment(
      { ply: 44, kind: 'miss', best: ['fxg5'], line: ['fxg5', 'Qe7'], bestEval: 497, playedEval: 181, reply: ['c6'], maia: { best: 0.62, played: 0.03 } },
      { played: 'e4', previous: 'Nh7', rating: 1300 },
    ).join(' ');
    expect(text).toContain('22…Nh7 was a mistake');
    expect(text).toContain('23.fxg5 would have punished it');
    expect(text).toContain('About 62% of players around 1300 find fxg5');
  });

  it('asks for the opponent’s threat with a null move, not when in check', () => {
    expect(nullMoveKey('2r1r1k1/7n/R3p3/1Q3pp1/2P5/2q5/2P2BPP/5RK1 w - -')).toBe('2r1r1k1/7n/R3p3/1Q3pp1/2P5/2q5/2P2BPP/5RK1 b - -');
    expect(nullMoveKey('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq -')).toBeNull();
  });
});

describe('mistake cards', () => {
  const game = { ...daily(), analysis: undefined } as PlayedGame;
  const moment = { ply: 44, kind: 'miss' as const, loss: 20, best: ['fxg5'], line: ['fxg5', 'Qe7'], bestEval: 497, playedEval: 181 };

  it('makes a card from a moment, one per position', () => {
    const c = cardFromMoment(game, moment, 1300, 1000);
    expect(c.played).toBe('e4');
    expect(c.line).toHaveLength(44);
    expect(c.line.at(-1)).toBe('Nh7');
    expect(c.side).toBe('white');
    const again = cardFromMoment({ ...game, id: 'p1|other' }, moment, 1300, 2000);
    const { cards, added } = addCards([c], [again]);
    expect(added).toBe(0);
    expect(cards[0].games.map((g) => g.id)).toEqual([game.id, 'p1|other']);
  });

  it('merges content and training separately, and trains due cards first', () => {
    const c = cardFromMoment(game, moment, 1300, 1000);
    const trained = { ...c, card: gradeCard(c.card, Rating.Good, 5000) };
    const edited = { ...c, updatedAt: 3000, games: [...c.games, { id: 'x', label: 'x', ply: 1 }] };
    const merged = mergeMistakes([trained], [edited])[0];
    expect(merged.card).toBe(trained.card);
    expect(merged.games).toHaveLength(2);
    expect(mistakeQueue([trained, edited], 10, 10_000_000_000).map((m) => m.card.state)).toEqual([trained.card.state, edited.card.state]);
    // 0 new cards: only the reviews.
    expect(mistakeQueue([trained, edited], 0, 10_000_000_000).map((m) => m.card.state)).toEqual([trained.card.state]);
  });

  it('sync sees training of a mistake card as training, a new card as an edit', () => {
    const c = cardFromMoment(game, moment, 1300, 1000);
    const a = { ...EMPTY_DATA, mistakes: [c] };
    expect(classify(a, { ...a, mistakes: [{ ...c, card: gradeCard(c.card, Rating.Good) }] })).toBe('training');
    expect(classify(a, { ...a, mistakes: [c, { ...c, id: 'other' }] })).toBe('edit');
  });
});

describe('syncing games', () => {
  const g = (id: string, patch: Partial<PlayedGame> = {}): PlayedGame => ({ ...daily(), id, addedAt: 10, updatedAt: 10, ...patch });
  const data = (games: PlayedGame[], deleted: Record<string, number> = {}): GamesData => ({ version: 1, games, deleted });

  it('keeps games from both sides and the newer analysis', () => {
    const analysis = { version: 1, evals: DAILY_EVALS, best: [], from: 'local' as const, depth: 14, moments: [], analysedAt: 50 };
    const merged = mergeGames(data([g('a'), g('b')]), data([g('b', { analysis, updatedAt: 50, dismissed: [44] }), g('c')]));
    expect(merged.games.map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
    const b = merged.games.find((x) => x.id === 'b')!;
    expect(b.analysis).toBe(analysis);
    expect(b.dismissed).toEqual([44]);
  });

  it('respects deletions, unless the game was imported again later', () => {
    expect(mergeGames(data([g('a')]), data([], { a: 20 })).games).toHaveLength(0);
    expect(mergeGames(data([g('a', { addedAt: 30 })]), data([], { a: 20 })).games).toHaveLength(1);
  });

  it('tells when nothing needs uploading', () => {
    const x = data([g('a')]);
    expect(sameGames(x, mergeGames(x, x))).toBe(true);
    expect(sameGames(x, data([g('a'), g('b')]))).toBe(false);
  });
});

describe('clocks and export', () => {
  it('reads [%clk] from a PGN and works out the time per move', async () => {
    const { parsePgnGames, moveTime, formatClock } = await import('./games');
    const pgn = '[White "a"]\n[Black "b"]\n[TimeControl "180+2"]\n\n1. e4 { [%clk 0:03:00] } e5 { [%clk 0:03:00] } 2. Nf3 { [%clk 0:02:55] } Nc6 { [%clk 0:02:41.5] } *';
    const g = parsePgnGames(pgn).games[0];
    expect(g.clocks).toEqual([180, 180, 175, 161.5]);
    const pg = { clocks: g.clocks, timeControl: g.timeControl };
    expect(moveTime(pg, 2)).toEqual({ spent: 7, left: 175 });
    expect(moveTime(pg, 3)).toEqual({ spent: 20.5, left: 161.5 });
    expect(formatClock(161.5)).toBe('2:42');
  });

  it('takes Lichess clocks (centiseconds), with or without the starting time first', () => {
    const base = { id: 'x', variant: 'standard', status: 'resign', players: { white: { user: { name: 'a', id: 'a' } }, black: { user: { name: 'b', id: 'b' } } }, moves: 'e4 e5 Nf3' };
    const a = fromLichessJson({ ...base, clocks: [18000, 18000, 17500] }) as { clocks?: number[] };
    const b = fromLichessJson({ ...base, clocks: [18000, 18000, 18000, 17500] }) as { clocks?: number[] };
    expect(a.clocks).toEqual([180, 180, 175]);
    expect(b.clocks).toEqual([180, 180, 175]);
  });

  it('exports mistake cards as PGN that reads back', async () => {
    const { mistakesToPgn } = await import('./mistakes');
    const { parsePgn, startingPosition } = await import('chessops/pgn');
    const { parseSan } = await import('chessops/san');
    const game = daily();
    const c = cardFromMoment(game, { ply: 44, kind: 'miss', loss: 20, best: ['fxg5'], line: ['fxg5', 'Qe7', 'gxh6'], bestEval: 497, playedEval: 181, reply: ['a5', 'fxg5'] }, 1300);
    const c2 = cardFromMoment({ ...game, myColor: 'black' }, { ply: 55, kind: 'mistake', loss: 12, best: ['Rc8'], line: ['Rc8', 'Qxa6'], bestEval: 7, playedEval: 149 }, 1300);
    const pgn = mistakesToPgn([c, c2]);
    const games = parsePgn(pgn);
    expect(games).toHaveLength(2);
    for (const g of games) {
      const pos = startingPosition(g.headers).unwrap();
      for (const node of g.moves.mainline()) {
        const m = parseSan(pos, node.san);
        expect(m, node.san).toBeTruthy();
        pos.play(m!);
      }
    }
    expect(pgn).toContain('23. fxg5!');
    expect(pgn).toContain('( 23. e4??');
    expect(pgn).toContain('28... Rc8!');
    expect(pgn).toContain('( 28... Qd4+?');
  });
});

describe('updating games and keeping unknown data', () => {
  it('adds clock times to a game that is already there', async () => {
    const { useGames } = await import('./gamesStore');
    const g = daily();
    useGames.setState({ data: { version: 1, games: [g], deleted: {} } });
    const withClocks = { ...g, clocks: g.moves.map((_, i) => 1000 - i) };
    const r = useGames.getState().addGames([withClocks]);
    expect(r).toEqual({ added: 0, already: 1, updated: 1 });
    expect(useGames.getState().data.games[0].clocks?.[3]).toBe(997);
    // Nothing more to add the second time.
    expect(useGames.getState().addGames([withClocks]).updated).toBe(0);
  });

  it('a merge keeps fields it does not know (written by a newer version elsewhere)', async () => {
    const { mergeData } = await import('./merge');
    const local = { ...EMPTY_DATA };
    const remote = { ...EMPTY_DATA, futureThing: [1, 2, 3] } as typeof EMPTY_DATA;
    expect((mergeData(local, remote) as unknown as { futureThing: number[] }).futureThing).toEqual([1, 2, 3]);
  });
});

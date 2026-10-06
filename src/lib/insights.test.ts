import { describe, expect, it } from 'vitest';
import { DAILY_EVALS, DAILY_PGN } from './__fixtures__/dailyGame';
import { ANALYSIS_VERSION, type GameAnalysis } from './analysis';
import { gameLine, parsePgnGames, toPlayedGame, type PlayedGame } from './games';
import { computeInsights, filterGames, gameFacts, openingFamily, positionKeys, prepCheck, weakestPhase } from './insights';
import { addLine, newRepertoire } from './repertoire';
import { lineFromSans } from './chess';

const analysis: GameAnalysis = {
  version: ANALYSIS_VERSION,
  evals: DAILY_EVALS,
  best: [],
  from: 'local',
  depth: 14,
  moments: [
    { ply: 44, kind: 'miss', loss: 20, best: ['fxg5'], line: ['fxg5'], bestEval: 497, playedEval: 181 },
    { ply: 48, kind: 'mistake', loss: 12, best: ['e5'], line: ['e5'], bestEval: 424, playedEval: 174 },
    { ply: 62, kind: 'blunder', loss: 23, best: ['Ra7'], line: ['Ra7'], bestEval: 298, playedEval: 14, threat: ['Qxc4'] },
  ],
  analysedAt: 1,
};
const daily = (patch: Partial<PlayedGame> = {}): PlayedGame => ({ ...toPlayedGame(parsePgnGames(DAILY_PGN).games[0], 'p1', 'white'), analysis, ...patch });

describe('insights', () => {
  it('replays a game quickly into position keys', () => {
    const g = daily();
    const keys = positionKeys(g.moves);
    expect(keys).toHaveLength(79);
    expect(keys.at(-1)).toBe(gameLine(g.moves).at(-1)!.to);
  });

  it('checks a game against the repertoire', () => {
    const g = daily();
    const keys = positionKeys(g.moves);
    const rep = (sans: string[]) => addLine(newRepertoire('p1', 'r', 'white'), lineFromSans(sans)!);
    // You left it: the repertoire plays 3.e4.
    expect(prepCheck(g.moves, keys, [rep(['d4', 'e6', 'Nc3', 'Bb4', 'e4'])], 'white')).toEqual({ kind: 'you-left', ply: 4, played: 'Bf4', expected: ['e4'] });
    // Your opponent left it: you prepared 2…d5 only.
    expect(prepCheck(g.moves, keys, [rep(['d4', 'e6', 'Nc3', 'd5'])], 'white')).toEqual({ kind: 'opponent-left', ply: 3, played: 'Bb4', prepared: ['d5'] });
    // Prepared up to 3.Bf4: the preparation ended there.
    expect(prepCheck(g.moves, keys, [rep(['d4', 'e6', 'Nc3', 'Bb4', 'Bf4'])], 'white')).toEqual({ kind: 'end', ply: 5 });
    // A Black repertoire does not count for a White game.
    expect(prepCheck(g.moves, keys, [{ ...rep(['d4', 'e6']), side: 'black' }], 'white')).toEqual({ kind: 'none' });
  });

  it('names opening families from Lichess and Chess.com names', () => {
    expect(openingFamily('French Defense: Winawer Variation')).toBe('French Defense');
    expect(openingFamily('French Defense Winawer Variation')).toBe('French Defense');
    expect(openingFamily('Queens Pawn Opening Accelerated London System')).toBe('Queens Pawn Opening');
    expect(openingFamily(undefined, 'C15')).toBe('ECO C15');
  });

  it('sums up the games', () => {
    const lost = daily();
    const won = daily({ id: 'p1|won', result: '1-0', playedAt: lost.playedAt - 1000 });
    const i = computeInsights([lost, won, { ...daily({ id: 'p1|todo' }), analysis: undefined }], []);
    expect(i.total).toBe(3);
    expect(i.analysed).toBe(2);
    expect(i.results).toEqual({ win: 1, draw: 0, loss: 1 });
    // Clearly winning (about +5 after 22…Nh7) in both: one converted, one lost.
    expect(i.winning).toEqual({ games: 2, won: 1, drawn: 0, lost: 1 });
    // The loss turned on 32.Rc1 (middlegame by Lichess' divider: the queens were still on).
    expect(i.lossesDecided.middlegame).toBe(1);
    expect(i.errors).toEqual({ misses: 2, threats: 2, other: 2, total: 6 });
    expect(i.missedMoveTypes).toEqual({ capture: 2, check: 0, quiet: 4 });
    expect(i.phases.opening.mine!).toBeGreaterThan(i.phases.middlegame.mine!);
    expect(i.trend.map((t) => t.id)).toEqual(['p1|won', lost.id]);
    expect(i.openings[0]).toMatchObject({ name: 'French Defense', color: 'white', games: 2, score: 0.5 });
    expect(weakestPhase(i)).toBeNull(); // too few games to say
    expect(gameFacts(lost)!.byPhase.middlegame.errors).toBeGreaterThan(0);
  });

  it('collects unprepared opponent moves across games', () => {
    const rep = addLine(newRepertoire('p1', 'r', 'white'), lineFromSans(['d4', 'e6', 'Nc3', 'd5'])!);
    const i = computeInsights([daily(), daily({ id: 'p1|b' })], [rep]);
    expect(i.prep.games).toBe(2);
    expect(i.prep.unprepared).toHaveLength(1);
    expect(i.prep.unprepared[0]).toMatchObject({ played: 'Bb4', count: 2, ply: 3, line: ['d4', 'e6', 'Nc3'] });
  });

  it('filters by period, speed and colour', () => {
    const now = Date.UTC(2026, 9, 6);
    const g = daily();
    expect(filterGames([g], { period: 'week', speeds: [], color: 'both' }, now)).toHaveLength(1);
    expect(filterGames([g], { period: 'week', speeds: [], color: 'both' }, now + 30 * 86_400_000)).toHaveLength(0);
    expect(filterGames([g], { period: 'all', speeds: ['blitz'], color: 'both' }, now)).toHaveLength(0);
    expect(filterGames([g], { period: 'all', speeds: [], color: 'black' }, now)).toHaveLength(0);
  });
});

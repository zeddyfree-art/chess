import { describe, expect, it } from 'vitest';
import { fenKey } from './chess';
import { themesOf } from './themes';

const k = (fen: string) => fenKey(fen);

describe('tactical themes', () => {
  it('finds a missed knight fork', () => {
    expect(themesOf({ key: k('4k3/1r6/8/8/4N3/8/8/6K1 w - - 0 1'), side: 'white', played: 'Kf2', line: ['Nd6+', 'Kd7', 'Nxb7'], bestEval: 500 })).toContain('missed-fork');
  });

  it('finds a missed skewer (as a pin) along a diagonal', () => {
    expect(themesOf({ key: k('q7/8/2k5/8/8/8/8/1B4K1 w - - 0 1'), side: 'white', played: 'Kf2', line: ['Be4+', 'Kd6', 'Bxa8'], bestEval: 900 })).toContain('missed-pin');
  });

  it('finds a missed mate', () => {
    expect(themesOf({ key: k('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), side: 'white', played: 'Kf2', line: ['Ra8#'], bestEval: 9990 })).toEqual(['missed-mate']);
  });

  it('finds a piece left hanging', () => {
    const t = themesOf({ key: k('3q2k1/7p/8/8/8/3B4/8/6K1 w - - 0 1'), side: 'white', played: 'Bg6', line: ['Kf2'], reply: ['hxg6'], bestEval: -600 });
    expect(t).toContain('hanging');
  });

  it('names an overlooked threat', () => {
    expect(
      themesOf({ key: k('2r1r1k1/7n/R3p3/1Q3pp1/2P5/2q5/2P2BPP/5RK1 w - - 3 32'), side: 'white', played: 'Rc1', line: ['Ra7', 'Nf8'], reply: ['Qxc4'], threat: ['Qxc4'], bestEval: 290 }),
    ).toContain('threat');
  });

  it('does not invent themes for a quiet positional slip', () => {
    expect(themesOf({ key: k('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'), side: 'white', played: 'a3', line: ['Bb5', 'a6'], reply: ['Nf6'], bestEval: 40 })).toEqual([]);
  });
});

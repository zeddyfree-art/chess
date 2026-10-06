// Runs the whole game analysis with the real (lite) Stockfish, as the browser does. Slow (a minute or more), so
// only when asked: STOCKFISH=1 npx vitest run src/lib/analyzer.engine.test.ts
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { DAILY_PGN } from './__fixtures__/dailyGame';
import { analyseGame } from './analyzer';
import type { EngineLine, EngineOptions } from './engine';
import { parsePgnGames, toPlayedGame } from './games';

function nodeEngine() {
  const sf = spawn(process.execPath, ['node_modules/stockfish/bin/stockfish-19-lite-single.js']);
  let buf = '';
  let onLine: ((l: string) => void) | null = null;
  sf.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      onLine?.(l);
    }
  });
  const send = (s: string) => sf.stdin.write(s + '\n');
  send('uci');
  send('setoption name Hash value 32');
  return {
    quit: () => send('quit'),
    analyse(fen: string, opts: EngineOptions): Promise<EngineLine[]> {
      return new Promise((resolve) => {
        const lines: EngineLine[] = [];
        const flip = fen.split(' ')[1] === 'b' ? -1 : 1;
        onLine = (l) => {
          if (l.startsWith('bestmove')) return resolve(lines.filter(Boolean));
          const m = /depth (\d+) .*?multipv (\d+) score (cp|mate) (-?\d+).* pv (.+)$/.exec(l);
          if (!m) return;
          const e: EngineLine = { depth: +m[1], multipv: +m[2], pv: m[5].split(' ') };
          if (m[3] === 'cp') e.cp = +m[4] * flip;
          else e.mate = +m[4] * flip;
          lines[+m[2] - 1] = e;
        };
        send(`setoption name MultiPV value ${opts.multiPv ?? 1}`);
        send(`position fen ${fen}`);
        send(`go depth ${opts.depth} movetime ${opts.movetime}`);
      });
    },
  };
}

describe.skipIf(!process.env.STOCKFISH)('analysing a game with Stockfish', () => {
  it('finds the turning points of the daily game', { timeout: 600_000 }, async () => {
    const game = toPlayedGame(parsePgnGames(DAILY_PGN).games[0], 'p1', 'white');
    const engine = nodeEngine();
    const started = Date.now();
    let calls = 0;
    const counted = { analyse: (f: string, o: EngineOptions) => (calls++, engine.analyse(f, o)) };
    const a = await analyseGame(game, { engine: counted, rating: 1300 });
    engine.quit();
    const secs = (Date.now() - started) / 1000;
    console.log(`${calls} searches in ${secs.toFixed(0)} s`);
    for (const m of a.moments) console.log(JSON.stringify(m));
    const plies = a.moments.map((m) => m.ply);
    expect(plies).toEqual(expect.arrayContaining([44, 62]));
    const m23 = a.moments.find((m) => m.ply === 44)!;
    expect(m23.kind).toBe('miss');
    expect(m23.best).toContain('fxg5');
    const m32 = a.moments.find((m) => m.ply === 62)!;
    expect(m32.best[0]).toBe('Ra7');
    expect(m32.threat?.[0]).toBe('Qxc4');
  });
});

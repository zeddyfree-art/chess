// Analyses played games with Stockfish in the browser, one after another in the background.
//
// 1. Every position gets a quick evaluation (positions Lichess already analysed keep Lichess' evaluation).
// 2. Your moves that lost a lot are looked at again, deeper and with the three best moves, so the verdict
//    and the "good moves" are reliable. The position after your move gives the opponent's best answer.
// 3. For each mistake: was the opponent threatening something you overlooked? The engine is asked what the
//    opponent would play if it were their move ("null move"); if that is exactly what punished you, it was a
//    threat you missed.
// 4. If Maia is downloaded, it says how many players at your rating would find a good move (learnable?).
import { create } from 'zustand';
import { keyToFen, posFromFen, sanToUci, START_KEY, type Side } from './chess';
import { StockfishEngine, type EngineLine } from './engine';
import { pvToSan, scoreCp } from './evaluate';
import { gameLine, myElo, opponentOf, type PlayedGame } from './games';
import { isMaiaDownloaded, maiaPredict, MAIA_MAX, MAIA_MIN, loadMaia } from './maia';
import {
  ANALYSIS_VERSION,
  candidateMoments,
  isMoment,
  lossAt,
  MATE,
  momentKind,
  winFor,
  type GameAnalysis,
  type KeyMoment,
} from './analysis';

export const QUICK = { depth: 14, movetime: 1500 };
export const DEEP = { depth: 18, movetime: 4000, multiPv: 3 };
const THREAT = { depth: 14, movetime: 1500 };

/** Moves within this many Win% of the best move count as good answers on a training card. */
const GOOD_ENOUGH = 5;

export interface AnalyseOptions {
  engine: Pick<StockfishEngine, 'analyse'>;
  /** Share of players at `rating` (facing `oppRating`) playing each move; absent: Maia is not used. */
  maia?: (key: string, rating: number, oppRating: number) => Promise<{ uci: string; p: number }[]>;
  rating: number;
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export class Cancelled extends Error {
  constructor() {
    super('Analysis stopped');
  }
}

/** Evaluation of a finished position (mate or stalemate), or null if the game goes on. */
function terminalEval(key: string): number | null {
  const pos = posFromFen(keyToFen(key));
  if (pos.isCheckmate()) return pos.turn === 'white' ? -MATE : MATE;
  if (pos.isStalemate() || pos.isInsufficientMaterial()) return 0;
  return null;
}

/** The same position with the other side to move (the "null move"), or null if that is not a legal position. */
export function nullMoveKey(key: string): string | null {
  const pos = posFromFen(keyToFen(key));
  if (pos.isCheck()) return null;
  const parts = key.split(' ');
  return [parts[0], parts[1] === 'w' ? 'b' : 'w', parts[2], '-'].join(' ');
}

const lineScore = (l: EngineLine) => scoreCp(l);

export async function analyseGame(game: PlayedGame, opts: AnalyseOptions): Promise<GameAnalysis> {
  const line = gameLine(game.moves);
  const keys = [START_KEY, ...line.map((m) => m.to)];
  const n = line.length;
  const side: Side = game.myColor;
  const check = () => {
    if (opts.isCancelled?.()) throw new Cancelled();
  };

  const evals: (number | null | undefined)[] = [...(game.lichessEvals ?? [])].slice(0, keys.length);
  const best: (string | null)[] = [...(game.lichessBest ?? [])].slice(0, n);
  const missing = keys.map((_, i) => i).filter((i) => evals[i] === undefined || evals[i] === null);
  const fromLichess = missing.length < keys.length / 2;
  const total = missing.length + 2 * 10;
  let done = 0;
  const tick = () => opts.onProgress?.(++done, total);

  // 1. Quick pass.
  for (const i of missing) {
    check();
    const end = terminalEval(keys[i]);
    if (end !== null) evals[i] = end;
    else {
      const [l] = await opts.engine.analyse(keyToFen(keys[i]), QUICK);
      if (!l) throw new Cancelled();
      evals[i] = lineScore(l);
      if (i < n && best[i] == null) best[i] = l.pv[0] ?? null;
    }
    tick();
  }
  const ev = evals as number[];

  // 2. A deeper look at your worst moves (a slightly lower bar, as the deeper look may find more).
  const deep = new Map<number, { lines: EngineLine[]; after?: EngineLine }>();
  for (const ply of candidateMoments(ev, side, 6, 10)) {
    check();
    const lines = (await opts.engine.analyse(keyToFen(keys[ply]), DEEP)).filter(Boolean);
    if (!lines.length) throw new Cancelled();
    ev[ply] = lineScore(lines[0]);
    best[ply] = lines[0].pv[0] ?? best[ply];
    tick();
    check();
    let after: EngineLine | undefined;
    const end = terminalEval(keys[ply + 1]);
    if (end !== null) ev[ply + 1] = end;
    else {
      [after] = await opts.engine.analyse(keyToFen(keys[ply + 1]), { depth: DEEP.depth, movetime: DEEP.movetime });
      if (!after) throw new Cancelled();
      ev[ply + 1] = lineScore(after);
      if (ply + 1 < n) best[ply + 1] = after.pv[0] ?? best[ply + 1];
    }
    tick();
    deep.set(ply, { lines, after });
  }

  // 3. The moments, with what was good, the opponent's answer and a missed threat.
  const moments: KeyMoment[] = [];
  for (const [ply, { lines, after }] of [...deep].sort((a, b) => a[0] - b[0])) {
    if (!isMoment(ev, ply)) continue;
    const loss = lossAt(ev, ply);
    const key = keys[ply];
    const top = winFor(ev[ply], side);
    const good = lines.filter((l) => winFor(lineScore(l), side) >= top - GOOD_ENOUGH);
    const bestLine = pvToSan(key, lines[0].pv, 8);
    const moment: KeyMoment = {
      ply,
      kind: momentKind(ev, ply),
      loss: Math.round(loss * 10) / 10,
      best: good.map((l) => pvToSan(key, l.pv, 1).san[0]).filter(Boolean),
      line: bestLine.san,
      bestEval: ev[ply],
      playedEval: ev[ply + 1],
    };
    if (after?.pv.length) moment.reply = pvToSan(keys[ply + 1], after.pv, 6).san;

    const nullKey = nullMoveKey(key);
    if (nullKey && after?.pv[0]) {
      check();
      const [threat] = await opts.engine.analyse(keyToFen(nullKey), THREAT);
      if (threat?.pv[0] && threat.pv[0] === after.pv[0] && winFor(lineScore(threat), side) <= top - 10) {
        moment.threat = pvToSan(nullKey, threat.pv, 4).san;
      }
    }

    if (opts.maia) {
      check();
      const opp = clampRating(opponentOf(game).elo ?? opts.rating);
      const moves = await opts.maia(key, opts.rating, opp);
      const goodUci = new Set(good.map((l) => l.pv[0]));
      const share = (pred: (uci: string) => boolean) => moves.filter((m) => pred(m.uci)).reduce((a, m) => a + m.p, 0);
      moment.maia = { best: round3(share((u) => goodUci.has(u))), played: round3(share((u) => u === line[ply].uci)) };
    }
    moments.push(moment);
  }
  opts.onProgress?.(total, total);

  return {
    version: ANALYSIS_VERSION,
    evals: ev,
    best: best.slice(0, n).map((b) => b ?? null),
    from: fromLichess ? 'lichess' : 'local',
    depth: fromLichess ? 0 : QUICK.depth,
    moments,
    ...(opts.maia ? { maiaRating: opts.rating } : {}),
    analysedAt: Date.now(),
  };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function clampRating(r: number): number {
  return Math.max(MAIA_MIN, Math.min(MAIA_MAX, Math.round(r)));
}

/** The rating Maia should play as: yours in that game, or your profile rating. */
export function ratingFor(game: PlayedGame, fallback: number): number {
  return clampRating(myElo(game) ?? fallback);
}

export function needsAnalysis(g: PlayedGame): boolean {
  const a = g.analysis;
  return !a || a.version < ANALYSIS_VERSION || a.moments === undefined || a.evals.length < g.moves.length + 1;
}

/** Analysed before Maia was downloaded: the moments can still be rated for learnability. */
export function needsMaia(g: PlayedGame): boolean {
  return !!g.analysis && !needsAnalysis(g) && g.analysis.maiaRating === undefined && g.analysis.moments.length > 0;
}

/** Adds Maia's verdict to an analysed game's moments. */
export async function addMaia(game: PlayedGame, rating: number, maia: NonNullable<AnalyseOptions['maia']>): Promise<GameAnalysis> {
  const a = game.analysis!;
  const line = gameLine(game.moves);
  const keys = [START_KEY, ...line.map((m) => m.to)];
  const opp = clampRating(opponentOf(game).elo ?? rating);
  const moments: KeyMoment[] = [];
  for (const m of a.moments) {
    const moves = await maia(keys[m.ply], rating, opp);
    const good = new Set(m.best.map((san) => sanToUci(keys[m.ply], san)).filter(Boolean));
    const share = (pred: (uci: string) => boolean) => moves.filter((x) => pred(x.uci)).reduce((s, x) => s + x.p, 0);
    moments.push({ ...m, maia: { best: round3(share((u) => good.has(u))), played: round3(share((u) => u === line[m.ply].uci)) } });
  }
  return { ...a, moments, maiaRating: rating };
}

// ---------------------------------------------------------------------------
// The queue: analyses every game that needs it, one at a time, while the app is open.

interface QueueState {
  running: boolean;
  /** Paused by you. */
  paused: boolean;
  /** Waiting while something else needs the computer (a practice game). */
  held: boolean;
  current: string | null;
  progress: number; // 0..1 of the current game
  error: string | null;
}

export const useAnalysisQueue = create<QueueState>()(() => ({ running: false, paused: false, held: false, current: null, progress: 0, error: null }));

export interface QueueHooks {
  /** The next game to analyse (and whether only Maia's verdict is missing), or null when all is done.
   *  Games that only miss Maia's verdict count only when Maia is available. */
  next(maiaAvailable: boolean): { game: PlayedGame; maiaOnly: boolean } | null;
  save(id: string, analysis: GameAnalysis): void;
  rating(game: PlayedGame): number;
}

let hooks: QueueHooks | null = null;
let engine: StockfishEngine | null = null;
let loop: Promise<void> | null = null;
let stopCurrent = false;

export function configureQueue(h: QueueHooks) {
  hooks = h;
}

async function maiaMoves(key: string, rating: number, opp: number) {
  const r = await maiaPredict(key, rating, opp);
  return r.moves.map((m) => ({ uci: m.uci, p: m.p }));
}

/** Starts working through the queue (no-op when already running or paused). */
const halted = () => {
  const s = useAnalysisQueue.getState();
  return s.paused || s.held;
};

export function kickQueue() {
  if (loop || !hooks || halted()) return;
  loop = (async () => {
    useAnalysisQueue.setState({ running: true, error: null });
    try {
      for (;;) {
        if (halted()) break;
        const withMaia = await isMaiaDownloaded().catch(() => false);
        const job = hooks!.next(withMaia);
        if (!job) break;
        const { game, maiaOnly } = job;
        stopCurrent = false;
        useAnalysisQueue.setState({ current: game.id, progress: 0 });
        const rating = hooks!.rating(game);
        const maia = withMaia && (await loadMaia().then(() => true, () => false)) ? maiaMoves : undefined;
        try {
          if (maiaOnly) {
            if (!maia) break;
            hooks!.save(game.id, await addMaia(game, rating, maia));
          } else {
            engine ??= new StockfishEngine(32);
            (engine as StockfishEngine).newGame();
            const analysis = await analyseGame(game, {
              engine,
              maia,
              rating,
              onProgress: (d, t) => useAnalysisQueue.setState({ progress: d / t }),
              isCancelled: () => stopCurrent || halted(),
            });
            hooks!.save(game.id, analysis);
          }
        } catch (e) {
          if (e instanceof Cancelled) {
            if (stopCurrent && !halted()) continue; // skipped: on to the next game
            break;
          }
          useAnalysisQueue.setState({ error: `Could not analyse a game: ${(e as Error).message}` });
          break;
        }
      }
    } finally {
      engine?.terminate(); // frees the engine's memory until there is work again
      engine = null;
      loop = null;
      useAnalysisQueue.setState({ running: false, current: null, progress: 0 });
    }
  })();
}

export function pauseQueue(paused: boolean) {
  useAnalysisQueue.setState({ paused });
  if (paused) engine?.stop();
  else kickQueue();
}

/** Called when the queue state changed from outside (e.g. held): stops the search or resumes. */
export function queueStateChanged() {
  if (halted()) engine?.stop();
  else kickQueue();
}

/** Stops the game being analysed (e.g. it was deleted); the queue carries on with the next one. */
export function skipCurrent() {
  stopCurrent = true;
  engine?.stop();
}

// Local Stockfish 19 (lite, single-threaded WASM) in a Web Worker, spoken to over UCI.
// Used when the Lichess cloud has no evaluation for a position.

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Centipawns from White's point of view. */
  cp?: number;
  /** Mate in N from White's point of view (negative: Black mates). */
  mate?: number;
  pv: string[]; // UCI (castling as e1g1)
}

export interface EngineOptions {
  multiPv?: number;
  depth?: number;
  movetime?: number;
}

interface Job {
  fen: string;
  opts: EngineOptions;
  onInfo?: (lines: EngineLine[]) => void;
  resolve: (lines: EngineLine[]) => void;
  lines: EngineLine[];
}

class StockfishEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private current: Job | null = null;
  private pending: Job | null = null;
  private searching = false;

  private boot(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const url = new URL(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`, location.href);
      const worker = new Worker(url);
      this.worker = worker;
      const onBoot = (e: MessageEvent) => {
        if (String(e.data) === 'readyok') {
          worker.removeEventListener('message', onBoot);
          worker.addEventListener('message', (ev) => this.onLine(String(ev.data)));
          resolve();
        }
      };
      worker.addEventListener('message', onBoot);
      worker.addEventListener('error', (e) => reject(new Error(`Stockfish failed to load: ${e.message}`)));
      worker.postMessage('uci');
      worker.postMessage('setoption name Hash value 64');
      worker.postMessage('isready');
    });
    return this.ready;
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private onLine(line: string) {
    const job = this.current;
    if (line.startsWith('bestmove')) {
      this.searching = false;
      if (job) job.resolve(job.lines.filter(Boolean));
      this.current = null;
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.run(next);
      }
      return;
    }
    if (!job || !line.startsWith('info') || !line.includes(' pv ')) return;
    const tokens = line.split(' ');
    const val = (name: string) => {
      const i = tokens.indexOf(name);
      return i >= 0 ? tokens[i + 1] : undefined;
    };
    const depth = Number(val('depth'));
    const multipv = Number(val('multipv') ?? 1);
    const scoreIdx = tokens.indexOf('score');
    if (scoreIdx < 0) return;
    const kind = tokens[scoreIdx + 1];
    const raw = Number(tokens[scoreIdx + 2]);
    const flip = job.fen.split(' ')[1] === 'b' ? -1 : 1;
    const pv = tokens.slice(tokens.indexOf('pv') + 1);
    const entry: EngineLine = { multipv, depth, pv };
    if (kind === 'cp') entry.cp = raw * flip;
    else entry.mate = raw * flip;
    job.lines[multipv - 1] = entry;
    // Only report once all lines of this depth are in, to avoid flicker.
    if (multipv === (job.opts.multiPv ?? 1) || job.lines.filter(Boolean).length === 1) job.onInfo?.(job.lines.filter(Boolean));
  }

  private run(job: Job) {
    this.current = job;
    this.searching = true;
    this.send(`setoption name MultiPV value ${job.opts.multiPv ?? 1}`);
    this.send(`position fen ${job.fen}`);
    if (job.opts.movetime) this.send(`go movetime ${job.opts.movetime}`);
    else if (job.opts.depth) this.send(`go depth ${job.opts.depth}`);
    else this.send('go infinite');
  }

  async analyse(fen: string, opts: EngineOptions, onInfo?: (lines: EngineLine[]) => void): Promise<EngineLine[]> {
    await this.boot();
    return new Promise((resolve) => {
      const job: Job = { fen, opts, onInfo, resolve, lines: [] };
      if (this.searching) {
        // Replace whatever was queued; the superseded job resolves with nothing.
        this.pending?.resolve([]);
        this.pending = job;
        this.send('stop');
      } else this.run(job);
    });
  }

  stop() {
    this.pending?.resolve([]);
    this.pending = null;
    if (this.searching) this.send('stop');
  }
}

export const engine = new StockfishEngine();

export function formatScore(line: { cp?: number; mate?: number } | undefined | null): string {
  if (!line) return '–';
  if (line.mate !== undefined) return `#${line.mate}`;
  if (line.cp === undefined) return '–';
  const v = line.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

/** Maps an evaluation to 0..1 (share of the bar that is White), like the Lichess eval bar. */
export function whiteShare(line: { cp?: number; mate?: number } | undefined | null): number {
  if (!line) return 0.5;
  if (line.mate !== undefined) return line.mate > 0 ? 1 : 0;
  const cp = Math.max(-1000, Math.min(1000, line.cp ?? 0));
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

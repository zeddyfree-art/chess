// One evaluation API for the UI and the audit: Lichess cloud first (deep, instant),
// local Stockfish as fallback.
import { keyToFen, playUci } from './chess';
import { engine, type EngineLine } from './engine';
import { fetchCloudEval } from './lichess';

export interface EvalLine {
  cp?: number; // White's point of view
  mate?: number;
  uci: string[]; // principal variation
  san: string[];
}

export interface Evaluation {
  source: 'cloud' | 'local';
  depth: number;
  lines: EvalLine[];
}

export function pvToSan(key: string, ucis: string[], max = 10): { uci: string[]; san: string[] } {
  const san: string[] = [];
  const uci: string[] = [];
  let cur = key;
  for (const u of ucis.slice(0, max)) {
    const m = playUci(cur, u);
    if (!m) break;
    san.push(m.san);
    uci.push(m.uci);
    cur = m.to;
  }
  return { uci, san };
}

function fromEngine(key: string, lines: EngineLine[], depth: number): Evaluation {
  return {
    source: 'local',
    depth,
    lines: lines.map((l) => ({ cp: l.cp, mate: l.mate, ...pvToSan(key, l.pv) })),
  };
}

export async function cloudEvaluation(key: string, multiPv: number): Promise<Evaluation | null> {
  const cloud = await fetchCloudEval(keyToFen(key), multiPv).catch(() => null);
  if (!cloud || !cloud.pvs?.length) return null;
  return {
    source: 'cloud',
    depth: cloud.depth,
    lines: cloud.pvs.map((pv) => ({ cp: pv.cp, mate: pv.mate, ...pvToSan(key, pv.moves.split(' ')) })),
  };
}

export async function evaluate(
  key: string,
  opts: { multiPv: number; localDepth: number; onLocalInfo?: (e: Evaluation) => void },
): Promise<Evaluation> {
  const cloud = await cloudEvaluation(key, opts.multiPv);
  if (cloud) return cloud;
  const lines = await engine.analyse(keyToFen(key), { multiPv: opts.multiPv, depth: opts.localDepth }, (ls) =>
    opts.onLocalInfo?.(fromEngine(key, ls, ls[0]?.depth ?? 0)),
  );
  return fromEngine(key, lines, lines[0]?.depth ?? opts.localDepth);
}

/** Collapses mate scores onto the centipawn scale so we can subtract evaluations. */
export function scoreCp(l: { cp?: number; mate?: number }): number {
  if (l.mate !== undefined) return Math.sign(l.mate) * (10000 - Math.abs(l.mate) * 10);
  return l.cp ?? 0;
}

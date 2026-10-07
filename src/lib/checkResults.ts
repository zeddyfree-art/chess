// The last gap search and engine check of each repertoire, kept with the data (and synced) so you can work through
// them one by one, on any device, and see what you have already dealt with and whether the repertoire changed since.
import { createStore, del as idbDel, get as idbGet, keys as idbKeys } from 'idb-keyval';
import type { EngineIssue, Gap, GapReport, LineEnd } from './audit';
import { isMine, movesAt, type Repertoire } from './repertoire';

export interface SavedGaps {
  report: GapReport;
  at: number;
  minReach: number;
  /** Fingerprints of what the search depended on, to tell whether the repertoire or the filters changed since. */
  repHash?: string;
  filters?: string;
}

export interface SavedEngine {
  issues: EngineIssue[];
  at: number;
  threshold: number;
  repHash?: string;
  depth?: number;
  /** Moves evaluated in that run, and moves whose earlier evaluation was kept. */
  evaluated?: number;
  reused?: number;
}

export interface CheckResults {
  gaps?: SavedGaps;
  engine?: SavedEngine;
}

// ---------------------------------------------------------------------------
// Fingerprints

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

const edgeHashes = new WeakMap<Repertoire['positions'], { all: string; mine: string }>();

/** The moves of a repertoire as a short fingerprint: all of them (what the gap search walks), and yours only (what the
 *  engine check rates). Comments, drawings and training progress do not count. */
export function repFingerprint(rep: Repertoire): { all: string; mine: string } {
  let fp = edgeHashes.get(rep.positions);
  if (!fp) {
    const all: string[] = [];
    const mine: string[] = [];
    for (const [key, moves] of Object.entries(rep.positions))
      for (const m of moves) {
        const e = `${key}>${m.uci}`;
        all.push(e);
        if (isMine(rep, key)) mine.push(e);
      }
    fp = { all: hash(all.sort().join(';')), mine: hash(mine.sort().join(';')) };
    edgeHashes.set(rep.positions, fp);
  }
  return fp;
}

export const gapFilters = (o: { ratings: number[]; speeds: string[]; maxPly: number }) =>
  `${[...o.ratings].sort((a, b) => a - b)}|${[...o.speeds].sort()}|${o.maxPly}`;

/** Whether the saved results still describe this repertoire: what changed since, or 'unknown' for results saved before
 *  the app kept track. */
export function gapsChanged(rep: Repertoire, saved: SavedGaps, filters: string): 'repertoire' | 'filters' | 'unknown' | null {
  if (saved.repHash === undefined) return 'unknown';
  if (saved.repHash !== repFingerprint(rep).all) return 'repertoire';
  if (saved.filters !== undefined && saved.filters !== filters) return 'filters';
  return null;
}

export function engineChanged(rep: Repertoire, saved: SavedEngine): 'repertoire' | 'unknown' | null {
  if (saved.repHash === undefined) return 'unknown';
  return saved.repHash !== repFingerprint(rep).mine ? 'repertoire' : null;
}

/** At most this many early line ends are kept: the page shows the first 15. */
const KEEP_ENDS = 30;

export function savedGaps(rep: Repertoire, report: GapReport, minReach: number, filters: string): SavedGaps {
  return { report: { ...report, lineEnds: report.lineEnds.slice(0, KEEP_ENDS) }, at: Date.now(), minReach, repHash: repFingerprint(rep).all, filters };
}

export function savedEngine(rep: Repertoire, issues: EngineIssue[], threshold: number, depth: number): SavedEngine {
  return { issues, at: Date.now(), threshold, repHash: repFingerprint(rep).mine, depth };
}

// ---------------------------------------------------------------------------
// Syncing: per repertoire and per check, the newest wins.

const newest = <T extends { at: number }>(a?: T, b?: T) => (!a ? b : !b ? a : b.at > a.at ? b : a);

export function mergeChecks(
  local: Record<string, CheckResults> | undefined,
  remote: Record<string, CheckResults> | undefined,
  repIds: Set<string>,
): Record<string, CheckResults> {
  const a = local ?? {};
  const b = remote ?? {};
  const out: Record<string, CheckResults> = {};
  let same = true;
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!repIds.has(id)) {
      if (a[id]) same = false;
      continue;
    }
    const x = a[id] ?? {};
    const y = b[id] ?? {};
    const gaps = newest(x.gaps, y.gaps);
    const engine = newest(x.engine, y.engine);
    if (a[id] && gaps === x.gaps && engine === x.engine) out[id] = a[id];
    else {
      out[id] = { ...(gaps ? { gaps } : {}), ...(engine ? { engine } : {}) };
      same = false;
    }
  }
  // Unchanged: the same object, so nothing counts as edited.
  return same && local ? local : out;
}

// ---------------------------------------------------------------------------
// The version before syncing kept results in this device's database only: taken over once.

const idb = typeof indexedDB !== 'undefined' ? createStore('repertoire-data', 'app') : undefined;

export async function takeOverDeviceResults(): Promise<Record<string, CheckResults>> {
  if (!idb) return {};
  const out: Record<string, CheckResults> = {};
  for (const k of await idbKeys(idb))
    if (typeof k === 'string' && k.startsWith('check-')) {
      const saved = (await idbGet(k, idb)) as CheckResults | undefined;
      if (saved) out[k.slice('check-'.length)] = saved;
      await idbDel(k, idb);
    }
  return out;
}

// ---------------------------------------------------------------------------
// What has been done since the check

export interface ItemStatus {
  state: 'open' | 'partial' | 'done';
  note: string;
}

const open: ItemStatus = { state: 'open', note: '' };

/** A missing reply: done when the repertoire has the reply and your answer to it. */
export function gapStatus(rep: Repertoire, g: Pick<Gap, 'key' | 'san'>): ItemStatus {
  const reply = movesAt(rep, g.key).find((m) => m.san === g.san);
  if (!reply) return open;
  return movesAt(rep, reply.to).length ? { state: 'done', note: 'prepared' } : { state: 'partial', note: 'reply added, your answer is still missing' };
}

/** A line that ended early: done when the repertoire goes on from there. */
export function lineEndStatus(rep: Repertoire, e: Pick<LineEnd, 'key'>): ItemStatus {
  return movesAt(rep, e.key).length ? { state: 'done', note: 'extended' } : open;
}

/** A dubious move: done when it was replaced, the engine's move was added, or a new check finds it fine. */
export function engineStatus(rep: Repertoire, it: Pick<EngineIssue, 'key' | 'san' | 'id' | 'flag'>, threshold: number): ItemStatus {
  const moves = movesAt(rep, it.key);
  if (!moves.some((m) => m.san === it.san)) return { state: 'done', note: 'move changed' };
  if (it.flag.bestSan && moves.some((m) => m.san === it.flag.bestSan)) return { state: 'done', note: `${it.flag.bestSan} added` };
  const flag = rep.engine[it.id];
  if (flag && flag.at > it.flag.at && flag.loss < threshold) return { state: 'done', note: 'fine after a new check' };
  return open;
}

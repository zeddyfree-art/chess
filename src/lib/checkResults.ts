// The last gap search and engine check of each repertoire, kept on this device so you can work through them one by
// one (open a position in Build, come back) and see what you have already dealt with.
import { create } from 'zustand';
import { createStore, del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';
import type { EngineIssue, Gap, GapReport, LineEnd } from './audit';
import { movesAt, type Repertoire } from './repertoire';

export interface SavedGaps {
  report: GapReport;
  at: number;
  minReach: number;
}

export interface SavedEngine {
  issues: EngineIssue[];
  at: number;
  threshold: number;
}

export interface CheckResults {
  gaps?: SavedGaps;
  engine?: SavedEngine;
}

const idb = typeof indexedDB !== 'undefined' ? createStore('repertoire-data', 'app') : undefined;
const keyOf = (repId: string) => `check-${repId}`;

export const useCheckResults = create<{ byRep: Record<string, CheckResults> }>()(() => ({ byRep: {} }));

const loading = new Set<string>();

/** Loads a repertoire's saved results (once). */
export function loadCheckResults(repId: string) {
  if (loading.has(repId) || !idb) return;
  loading.add(repId);
  idbGet(keyOf(repId), idb)
    .then((saved) => {
      if (saved) useCheckResults.setState((s) => ({ byRep: { [repId]: { ...(saved as CheckResults), ...s.byRep[repId] }, ...withoutRep(s.byRep, repId) } }));
    })
    .catch(() => {});
}

const withoutRep = (all: Record<string, CheckResults>, repId: string) => {
  const { [repId]: _gone, ...rest } = all;
  return rest;
};

export function saveCheckResults(repId: string, patch: CheckResults) {
  const next = { ...useCheckResults.getState().byRep[repId], ...patch };
  useCheckResults.setState((s) => ({ byRep: { ...s.byRep, [repId]: next } }));
  if (idb) void idbSet(keyOf(repId), next, idb).catch(() => {});
}

/** Forgets the results of repertoires that no longer exist (deleted here or on another device). */
export async function pruneCheckResults(repIds: string[]) {
  if (!idb || !repIds.length) return;
  const keep = new Set(repIds.map(keyOf));
  for (const k of await idbKeys(idb)) if (typeof k === 'string' && k.startsWith('check-') && !keep.has(k)) await idbDel(k, idb);
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

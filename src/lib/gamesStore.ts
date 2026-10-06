// Your imported games: kept in the browser (IndexedDB) next to the app data, and synced to their own file in
// Google Drive (see sync.ts), so the repertoire file stays small and quick to sync.
import { create } from 'zustand';
import { createStore, get as idbGet, set as idbSet } from 'idb-keyval';
import { configureQueue, kickQueue, needsAnalysis, needsMaia, queueStateChanged, ratingFor, skipCurrent, useAnalysisQueue } from './analyzer';
import type { GameAnalysis } from './analysis';
import { EMPTY_GAMES, type GamesData, type PlayedGame } from './games';
import { profileRating, useApp } from './store';
import { initWakeLock } from './wakeLock';

interface GamesState {
  loaded: boolean;
  data: GamesData;
  /** Adds games that are not there yet. Returns how many were new. */
  addGames(games: PlayedGame[]): { added: number; already: number };
  updateGame(id: string, fn: (g: PlayedGame) => PlayedGame): void;
  deleteGames(ids: string[]): void;
  /** Puts deleted games back (undo). */
  restoreGames(games: PlayedGame[]): void;
  /** Takes over games merged with another device. */
  applyRemote(data: GamesData): void;
}

const idb = typeof indexedDB !== 'undefined' ? createStore('repertoire-data', 'app') : undefined;

export const useGames = create<GamesState>()((set, get) => ({
  loaded: false,
  data: EMPTY_GAMES,

  addGames: (incoming) => {
    const { data } = get();
    const have = new Set(data.games.map((g) => g.id));
    const fresh: PlayedGame[] = [];
    for (const g of incoming) if (!have.has(g.id) && !fresh.some((f) => f.id === g.id)) fresh.push(g);
    if (fresh.length) {
      const deleted = { ...data.deleted };
      for (const g of fresh) delete deleted[g.id]; // imported again on purpose
      set({ data: { ...data, games: [...fresh, ...data.games], deleted } });
      kickQueue();
    }
    return { added: fresh.length, already: incoming.length - fresh.length };
  },

  updateGame: (id, fn) =>
    set((s) => ({ data: { ...s.data, games: s.data.games.map((g) => (g.id === id ? { ...fn(g), updatedAt: Date.now() } : g)) } })),

  deleteGames: (ids) => {
    const gone = new Set(ids);
    if (gone.has(useAnalysisQueue.getState().current ?? '')) skipCurrent();
    const now = Date.now();
    set((s) => ({
      data: {
        ...s.data,
        games: s.data.games.filter((g) => !gone.has(g.id)),
        deleted: { ...s.data.deleted, ...Object.fromEntries(ids.map((id) => [id, now])) },
      },
    }));
  },

  restoreGames: (games) => {
    const { data } = get();
    const deleted = { ...data.deleted };
    for (const g of games) delete deleted[g.id];
    const have = new Set(data.games.map((g) => g.id));
    const back = games.filter((g) => !have.has(g.id)).map((g) => ({ ...g, updatedAt: Date.now() }));
    set({ data: { ...data, games: [...back, ...data.games].sort((a, b) => b.playedAt - a.playedAt), deleted } });
    kickQueue();
  },

  applyRemote: (data) => {
    set({ data });
    kickQueue();
  },
}));

export function gamesOf(data: GamesData, profileId: string | null): PlayedGame[] {
  return data.games.filter((g) => g.profileId === profileId).sort((a, b) => b.playedAt - a.playedAt);
}

// ---------------------------------------------------------------------------
// Merging with another device: every game once; for a game on both sides, the newer analysis and both sides'
// dismissed mistakes. Deleted games stay deleted unless imported again later.

export function mergeGames(local: GamesData, remote: GamesData): GamesData {
  const deleted = { ...local.deleted };
  for (const [id, t] of Object.entries(remote.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, t);
  const byId = new Map<string, PlayedGame>();
  for (const g of local.games) byId.set(g.id, g);
  for (const r of remote.games) {
    const l = byId.get(r.id);
    if (!l) byId.set(r.id, r);
    else if (l !== r) byId.set(r.id, mergeGame(l, r));
  }
  const games = [...byId.values()]
    .filter((g) => !(deleted[g.id] !== undefined && deleted[g.id] >= g.addedAt))
    .sort((a, b) => b.playedAt - a.playedAt);
  return { version: 1, games, deleted };
}

function newerAnalysis(a: GameAnalysis | undefined, b: GameAnalysis | undefined): GameAnalysis | undefined {
  if (!a || !b) return a ?? b;
  if (a.version !== b.version) return a.version > b.version ? a : b;
  if ((a.maiaRating !== undefined) !== (b.maiaRating !== undefined)) return a.maiaRating !== undefined ? a : b;
  return b.analysedAt > a.analysedAt ? b : a;
}

function mergeGame(l: PlayedGame, r: PlayedGame): PlayedGame {
  const base = r.updatedAt > l.updatedAt ? r : l;
  const dismissed = [...new Set([...(l.dismissed ?? []), ...(r.dismissed ?? [])])].sort((a, b) => a - b);
  const analysis = newerAnalysis(l.analysis, r.analysis);
  const merged: PlayedGame = { ...base, addedAt: Math.min(l.addedAt, r.addedAt), updatedAt: Math.max(l.updatedAt, r.updatedAt) };
  if (analysis) merged.analysis = analysis;
  if (dismissed.length) merged.dismissed = dismissed;
  return merged;
}

export function sameGames(a: GamesData, b: GamesData): boolean {
  if (a === b) return true;
  if (a.games.length !== b.games.length || JSON.stringify(a.deleted) !== JSON.stringify(b.deleted)) return false;
  const byId = new Map(b.games.map((g) => [g.id, g]));
  return a.games.every((g) => {
    const o = byId.get(g.id);
    return !!o && (o === g || JSON.stringify(o) === JSON.stringify(g));
  });
}

export function parseGamesFile(text: string): GamesData {
  const json = JSON.parse(text);
  if (json?.version !== 1 || !Array.isArray(json.games)) throw new Error('This is not a games file of this app.');
  return { version: 1, games: json.games, deleted: json.deleted ?? {} };
}

export function serializeGames(data: GamesData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Loading, saving and the analysis queue

let flusher: (() => Promise<void>) | null = null;

export function flushGames(): Promise<void> {
  return flusher?.() ?? Promise.resolve();
}

export async function loadGames() {
  let data: GamesData | undefined;
  if (idb) data = (await idbGet('games', idb).catch(() => undefined)) as GamesData | undefined;
  useGames.setState({ data: data ? { ...EMPTY_GAMES, ...data } : EMPTY_GAMES, loaded: true });

  let last = useGames.getState().data;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = async () => {
    clearTimeout(timer);
    if (!dirty || !idb) return;
    dirty = false;
    await idbSet('games', last, idb).catch((e) => {
      dirty = true;
      console.error('Saving games failed', e);
    });
  };
  flusher = write;
  useGames.subscribe((s) => {
    if (s.data === last) return;
    last = s.data;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void write(), 800);
  });
  addEventListener('pagehide', () => void write());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void write());

  // Games of a player who was deleted go too.
  useApp.subscribe((s, prev) => {
    if (s.data.profiles === prev.data.profiles) return;
    const ids = new Set(s.data.profiles.map((p) => p.id));
    const orphans = useGames.getState().data.games.filter((g) => !ids.has(g.profileId)).map((g) => g.id);
    if (orphans.length && s.data.profiles.length) useGames.getState().deleteGames(orphans);
  });

  configureQueue({
    next: (maiaAvailable) => {
      const games = useGames.getState().data.games;
      const active = useApp.getState().data.activeProfileId;
      const order = [...games].sort((a, b) => Number(b.profileId === active) - Number(a.profileId === active) || b.playedAt - a.playedAt);
      const full = order.find(needsAnalysis);
      if (full) return { game: full, maiaOnly: false };
      const maia = maiaAvailable ? order.find(needsMaia) : undefined;
      return maia ? { game: maia, maiaOnly: true } : null;
    },
    save: (id, analysis) => useGames.getState().updateGame(id, (g) => ({ ...g, analysis })),
    rating: (game) => {
      const profile = useApp.getState().data.profiles.find((p) => p.id === game.profileId);
      return ratingFor(game, profile ? profileRating(profile) : 1500);
    },
  });

  // Practice games need the computer's full attention (Maia); the analysis waits meanwhile.
  useApp.subscribe((s, prev) => {
    if (s.view === prev.view) return;
    holdQueue(s.view === 'play');
  });
  holdQueue(useApp.getState().view === 'play');
  initWakeLock();
  kickQueue();
}

let held = false;

function holdQueue(hold: boolean) {
  if (hold === held) return;
  held = hold;
  useAnalysisQueue.setState({ held: hold });
  queueStateChanged();
}

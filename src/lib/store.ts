// Global app state (zustand). Data lives in IndexedDB in the browser (and optionally
// syncs to Google Drive, see sync.ts). Every repertoire change goes through
// `updateRep` so it can be undone and so its `updatedAt` (last edit, not training) is bumped for syncing.
import { create } from 'zustand';
import { createStore, get as idbGet, set as idbSet } from 'idb-keyval';
import { playSan, type PlayedMove, type Side } from './chess';
import { findMove, findPath, newRepertoire, onlyCardsChanged, ROOT, type Repertoire } from './repertoire';
import { addCards, type MistakeCard } from './mistakes';
import { gradeCard, syncCards } from './srs';
import type { Grade } from 'ts-fsrs';

export interface Profile {
  id: string;
  name: string;
  color: string;
  /** Lichess rating groups of the opponents this player meets. */
  ratings: number[];
  speeds: string[];
  /** The player's own approximate rating (used for the human-like opponent). */
  rating?: number;
  /** Lichess username, to fetch the player's own games. */
  lichess?: string;
  /** Names the player uses in PGN files of their games (other sites, over-the-board), to tell their colour. */
  aliases?: string[];
  updatedAt?: number;
}

export interface AppData {
  version: 1;
  profiles: Profile[];
  repertoires: Repertoire[];
  /** Device-local selection; never taken over from another device when syncing. */
  activeProfileId: string | null;
  activeRepId: string | null;
  lastBackupAt: number | null;
  /** Deletion tombstones (profile, repertoire or mistake card id → time), so deletions survive syncing. */
  deleted?: Record<string, number>;
  /** Training cards made from mistakes in your own games (all players). Absent in older data. */
  mistakes?: MistakeCard[];
}

export type View = 'home' | 'build' | 'tree' | 'train' | 'play' | 'audit' | 'games' | 'settings' | 'about';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface UndoEntry {
  repId: string;
  before: Repertoire;
  label: string;
  /** Edits with the same key in a row share one undo step (e.g. several arrows drawn on one position). */
  coalesce?: string;
  at?: number;
}

export interface AppState {
  loaded: boolean;
  data: AppData;
  view: View;
  /** Explored line on the build board, and how far into it we are. */
  line: PlayedMove[];
  ply: number;
  /** When set, training is limited to the branch starting at this position. */
  trainScope: string | null;
  /** Moves leading to the position a practice game starts from. */
  playStart: PlayedMove[];
  /** The colour to play from there and where the position comes from (from a game review). */
  playSetup: { color?: Side; label?: string; level?: number } | null;
  /** The game open in the Games tab (null: the list). */
  openGameId: string | null;
  /** Which deck the Train tab shows. */
  trainDeck: 'repertoire' | 'mistakes';
  undo: UndoEntry[];
  redo: UndoEntry[];
  toast: Toast | null;

  setView(view: View): void;
  setActiveProfile(id: string): void;
  setActiveRep(id: string | null): void;
  addProfile(p: Omit<Profile, 'id'>): Profile;
  updateProfile(id: string, patch: Partial<Profile>): void;
  deleteProfile(id: string): void;
  createRepertoire(name: string, side: Side): Repertoire;
  addRepertoire(rep: Repertoire): void;
  deleteRepertoire(id: string): void;
  /** Undoes a deletion: puts the repertoire back and lifts its deletion mark so sync keeps it. */
  restoreRepertoire(rep: Repertoire): void;
  renameRepertoire(id: string, name: string): void;
  updateRep(repId: string, fn: (rep: Repertoire) => Repertoire, label: string, opts?: { undoable?: boolean; coalesce?: string }): void;
  undoLast(): void;
  redoLast(): void;
  replaceData(data: AppData): void;
  /** Takes over data merged from another device without touching navigation state. */
  applyRemote(data: AppData): void;
  markBackup(): void;

  playMove(move: PlayedMove): void;
  setPly(ply: number): void;
  resetLine(): void;
  openLine(line: PlayedMove[]): void;
  goToKey(key: string): void;
  goToSans(sans: string[]): void;
  trainFrom(key: string | null): void;
  playFrom(line: PlayedMove[], setup?: { color?: Side; label?: string; level?: number }): void;
  openGame(id: string | null): void;
  setTrainDeck(deck: 'repertoire' | 'mistakes'): void;
  addMistakes(cards: MistakeCard[]): number;
  deleteMistakes(ids: string[]): void;
  restoreMistakes(cards: MistakeCard[]): void;
  gradeMistake(id: string, grade: Grade): number;
  showToast(message: string, action?: Toast['action']): void;
  hideToast(): void;
}

export const EMPTY_DATA: AppData = {
  version: 1,
  profiles: [],
  repertoires: [],
  activeProfileId: null,
  activeRepId: null,
  lastBackupAt: null,
  deleted: {},
};

export const PROFILE_COLORS = ['#2f7dd1', '#d1542f', '#2fa56b', '#a24fd1', '#d1a02f', '#d12f7d'];

const dataStore = typeof indexedDB !== 'undefined' ? createStore('repertoire-data', 'app') : undefined;

let toastSeq = 0;

/** Keeps the active profile/repertoire pointing at something that exists. */
function fixSelection(data: AppData): AppData {
  const activeProfileId = data.profiles.some((p) => p.id === data.activeProfileId)
    ? data.activeProfileId
    : (data.profiles[0]?.id ?? null);
  const activeRepId = data.repertoires.some((r) => r.id === data.activeRepId && r.profileId === activeProfileId)
    ? data.activeRepId
    : (data.repertoires.find((r) => r.profileId === activeProfileId)?.id ?? null);
  return activeProfileId === data.activeProfileId && activeRepId === data.activeRepId
    ? data
    : { ...data, activeProfileId, activeRepId };
}

export const useApp = create<AppState>()((set, get) => {
  const patchData = (patch: Partial<AppData>) => set((s) => ({ data: { ...s.data, ...patch } }));
  const mapRep = (id: string, fn: (r: Repertoire) => Repertoire) =>
    set((s) => ({ data: { ...s.data, repertoires: s.data.repertoires.map((r) => (r.id === id ? fn(r) : r)) } }));
  const tombstone = (ids: string[]) => {
    const now = Date.now();
    return { ...(get().data.deleted ?? {}), ...Object.fromEntries(ids.map((id) => [id, now])) };
  };

  return {
    loaded: false,
    data: EMPTY_DATA,
    view: 'home',
    line: [],
    ply: 0,
    trainScope: null,
    playStart: [],
    playSetup: null,
    openGameId: null,
    trainDeck: 'repertoire',
    undo: [],
    redo: [],
    toast: null,

    setView: (view) => set({ view }),

    setActiveProfile: (id) => {
      const reps = get().data.repertoires.filter((r) => r.profileId === id);
      patchData({ activeProfileId: id, activeRepId: reps[0]?.id ?? null });
      set({ line: [], ply: 0, view: 'home', trainScope: null });
    },

    setActiveRep: (id) => {
      patchData({ activeRepId: id });
      set({ line: [], ply: 0, trainScope: null });
    },

    addProfile: (p) => {
      const profile = { ...p, id: crypto.randomUUID(), updatedAt: Date.now() };
      const { data } = get();
      patchData({ profiles: [...data.profiles, profile], activeProfileId: data.activeProfileId ?? profile.id });
      return profile;
    },

    updateProfile: (id, patch) =>
      patchData({ profiles: get().data.profiles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) }),

    deleteProfile: (id) => {
      const { data } = get();
      const gone = data.repertoires.filter((r) => r.profileId === id).map((r) => r.id);
      set({
        data: fixSelection({
          ...data,
          profiles: data.profiles.filter((p) => p.id !== id),
          repertoires: data.repertoires.filter((r) => r.profileId !== id),
          mistakes: (data.mistakes ?? []).filter((m) => m.profileId !== id),
          deleted: tombstone([id, ...gone]),
        }),
      });
    },

    createRepertoire: (name, side) => {
      const profileId = get().data.activeProfileId!;
      const rep = newRepertoire(profileId, name, side);
      get().addRepertoire(rep);
      return rep;
    },

    addRepertoire: (rep) => {
      patchData({ repertoires: [...get().data.repertoires, syncCards(rep)], activeRepId: rep.id });
      set({ line: [], ply: 0, trainScope: null });
    },

    deleteRepertoire: (id) => {
      const { data } = get();
      set({
        data: fixSelection({ ...data, repertoires: data.repertoires.filter((r) => r.id !== id), deleted: tombstone([id]) }),
      });
    },

    restoreRepertoire: (rep) => {
      const { data } = get();
      if (data.repertoires.some((r) => r.id === rep.id) || !data.profiles.some((p) => p.id === rep.profileId)) return;
      const deleted = { ...(data.deleted ?? {}) };
      delete deleted[rep.id];
      // Newer than any deletion mark that already reached another device, so the restored copy wins.
      const restored = { ...rep, updatedAt: Date.now() + 1 };
      set({
        data: fixSelection({ ...data, repertoires: [...data.repertoires, restored], deleted, activeProfileId: rep.profileId, activeRepId: rep.id }),
        line: [],
        ply: 0,
        trainScope: null,
      });
    },

    renameRepertoire: (id, name) => mapRep(id, (r) => ({ ...r, name, updatedAt: Date.now() })),

    updateRep: (repId, fn, label, opts) => {
      const before = get().data.repertoires.find((r) => r.id === repId);
      if (!before) return;
      const changed = syncCards(fn(before));
      if (changed === before) return;
      const after = { ...changed, updatedAt: onlyCardsChanged(before, changed) ? before.updatedAt : Date.now() };
      mapRep(repId, () => after);
      if (opts?.undoable === false) return;
      set((s) => {
        const top = s.undo.at(-1);
        const now = Date.now();
        const join = !!opts?.coalesce && top?.repId === repId && top.coalesce === opts.coalesce && now - (top.at ?? 0) < 8000;
        if (join && top) return { undo: [...s.undo.slice(0, -1), { ...top, at: now }], redo: [] };
        return { undo: [...s.undo.slice(-49), { repId, before, label, coalesce: opts?.coalesce, at: now }], redo: [] };
      });
    },

    undoLast: () => {
      const entry = get().undo.at(-1);
      if (!entry) return;
      const current = get().data.repertoires.find((r) => r.id === entry.repId);
      if (!current) return;
      mapRep(entry.repId, () => ({ ...entry.before, updatedAt: Date.now() }));
      set((s) => ({ undo: s.undo.slice(0, -1), redo: [...s.redo, { ...entry, before: current }] }));
      get().showToast(`Undone: ${entry.label}`);
    },

    redoLast: () => {
      const entry = get().redo.at(-1);
      if (!entry) return;
      const current = get().data.repertoires.find((r) => r.id === entry.repId);
      if (!current) return;
      mapRep(entry.repId, () => ({ ...entry.before, updatedAt: Date.now() }));
      set((s) => ({ redo: s.redo.slice(0, -1), undo: [...s.undo, { ...entry, before: current }] }));
      get().showToast(`Redone: ${entry.label}`);
    },

    replaceData: (incoming) => {
      // A restore is a deliberate "this is the truth": everything restored counts as
      // edited now, and whatever it does not contain counts as deleted.
      const now = Date.now();
      const current = get().data;
      const keep = new Set([...incoming.profiles.map((p) => p.id), ...incoming.repertoires.map((r) => r.id), ...(incoming.mistakes ?? []).map((m) => m.id)]);
      const removed = [...current.profiles.map((p) => p.id), ...current.repertoires.map((r) => r.id), ...(current.mistakes ?? []).map((m) => m.id)].filter(
        (id) => !keep.has(id),
      );
      const deleted = { ...(incoming.deleted ?? {}), ...Object.fromEntries(removed.map((id) => [id, now])) };
      for (const id of keep) delete deleted[id];
      const data: AppData = fixSelection({
        ...EMPTY_DATA,
        ...incoming,
        profiles: incoming.profiles.map((p) => ({ ...p, updatedAt: now })),
        repertoires: incoming.repertoires.map((r) => ({ ...r, updatedAt: now })),
        mistakes: (incoming.mistakes ?? []).map((m) => ({ ...m, updatedAt: now })),
        deleted,
      });
      set({ data, undo: [], redo: [], line: [], ply: 0, view: 'home', trainScope: null });
    },

    applyRemote: (incoming) => {
      const { data } = get();
      const next = fixSelection({ ...incoming, activeProfileId: data.activeProfileId, activeRepId: data.activeRepId });
      const repGone = next.activeRepId !== data.activeRepId;
      set({ data: next, ...(repGone ? { line: [], ply: 0, trainScope: null } : {}) });
    },

    markBackup: () => patchData({ lastBackupAt: Date.now() }),

    playMove: (move) => {
      const { line, ply } = get();
      if (line[ply]?.uci === move.uci && line[ply]?.from === move.from) set({ ply: ply + 1 });
      else set({ line: [...line.slice(0, ply), move], ply: ply + 1 });
    },

    setPly: (ply) => set((s) => ({ ply: Math.max(0, Math.min(s.line.length, ply)) })),

    resetLine: () => set({ line: [], ply: 0 }),

    openLine: (line) => set({ line, ply: line.length, view: 'build' }),

    goToKey: (key) => {
      const rep = activeRep(get());
      if (!rep) return;
      const path = key === ROOT ? [] : findPath(rep, key);
      if (!path) return;
      set({ line: path, ply: path.length, view: 'build' });
    },

    goToSans: (sans) => {
      const line: PlayedMove[] = [];
      let key = ROOT;
      for (const san of sans) {
        const m = playSan(key, san);
        if (!m) break;
        line.push(m);
        key = m.to;
      }
      set({ line, ply: line.length, view: 'build' });
    },

    trainFrom: (key) => set({ trainScope: key && key !== ROOT ? key : null, view: 'train' }),

    playFrom: (line, setup) => set({ playStart: line, playSetup: setup ?? null, view: 'play' }),

    openGame: (id) => set({ openGameId: id, view: 'games' }),

    setTrainDeck: (deck) => set({ trainDeck: deck }),

    addMistakes: (cards) => {
      const { data } = get();
      const { cards: mistakes, added } = addCards(data.mistakes ?? [], cards);
      const deleted = { ...(data.deleted ?? {}) };
      for (const c of cards) delete deleted[c.id]; // added again on purpose
      patchData({ mistakes, deleted });
      return added;
    },

    deleteMistakes: (ids) => {
      const { data } = get();
      const gone = new Set(ids);
      patchData({ mistakes: (data.mistakes ?? []).filter((m) => !gone.has(m.id)), deleted: tombstone(ids) });
    },

    restoreMistakes: (cards) => {
      const { data } = get();
      const deleted = { ...(data.deleted ?? {}) };
      for (const c of cards) delete deleted[c.id];
      const now = Date.now();
      const have = new Set((data.mistakes ?? []).map((m) => m.id));
      const back = cards.filter((c) => !have.has(c.id)).map((c) => ({ ...c, updatedAt: now + 1 }));
      patchData({ mistakes: [...(data.mistakes ?? []), ...back], deleted });
    },

    gradeMistake: (id, grade) => {
      let due = 0;
      const mistakes = (get().data.mistakes ?? []).map((m) => {
        if (m.id !== id) return m;
        const card = gradeCard(m.card, grade);
        due = card.due;
        return { ...m, card };
      });
      patchData({ mistakes });
      return due;
    },

    showToast: (message, action) => {
      const id = ++toastSeq;
      set({ toast: { id, message, action } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, action ? 8000 : 3500);
    },

    hideToast: () => set({ toast: null }),
  };
});

export function activeRep(s: Pick<AppState, 'data'>): Repertoire | null {
  return s.data.repertoires.find((r) => r.id === s.data.activeRepId) ?? null;
}

export function activeProfile(s: Pick<AppState, 'data'>): Profile | null {
  return s.data.profiles.find((p) => p.id === s.data.activeProfileId) ?? null;
}

export function currentKey(s: Pick<AppState, 'line' | 'ply'>): string {
  return s.ply === 0 ? ROOT : s.line[s.ply - 1].to;
}

/** Number of moves on the current line (up to the cursor) that are not saved yet. */
export function unsavedCount(s: Pick<AppState, 'line' | 'ply'>, rep: Repertoire | null): number {
  if (!rep) return 0;
  return s.line.slice(0, s.ply).filter((m) => !findMove(rep, m.from, m.uci)).length;
}

/** The player's own rating: explicit, or the middle of the rating groups they face. */
export function profileRating(p: Profile): number {
  if (p.rating) return p.rating;
  if (!p.ratings.length) return 1500;
  const sorted = [...p.ratings].sort((a, b) => a - b);
  const lo = sorted[0] || 800;
  const hi = (sorted.at(-1) ?? 1500) + 199;
  return Math.round((lo + hi) / 2 / 100) * 100;
}

// ---------------------------------------------------------------------------
// Persistence: every change is written to IndexedDB shortly after it happens, and
// immediately when the tab is hidden or closed (`flushLocal`).

export type SaveStatus = 'saved' | 'saving' | 'error';

export const useSaveState = create<{ status: SaveStatus; at: number | null; error: string | null }>()(() => ({
  status: 'saved',
  at: null,
  error: null,
}));

let flusher: (() => Promise<void>) | null = null;

/** Writes any pending change to local storage right now. Resolves when it is on disk (or failed). */
export function flushLocal(): Promise<void> {
  return flusher?.() ?? Promise.resolve();
}

/** The data as it was at the last successful Google Drive sync on this device (see merge.ts). */
export async function loadSyncBase<T>(): Promise<T | null> {
  if (!dataStore) return null;
  try {
    return ((await idbGet('sync-base', dataStore)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveSyncBase(base: unknown): Promise<void> {
  if (!dataStore) return;
  await idbSet('sync-base', base ?? null, dataStore);
}

const STORAGE_UNAVAILABLE = 'Browser storage is unavailable (private window or blocked site data). Changes are lost when you close this tab.';

export async function loadData() {
  let data: AppData | undefined;
  let readError: string | null = dataStore ? null : STORAGE_UNAVAILABLE;
  if (dataStore) {
    try {
      data = (await idbGet('data', dataStore)) as AppData | undefined;
    } catch {
      readError = STORAGE_UNAVAILABLE;
    }
  }
  useApp.setState({ data: { ...EMPTY_DATA, ...(data ?? {}) }, loaded: true });
  if (readError) useSaveState.setState({ status: 'error', error: readError });
  // Ask the browser not to evict our storage under pressure.
  navigator.storage?.persist?.().catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useApp.getState().data;
  let dirty = false;
  let writing: Promise<void> | null = null;

  const write = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (writing) await writing.catch(() => {});
    if (!dirty) return;
    dirty = false;
    const snapshot = last;
    if (!dataStore) {
      useSaveState.setState({ status: 'error', error: STORAGE_UNAVAILABLE });
      return;
    }
    writing = idbSet('data', snapshot, dataStore)
      .then(() => {
        useSaveState.setState({ status: dirty ? 'saving' : 'saved', at: Date.now(), error: null });
      })
      .catch((e) => {
        dirty = true; // try again with the next change or flush
        console.error('Saving failed', e);
        useSaveState.setState({ status: 'error', error: (e as Error)?.message || STORAGE_UNAVAILABLE });
      })
      .finally(() => {
        writing = null;
      });
    await writing;
  };
  flusher = write;

  useApp.subscribe((s) => {
    if (s.data === last) return;
    last = s.data;
    dirty = true;
    if (useSaveState.getState().status !== 'error') useSaveState.setState({ status: 'saving' });
    clearTimeout(timer);
    timer = setTimeout(() => void write(), 300);
  });

  // pagehide and "hidden" are the reliable moments on phones and tablets; beforeunload often never fires there.
  addEventListener('pagehide', () => void write());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void write();
  });
}

export function exportBackup(data: AppData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 1);
}

export function parseBackup(text: string): AppData {
  const json = JSON.parse(text);
  if (json?.version !== 1 || !Array.isArray(json.profiles) || !Array.isArray(json.repertoires)) {
    throw new Error('This is not a valid backup file for this app.');
  }
  return json as AppData;
}

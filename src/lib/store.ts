// Global app state (zustand). Data lives in IndexedDB in the browser; there is no
// server and no move limit. Every repertoire change goes through `updateRep` so it
// can be undone.
import { create } from 'zustand';
import { createStore, get as idbGet, set as idbSet } from 'idb-keyval';
import { playSan, type PlayedMove, type Side } from './chess';
import { findMove, findPath, newRepertoire, ROOT, type Repertoire } from './repertoire';
import { syncCards } from './srs';

export interface Profile {
  id: string;
  name: string;
  color: string;
  ratings: number[];
  speeds: string[];
}

export interface AppData {
  version: 1;
  profiles: Profile[];
  repertoires: Repertoire[];
  activeProfileId: string | null;
  activeRepId: string | null;
  lastBackupAt: number | null;
}

export type View = 'home' | 'build' | 'tree' | 'train' | 'audit' | 'settings';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface UndoEntry {
  repId: string;
  before: Repertoire;
  label: string;
}

export interface AppState {
  loaded: boolean;
  data: AppData;
  view: View;
  /** Explored line on the build board, and how far into it we are. */
  line: PlayedMove[];
  ply: number;
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
  renameRepertoire(id: string, name: string): void;
  updateRep(repId: string, fn: (rep: Repertoire) => Repertoire, label: string, opts?: { undoable?: boolean }): void;
  undoLast(): void;
  redoLast(): void;
  replaceData(data: AppData): void;
  markBackup(): void;

  playMove(move: PlayedMove): void;
  setPly(ply: number): void;
  resetLine(): void;
  goToKey(key: string): void;
  goToSans(sans: string[]): void;
  showToast(message: string, action?: Toast['action']): void;
  hideToast(): void;
}

const EMPTY: AppData = {
  version: 1,
  profiles: [],
  repertoires: [],
  activeProfileId: null,
  activeRepId: null,
  lastBackupAt: null,
};

export const PROFILE_COLORS = ['#2f7dd1', '#d1542f', '#2fa56b', '#a24fd1', '#d1a02f', '#d12f7d'];

const dataStore = typeof indexedDB !== 'undefined' ? createStore('repertoire-data', 'app') : undefined;

let toastSeq = 0;

export const useApp = create<AppState>()((set, get) => {
  const patchData = (patch: Partial<AppData>) => set((s) => ({ data: { ...s.data, ...patch } }));
  const mapRep = (id: string, fn: (r: Repertoire) => Repertoire) =>
    set((s) => ({ data: { ...s.data, repertoires: s.data.repertoires.map((r) => (r.id === id ? fn(r) : r)) } }));

  return {
    loaded: false,
    data: EMPTY,
    view: 'home',
    line: [],
    ply: 0,
    undo: [],
    redo: [],
    toast: null,

    setView: (view) => set({ view }),

    setActiveProfile: (id) => {
      const reps = get().data.repertoires.filter((r) => r.profileId === id);
      patchData({ activeProfileId: id, activeRepId: reps[0]?.id ?? null });
      set({ line: [], ply: 0, view: 'home' });
    },

    setActiveRep: (id) => {
      patchData({ activeRepId: id });
      set({ line: [], ply: 0 });
    },

    addProfile: (p) => {
      const profile = { ...p, id: crypto.randomUUID() };
      const { data } = get();
      patchData({ profiles: [...data.profiles, profile], activeProfileId: data.activeProfileId ?? profile.id });
      return profile;
    },

    updateProfile: (id, patch) =>
      patchData({ profiles: get().data.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),

    deleteProfile: (id) => {
      const { data } = get();
      const profiles = data.profiles.filter((p) => p.id !== id);
      const repertoires = data.repertoires.filter((r) => r.profileId !== id);
      const activeProfileId = data.activeProfileId === id ? (profiles[0]?.id ?? null) : data.activeProfileId;
      const activeRepId = repertoires.some((r) => r.id === data.activeRepId)
        ? data.activeRepId
        : (repertoires.find((r) => r.profileId === activeProfileId)?.id ?? null);
      patchData({ profiles, repertoires, activeProfileId, activeRepId });
    },

    createRepertoire: (name, side) => {
      const profileId = get().data.activeProfileId!;
      const rep = newRepertoire(profileId, name, side);
      get().addRepertoire(rep);
      return rep;
    },

    addRepertoire: (rep) => {
      patchData({ repertoires: [...get().data.repertoires, syncCards(rep)], activeRepId: rep.id });
      set({ line: [], ply: 0 });
    },

    deleteRepertoire: (id) => {
      const { data } = get();
      const repertoires = data.repertoires.filter((r) => r.id !== id);
      patchData({
        repertoires,
        activeRepId:
          data.activeRepId === id ? (repertoires.find((r) => r.profileId === data.activeProfileId)?.id ?? null) : data.activeRepId,
      });
    },

    renameRepertoire: (id, name) => mapRep(id, (r) => ({ ...r, name })),

    updateRep: (repId, fn, label, opts) => {
      const before = get().data.repertoires.find((r) => r.id === repId);
      if (!before) return;
      const after = syncCards(fn(before));
      if (after === before) return;
      mapRep(repId, () => after);
      if (opts?.undoable !== false) set((s) => ({ undo: [...s.undo.slice(-49), { repId, before, label }], redo: [] }));
    },

    undoLast: () => {
      const entry = get().undo.at(-1);
      if (!entry) return;
      const current = get().data.repertoires.find((r) => r.id === entry.repId);
      if (!current) return;
      mapRep(entry.repId, () => entry.before);
      set((s) => ({ undo: s.undo.slice(0, -1), redo: [...s.redo, { ...entry, before: current }] }));
      get().showToast(`Ongedaan: ${entry.label}`);
    },

    redoLast: () => {
      const entry = get().redo.at(-1);
      if (!entry) return;
      const current = get().data.repertoires.find((r) => r.id === entry.repId);
      if (!current) return;
      mapRep(entry.repId, () => entry.before);
      set((s) => ({ redo: s.redo.slice(0, -1), undo: [...s.undo, { ...entry, before: current }] }));
      get().showToast(`Opnieuw: ${entry.label}`);
    },

    replaceData: (data) => set({ data: { ...EMPTY, ...data }, undo: [], redo: [], line: [], ply: 0, view: 'home' }),

    markBackup: () => patchData({ lastBackupAt: Date.now() }),

    playMove: (move) => {
      const { line, ply } = get();
      if (line[ply]?.uci === move.uci && line[ply]?.from === move.from) set({ ply: ply + 1 });
      else set({ line: [...line.slice(0, ply), move], ply: ply + 1 });
    },

    setPly: (ply) => set((s) => ({ ply: Math.max(0, Math.min(s.line.length, ply)) })),

    resetLine: () => set({ line: [], ply: 0 }),

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

// ---------------------------------------------------------------------------
// Persistence

export async function loadData() {
  let data: AppData | undefined;
  if (dataStore) data = (await idbGet('data', dataStore).catch(() => undefined)) as AppData | undefined;
  useApp.setState({ data: { ...EMPTY, ...(data ?? {}) }, loaded: true });
  // Ask the browser not to evict our storage under pressure.
  navigator.storage?.persist?.().catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useApp.getState().data;
  useApp.subscribe((s) => {
    if (s.data === last) return;
    last = s.data;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (dataStore) idbSet('data', last, dataStore).catch((e) => console.error('Opslaan mislukt', e));
    }, 300);
  });
  addEventListener('beforeunload', () => {
    if (timer && dataStore) idbSet('data', last, dataStore);
  });
}

export function exportBackup(data: AppData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 1);
}

export function parseBackup(text: string): AppData {
  const json = JSON.parse(text);
  if (json?.version !== 1 || !Array.isArray(json.profiles) || !Array.isArray(json.repertoires)) {
    throw new Error('Dit is geen geldig back-upbestand van deze app.');
  }
  return json as AppData;
}

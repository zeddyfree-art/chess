// Keeps the local data and one JSON file in the user's Google Drive in step, and
// writes a dated backup copy to Drive once a day (the last 30 are kept).
import { create } from 'zustand';
import {
  account,
  clearToken,
  createFile,
  deleteFile,
  download,
  DriveAuthError,
  ensureFolder,
  fileMeta,
  findSyncFile,
  googleClientId,
  listBackups,
  preloadGoogle,
  requestToken,
  revokeToken,
  updateFile,
  validToken,
  type DriveFile,
} from './drive';
import { mergeData, sameSyncedContent, type SyncBase } from './merge';
import { exportBackup, flushLocal, loadSyncBase, parseBackup, saveSyncBase, useApp, useSaveState, type AppData } from './store';

export type SyncStatus = 'unconfigured' | 'off' | 'syncing' | 'synced' | 'pending' | 'needs-auth' | 'error';

interface SyncState {
  status: SyncStatus;
  account: string | null;
  lastSyncAt: number | null;
  error: string | null;
}

export const useSync = create<SyncState>()(() => ({ status: 'off', account: null, lastSyncAt: null, error: null }));

const META_KEY = 'drive-sync';
const BACKUPS_KEPT = 30;

interface Meta {
  connected: boolean;
  fileId?: string;
  folderId?: string;
  version?: string;
  account?: string | null;
  backupDay?: string;
  /** Local changes not uploaded yet (survives reloads). */
  dirty?: boolean;
  /** Last successful sync on this device. */
  lastSyncAt?: number;
}

function readMeta(): Meta {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? 'null') ?? { connected: false };
  } catch {
    return { connected: false };
  }
}

function writeMeta(patch: Partial<Meta>) {
  const next = { ...readMeta(), ...patch };
  try {
    localStorage.setItem(META_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

// What Drive held at this device's last successful sync, so a merge can tell which side changed what.
let base: SyncBase | null | undefined; // undefined = not loaded yet
let baseLoading: Promise<SyncBase | null> | null = null;

function getBase(): Promise<SyncBase | null> {
  if (base !== undefined) return Promise.resolve(base);
  baseLoading ??= loadSyncBase<SyncBase>().then((b) => {
    if (base === undefined) base = b;
    return base;
  });
  return baseLoading;
}

async function rememberBase(data: AppData | SyncBase) {
  if (data === base) return;
  const next: SyncBase = { profiles: data.profiles, repertoires: data.repertoires, deleted: data.deleted ?? {} };
  base = next;
  // If this fails, the next merge simply has no base and keeps everything from both sides.
  await saveSyncBase(next).catch(() => {});
}

let changeSeq = 0;
let applyingRemote = false;
let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let timerAt = 0;

/** Upload soon after an edit; training progress can wait for the end of the session. */
const EDIT_DELAY = 1500;
const TRAINING_DELAY = 30_000;

/** What changed between two versions of the data: nothing that syncs, only training progress, or an edit. */
export function classify(a: AppData, b: AppData): 'none' | 'training' | 'edit' {
  if (a.profiles === b.profiles && a.repertoires === b.repertoires && a.deleted === b.deleted) return 'none';
  if (a.profiles !== b.profiles || a.deleted !== b.deleted || a.repertoires.length !== b.repertoires.length) return 'edit';
  let training = false;
  for (let i = 0; i < a.repertoires.length; i++) {
    const x = a.repertoires[i];
    const y = b.repertoires[i];
    if (x === y) continue;
    if (
      x.id !== y.id ||
      x.positions !== y.positions ||
      x.notes !== y.notes ||
      x.shapes !== y.shapes ||
      x.engine !== y.engine ||
      x.name !== y.name ||
      x.side !== y.side
    ) {
      return 'edit';
    }
    training = true; // only cards (review schedule) changed
  }
  return training ? 'training' : 'none';
}

function setStatus(patch: Partial<SyncState>) {
  useSync.setState(patch);
}

function idleStatus(): SyncStatus {
  const meta = readMeta();
  if (!googleClientId()) return 'unconfigured';
  if (!meta.connected) return 'off';
  if (!validToken()) return 'needs-auth';
  return meta.dirty ? 'pending' : 'synced';
}

/** Call once after local data is loaded. */
export function initSync() {
  const meta = readMeta();
  setStatus({ status: idleStatus(), account: meta.account ?? null, lastSyncAt: meta.lastSyncAt ?? null });
  // Only devices that are already connected talk to Google on startup; everyone else loads the
  // Google script when they hover over or focus a "Connect" button (see preloadGoogle).
  if (meta.connected) preloadGoogle();

  let last = useApp.getState().data;
  useApp.subscribe((s) => {
    const before = last;
    if (s.data === before) return;
    last = s.data;
    if (applyingRemote) return;
    const kind = classify(before, s.data);
    if (kind === 'none') return; // e.g. another repertoire was selected
    changeSeq++;
    if (!readMeta().connected) return;
    writeMeta({ dirty: true });
    if (useSync.getState().status !== 'syncing') setStatus({ status: validToken() ? 'pending' : 'needs-auth' });
    schedule(kind === 'edit' ? EDIT_DELAY : TRAINING_DELAY);
  });

  document.addEventListener('visibilitychange', () => {
    // Coming back: pick up changes made on another device.
    if (document.visibilityState === 'visible') schedule(300);
    // Leaving (switching app or tab): push anything still waiting while the page is alive.
    else if (readMeta().connected && readMeta().dirty && validToken()) void flushLocal().then(syncNow);
  });
  setInterval(() => document.visibilityState === 'visible' && schedule(0), 5 * 60_000);
  if (meta.connected && validToken()) schedule(0);
}

/** Runs a sync after `ms`. An earlier pending deadline is kept, so a burst of edits cannot push the upload back forever. */
function schedule(ms: number) {
  const at = Date.now() + ms;
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = undefined;
    void syncNow();
  }, ms);
}

/** Connect this device (opens Google's popup; call from a click). */
export async function connectDrive(): Promise<void> {
  const first = !readMeta().connected;
  await requestToken({ firstTime: first, hint: readMeta().account ?? undefined });
  writeMeta({ connected: true });
  await syncNow();
  const who = await account().catch(() => null);
  writeMeta({ account: who });
  setStatus({ account: who });
}

/** Re-authorise after the one-hour token expired (call from a click). */
export async function reconnectDrive(): Promise<void> {
  await requestToken({ hint: readMeta().account ?? undefined });
  await syncNow();
}

/** Reconnects (call from a click) and says how it went, for a toast. Never throws. */
export async function reconnectMessage(): Promise<string> {
  try {
    await reconnectDrive();
  } catch (e) {
    return (e as Error).message;
  }
  const st = useSync.getState();
  if (st.status === 'synced') return 'Up to date with Google Drive';
  if (st.status === 'error') return `Google Drive sync failed: ${st.error ?? 'unknown error'}`;
  if (st.status === 'needs-auth') return 'Google did not give access. Try again.';
  return 'Connected to Google Drive';
}

export async function disconnectDrive() {
  await revokeToken();
  localStorage.removeItem(META_KEY);
  base = null;
  await saveSyncBase(null).catch(() => {});
  setStatus({ status: idleStatus(), account: null, lastSyncAt: null, error: null });
}

/** Syncs and resolves once a run that started *after* this call has finished, so callers know their latest change went out. */
export function syncNow(): Promise<void> {
  if (running) {
    queued ??= running.then(() => {
      queued = null;
      return syncNow();
    });
    return queued;
  }
  running = run().finally(() => {
    running = null;
    if (again) {
      again = false;
      schedule(0);
    }
  });
  return running;
}

export interface SaveResult {
  /** Written to this device's storage. */
  local: boolean;
  /** State of Google Drive after trying: 'off' when it is not connected. */
  drive: SyncStatus;
  error?: string;
}

/** Saves everything now: local storage first, then Google Drive if it is connected. Never throws. */
export async function saveNow(): Promise<SaveResult> {
  await flushLocal();
  const local = useSaveState.getState().status !== 'error';
  const connected = readMeta().connected && !!googleClientId();
  if (!connected) return { local, drive: 'off' };
  await syncNow().catch(() => {});
  const st = useSync.getState();
  return { local, drive: st.status, error: st.error ?? undefined };
}

async function run() {
  const meta = readMeta();
  if (!meta.connected || !googleClientId()) return setStatus({ status: idleStatus() });
  if (!validToken()) return setStatus({ status: 'needs-auth' });

  setStatus({ status: 'syncing', error: null });
  const seqAtStart = changeSeq;
  try {
    const known = await getBase();
    let folderId = meta.folderId ?? (await ensureFolder());
    let file: DriveFile | null = meta.fileId ? await fileMeta(meta.fileId) : null;
    file ??= await findSyncFile();

    let version: string | undefined;
    let onDrive: AppData | SyncBase;
    if (!file) {
      // First sync, or the file/folder was removed from Drive: (re)create them.
      folderId = await ensureFolder();
      const snapshot = useApp.getState().data;
      const created = await createFile('repertoire-sync.json', 'sync', folderId, serialize(snapshot));
      file = created;
      version = created.version;
      onDrive = snapshot;
    } else if (file.version !== meta.version || !useApp.getState().data.profiles.length) {
      // Someone (another device) changed the file since we last synced: merge. Also when this device has
      // no data at all (site data partly cleared, or closed before it was stored): fetch it again.
      const remote = parseBackup(await download(file.id));
      const merged = mergeData(useApp.getState().data, remote, known);
      applyingRemote = true;
      try {
        useApp.getState().applyRemote(merged);
      } finally {
        applyingRemote = false;
      }
      version = file.version;
      if (!sameSyncedContent(merged, remote)) version = (await updateFile(file.id, serialize(merged))).version;
      onDrive = merged;
    } else if (meta.dirty) {
      const snapshot = useApp.getState().data;
      version = (await updateFile(file.id, serialize(snapshot))).version;
      onDrive = snapshot;
    } else {
      version = file.version;
      onDrive = known ?? useApp.getState().data; // nothing changed on either side
    }

    await rememberBase(onDrive);
    const stillDirty = changeSeq !== seqAtStart;
    const now = Date.now();
    writeMeta({ folderId, fileId: file.id, version, dirty: stillDirty, lastSyncAt: now });
    await dailyBackup(folderId);
    setStatus({ status: stillDirty ? 'pending' : 'synced', lastSyncAt: now, error: null });
    if (stillDirty) again = true;
  } catch (e) {
    if (e instanceof DriveAuthError) {
      clearToken();
      setStatus({ status: 'needs-auth' });
    } else {
      setStatus({ status: 'error', error: (e as Error).message });
    }
  }
}

function serialize(data: AppData): string {
  return exportBackup(data);
}

async function dailyBackup(folderId: string) {
  const day = new Date().toISOString().slice(0, 10);
  if (readMeta().backupDay === day) return;
  const name = `repertoire-backup-${day}.json`;
  const backups = await listBackups();
  const today = backups.find((b) => b.name === name);
  const content = serialize(useApp.getState().data);
  if (today) await updateFile(today.id, content);
  else await createFile(name, 'backup', folderId, content);
  // Keep the newest ones.
  const all = today ? backups : [{ id: '', name } as DriveFile, ...backups];
  for (const old of all.slice(BACKUPS_KEPT)) if (old.id) await deleteFile(old.id).catch(() => {});
  writeMeta({ backupDay: day });
}

export async function driveBackups(): Promise<DriveFile[]> {
  return listBackups();
}

export async function loadDriveBackup(id: string): Promise<AppData> {
  return parseBackup(await download(id));
}

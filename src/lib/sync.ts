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
import { mergeData, sameSyncedContent } from './merge';
import { exportBackup, parseBackup, useApp, type AppData } from './store';

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

let changeSeq = 0;
let applyingRemote = false;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

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
  setStatus({ status: idleStatus(), account: meta.account ?? null });
  preloadGoogle();

  let last = useApp.getState().data;
  useApp.subscribe((s) => {
    if (s.data === last) return;
    last = s.data;
    if (applyingRemote) return;
    changeSeq++;
    if (!readMeta().connected) return;
    writeMeta({ dirty: true });
    if (useSync.getState().status !== 'syncing') setStatus({ status: validToken() ? 'pending' : 'needs-auth' });
    schedule(4000);
  });

  // Pick up changes made on another device when coming back to the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(300);
  });
  setInterval(() => document.visibilityState === 'visible' && schedule(0), 5 * 60_000);
  if (meta.connected && validToken()) schedule(0);
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
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

export async function disconnectDrive() {
  await revokeToken();
  localStorage.removeItem(META_KEY);
  setStatus({ status: idleStatus(), account: null, lastSyncAt: null, error: null });
}

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
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

async function run() {
  const meta = readMeta();
  if (!meta.connected || !googleClientId()) return setStatus({ status: idleStatus() });
  if (!validToken()) return setStatus({ status: 'needs-auth' });

  setStatus({ status: 'syncing', error: null });
  const seqAtStart = changeSeq;
  try {
    let folderId = meta.folderId ?? (await ensureFolder());
    let file: DriveFile | null = meta.fileId ? await fileMeta(meta.fileId) : null;
    file ??= await findSyncFile();

    let version: string | undefined;
    if (!file) {
      // First sync, or the file/folder was removed from Drive: (re)create them.
      folderId = await ensureFolder();
      const created = await createFile('repertoire-sync.json', 'sync', folderId, serialize(useApp.getState().data));
      file = created;
      version = created.version;
    } else if (file.version !== meta.version) {
      // Someone (another device) changed the file since we last synced: merge.
      const remote = parseBackup(await download(file.id));
      const merged = mergeData(useApp.getState().data, remote);
      applyingRemote = true;
      try {
        useApp.getState().applyRemote(merged);
      } finally {
        applyingRemote = false;
      }
      version = file.version;
      if (!sameSyncedContent(merged, remote)) version = (await updateFile(file.id, serialize(merged))).version;
    } else if (meta.dirty) {
      version = (await updateFile(file.id, serialize(useApp.getState().data))).version;
    } else version = file.version;

    const stillDirty = changeSeq !== seqAtStart;
    writeMeta({ folderId, fileId: file.id, version, dirty: stillDirty });
    await dailyBackup(folderId);
    setStatus({ status: stillDirty ? 'pending' : 'synced', lastSyncAt: Date.now(), error: null });
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

// Keeps the local data in step with two JSON files in the user's Google Drive (the repertoire data and,
// separately, the imported games), writes a dated backup of the repertoire data once a day (the last 30 are
// kept) and of the games once a week (the last 8). See drive.ts for the folder layout.
import { create } from 'zustand';
import {
  account,
  clearToken,
  createFile,
  deleteFile,
  download,
  DriveAuthError,
  ensureLayout,
  fileMeta,
  findGamesFile,
  findSyncFile,
  googleClientId,
  listBackups,
  listGameBackups,
  moveFile,
  preloadGoogle,
  requestToken,
  revokeToken,
  updateFile,
  validToken,
  type DriveFile,
  type Layout,
} from './drive';
import { mergeGames, parseGamesFile, sameGames, serializeGames, useGames } from './gamesStore';
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
const GAME_BACKUPS_KEPT = 8;
const GAME_BACKUP_DAYS = 7;
/** Version of the folder layout in Drive (2: with Sync/ and Backups/ subfolders). */
const LAYOUT = 2;

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
  layout?: number;
  folders?: Layout;
  gamesFileId?: string;
  gamesVersion?: string;
  /** Games changed here and not uploaded yet. */
  gamesDirty?: boolean;
  gamesBackupDay?: string;
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
let gamesSeq = 0;
let applyingRemote = false;
let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let timerAt = 0;

/** Upload soon after an edit; training progress can wait for the end of the session. */
const EDIT_DELAY = 1500;
const TRAINING_DELAY = 30_000;
/** Games change in bursts (an import, then the analysis of game after game): upload them in batches. */
const GAMES_DELAY = 20_000;

/** What changed between two versions of the data: nothing that syncs, only training progress, or an edit. */
export function classify(a: AppData, b: AppData): 'none' | 'training' | 'edit' {
  if (a.profiles === b.profiles && a.repertoires === b.repertoires && a.deleted === b.deleted && a.mistakes === b.mistakes && a.checks === b.checks)
    return 'none';
  // New check results go up soon too: you may pick up the list on another device.
  if (a.profiles !== b.profiles || a.deleted !== b.deleted || a.checks !== b.checks || a.repertoires.length !== b.repertoires.length) return 'edit';
  let training = false;
  if (a.mistakes !== b.mistakes) {
    const x = a.mistakes ?? [];
    const y = b.mistakes ?? [];
    if (x.length !== y.length || x.some((m, i) => m.id !== y[i].id || m.updatedAt !== y[i].updatedAt)) return 'edit';
    training = true; // only the review schedule of mistake cards changed
  }
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
      x.side !== y.side ||
      !!x.study !== !!y.study ||
      x.trainDepth !== y.trainDepth ||
      !!x.paused !== !!y.paused
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
  return meta.dirty || meta.gamesDirty ? 'pending' : 'synced';
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

  let lastGames = useGames.getState().data;
  useGames.subscribe((s) => {
    if (s.data === lastGames) return;
    lastGames = s.data;
    if (applyingRemote || !s.loaded) return;
    gamesSeq++;
    if (!readMeta().connected) return;
    writeMeta({ gamesDirty: true });
    if (useSync.getState().status !== 'syncing') setStatus({ status: validToken() ? 'pending' : 'needs-auth' });
    schedule(GAMES_DELAY);
  });

  document.addEventListener('visibilitychange', () => {
    // Coming back: pick up changes made on another device.
    if (document.visibilityState === 'visible') schedule(300);
    // Leaving (switching app or tab): push anything still waiting while the page is alive.
    else if (readMeta().connected && (readMeta().dirty || readMeta().gamesDirty) && validToken()) void flushLocal().then(syncNow);
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
  const gamesSeqAtStart = gamesSeq;
  try {
    const known = await getBase();
    let folders = meta.layout === LAYOUT && meta.folders ? meta.folders : await ensureLayout();
    let file: DriveFile | null = meta.fileId ? await fileMeta(meta.fileId) : null;
    file ??= await findSyncFile();

    let version: string | undefined;
    let onDrive: AppData | SyncBase;
    if (!file) {
      // First sync, or the file was removed from Drive: (re)create it (and any folder that went with it).
      folders = await ensureLayout();
      writeMeta({ folders });
      const snapshot = useApp.getState().data;
      const created = await createFile('repertoire-sync.json', 'sync', folders.sync, serialize(snapshot));
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
    writeMeta({ folderId: folders.root, fileId: file.id, version, dirty: stillDirty });

    const games = await syncGames(folders, gamesSeqAtStart);
    if (meta.layout !== LAYOUT) {
      await moveIntoLayout(folders);
      writeMeta({ layout: LAYOUT, folders });
    }
    const now = Date.now();
    writeMeta({ lastSyncAt: now });
    await dailyBackup();
    await weeklyGamesBackup();
    const pending = stillDirty || games.stillDirty;
    setStatus({ status: pending ? 'pending' : 'synced', lastSyncAt: now, error: null });
    if (pending) again = true;
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

/** The games file: merged like the repertoire file, but on its own, so a big collection of games does not
 *  slow down syncing your repertoire and training. */
async function syncGames(folders: Layout, seqAtStart: number): Promise<{ stillDirty: boolean }> {
  const meta = readMeta();
  if (!useGames.getState().loaded) return { stillDirty: !!meta.gamesDirty };
  let file: DriveFile | null = meta.gamesFileId ? await fileMeta(meta.gamesFileId) : null;
  file ??= await findGamesFile();
  let version: string | undefined;
  const local = useGames.getState().data;
  if (!file) {
    if (!local.games.length && !Object.keys(local.deleted).length) return { stillDirty: false }; // nothing to keep yet
    file = await createFile('games-sync.json', 'games-sync', folders.sync, serializeGames(local));
    version = file.version;
  } else if (file.version !== meta.gamesVersion) {
    const remote = parseGamesFile(await download(file.id));
    const merged = mergeGames(useGames.getState().data, remote);
    applyingRemote = true;
    try {
      useGames.getState().applyRemote(merged);
    } finally {
      applyingRemote = false;
    }
    version = file.version;
    if (!sameGames(merged, remote)) version = (await updateFile(file.id, serializeGames(merged))).version;
  } else if (meta.gamesDirty) {
    version = (await updateFile(file.id, serializeGames(local))).version;
  } else {
    version = file.version;
  }
  const stillDirty = gamesSeq !== seqAtStart;
  writeMeta({ gamesFileId: file.id, gamesVersion: version, gamesDirty: stillDirty });
  return { stillDirty };
}

/** Puts files made before the subfolders existed in their place (once per device; quick when done). */
async function moveIntoLayout(folders: Layout) {
  // A move changes a file's version. If nobody changed the file since this device synced it, take the new
  // version as known, so the move does not look like a change made on another device.
  const move = async (file: DriveFile | null, folder: string, known: 'version' | 'gamesVersion') => {
    if (!file) return;
    const before = readMeta()[known];
    const moved = await moveFile(file, folder);
    if (moved?.version && before === file.version) writeMeta({ [known]: moved.version });
  };
  const meta = readMeta();
  await move(meta.fileId ? await fileMeta(meta.fileId) : await findSyncFile(), folders.sync, 'version');
  await move(meta.gamesFileId ? await fileMeta(meta.gamesFileId) : await findGamesFile(), folders.sync, 'gamesVersion');
  for (const b of await listBackups()) await moveFile(b, folders.repertoireBackups).catch(() => {});
  for (const b of await listGameBackups()) await moveFile(b, folders.gameBackups).catch(() => {});
}

/** The folders, checked again (and recreated if someone removed them): done before writing a backup. */
async function checkedLayout(): Promise<Layout> {
  const folders = await ensureLayout();
  writeMeta({ folders });
  return folders;
}

async function weeklyGamesBackup() {
  const meta = readMeta();
  const today = new Date().toISOString().slice(0, 10);
  if (meta.gamesBackupDay && Date.parse(today) - Date.parse(meta.gamesBackupDay) < GAME_BACKUP_DAYS * 86_400_000) return;
  const data = useGames.getState().data;
  if (!data.games.length) return;
  const folders = await checkedLayout();
  await createFile(`games-backup-${today}.json`, 'games-backup', folders.gameBackups, serializeGames(data));
  const all = await listGameBackups();
  for (const old of all.slice(GAME_BACKUPS_KEPT)) await deleteFile(old.id).catch(() => {});
  writeMeta({ gamesBackupDay: today });
}

async function dailyBackup() {
  const day = new Date().toISOString().slice(0, 10);
  if (readMeta().backupDay === day) return;
  const folderId = (await checkedLayout()).repertoireBackups;
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

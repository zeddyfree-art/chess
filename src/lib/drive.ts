// Google Drive access from the browser: Google Identity Services (token model) plus
// the Drive REST API. Uses the `drive.file` scope: the app can only see files it
// created itself (a "Repertoire app" folder in the user's Drive), and Google does
// not require app verification for it.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'google-token';
const CLIENT_OVERRIDE_KEY = 'google-client-id';
const APP_KEY = 'repertoireApp';
const FOLDER_NAME = 'Repertoire app';

/** OAuth client of the published site (public by design; see docs/google-drive-setup.md). */
const DEFAULT_CLIENT_ID = '611331060397-qed3b7dfpv7tfq9d40otn610dm4knumt.apps.googleusercontent.com';

/** Client id pasted in Settings on this device, else the build-time one (VITE_GOOGLE_CLIENT_ID), else the default. */
export function googleClientId(): string {
  try {
    const override = localStorage.getItem(CLIENT_OVERRIDE_KEY);
    if (override) return override;
  } catch {
    /* ignore */
  }
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || DEFAULT_CLIENT_ID;
}

export function setClientIdOverride(id: string | null) {
  try {
    if (id) localStorage.setItem(CLIENT_OVERRIDE_KEY, id.trim());
    else localStorage.removeItem(CLIENT_OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Tokens

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: GoogleTokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

let gis: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gis = null;
      reject(new Error('Could not load Google sign-in.'));
    };
    document.head.appendChild(s);
  });
  return gis;
}

/** Preload the Google script so a later click can open the popup without delay. */
export function preloadGoogle() {
  if (googleClientId()) loadGis().catch(() => {});
}

export function validToken(): string | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as StoredToken | null;
    return t && t.expiresAt - 60_000 > Date.now() ? t.token : null;
  } catch {
    return null;
  }
}

function storeToken(token: string, expiresIn: number) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + expiresIn * 1000 }));
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Opens Google's popup. Must be called from a click (browsers block popups otherwise).
 *  After the first consent the popup closes by itself. Tokens last one hour. */
export function requestToken(opts: { firstTime?: boolean; hint?: string } = {}): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) return Promise.reject(new Error('Google Drive is not configured for this site.'));
  // When the script is already there, open the popup right away, still inside the click: Safari on
  // iPhone blocks popups that open after waiting for something.
  if (window.google?.accounts?.oauth2) return openTokenPopup(clientId, opts);
  return loadGis().then(() => openTokenPopup(clientId, opts));
}

function openTokenPopup(clientId: string, opts: { firstTime?: boolean; hint?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Google login failed'));
        storeToken(r.access_token, r.expires_in ?? 3600);
        resolve(r.access_token);
      },
      error_callback: (e) =>
        reject(new Error(e.type === 'popup_closed' ? 'Google login window was closed.' : e.message || 'Google login failed')),
    });
    client.requestAccessToken({ prompt: opts.firstTime ? 'consent' : '', login_hint: opts.hint });
  });
}

export async function revokeToken() {
  const t = validToken();
  clearToken();
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t);
}

// ---------------------------------------------------------------------------
// REST helpers

export class DriveAuthError extends Error {
  constructor() {
    super('Google Drive session expired.');
  }
}

async function api<T>(url: string, init: RequestInit = {}, as: 'json' | 'text' = 'json'): Promise<T> {
  const token = validToken();
  if (!token) throw new DriveAuthError();
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }).catch(() => {
    throw new Error('Could not reach Google Drive.');
  });
  if (res.status === 401) {
    clearToken();
    throw new DriveAuthError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`Google Drive error ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    (e as Error & { status?: number }).status = res.status;
    throw e;
  }
  if (res.status === 204) return undefined as T;
  return (as === 'json' ? res.json() : res.text()) as Promise<T>;
}

export interface DriveFile {
  id: string;
  name: string;
  version?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
}

const FIELDS = 'id,name,version,modifiedTime,createdTime,size';

async function findByRole(role: string, orderBy?: string): Promise<DriveFile[]> {
  const q = `appProperties has { key='${APP_KEY}' and value='${role}' } and trashed=false`;
  const params = new URLSearchParams({ q, fields: `files(${FIELDS})`, spaces: 'drive', pageSize: '100' });
  if (orderBy) params.set('orderBy', orderBy);
  const r = await api<{ files: DriveFile[] }>(`${API}/files?${params}`);
  return r.files ?? [];
}

export async function account(): Promise<string | null> {
  const r = await api<{ user?: { emailAddress?: string; displayName?: string } }>(`${API}/about?fields=user(emailAddress,displayName)`);
  return r.user?.emailAddress ?? r.user?.displayName ?? null;
}

export async function ensureFolder(): Promise<string> {
  const found = await findByRole('folder');
  if (found[0]) return found[0].id;
  const r = await api<DriveFile>(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [APP_KEY]: 'folder' },
    }),
  });
  return r.id;
}

export async function findSyncFile(): Promise<DriveFile | null> {
  const files = await findByRole('sync', 'modifiedTime desc');
  return files[0] ?? null;
}

export async function fileMeta(id: string): Promise<DriveFile | null> {
  try {
    const f = await api<DriveFile & { trashed?: boolean }>(`${API}/files/${id}?fields=${FIELDS},trashed`);
    return f.trashed ? null : f;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export function download(id: string): Promise<string> {
  return api<string>(`${API}/files/${id}?alt=media`, {}, 'text');
}

export async function createFile(name: string, role: string, folderId: string, content: string): Promise<DriveFile> {
  const boundary = `rep${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: [folderId], mimeType: 'application/json', appProperties: { [APP_KEY]: role } };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  return api<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export function updateFile(id: string, content: string): Promise<DriveFile> {
  return api<DriveFile>(`${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  });
}

export function deleteFile(id: string): Promise<void> {
  return api<void>(`${API}/files/${id}`, { method: 'DELETE' });
}

export function listBackups(): Promise<DriveFile[]> {
  return findByRole('backup', 'createdTime desc');
}

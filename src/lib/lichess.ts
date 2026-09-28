// Lichess connection: Opening Explorer (needs a token since 2026), cloud evaluations
// (anonymous), and "Login with Lichess" via OAuth PKCE (no app registration needed).
import { createStore, get, getMany, set } from 'idb-keyval';

export const EXPLORER = 'https://explorer.lichess.org';
export const LICHESS = 'https://lichess.org';

export const RATING_BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] as const;
export const SPEEDS = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'] as const;
export type Speed = (typeof SPEEDS)[number];

export const SPEED_LABELS: Record<Speed, string> = {
  ultraBullet: 'UltraBullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
};

export function ratingLabel(bucket: number): string {
  const i = RATING_BUCKETS.indexOf(bucket as (typeof RATING_BUCKETS)[number]);
  const next = RATING_BUCKETS[i + 1];
  if (bucket === 0) return '<1000';
  return next ? `${bucket}–${next - 1}` : `${bucket}+`;
}

// ---------------------------------------------------------------------------
// Token handling

const TOKEN_KEY = 'lichess-token';
const USER_KEY = 'lichess-user';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getLichessUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null, user?: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (user) localStorage.setItem(USER_KEY, user);
    else if (!token) localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Checks a token against /api/account and returns the username. */
export async function verifyToken(token: string): Promise<string> {
  const res = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(res.status === 401 ? 'Token invalid or revoked' : `Lichess responded ${res.status}`);
  const json = await res.json();
  return json.username as string;
}

// OAuth2 PKCE. Lichess accepts any client_id for public clients.
const CLIENT_ID = 'repertoire-trainer';
const PKCE_KEY = 'lichess-pkce';

function redirectUri() {
  return location.origin + location.pathname;
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(12)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.href = `${LICHESS}/oauth?${params}`;
}

/** Call once at startup: finishes the OAuth redirect if there is a ?code= in the URL. */
export async function completeLoginIfRedirected(): Promise<string | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;
  history.replaceState(null, '', redirectUri() + url.hash);
  if (error) throw new Error(`Login cancelled (${error})`);
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null');
  sessionStorage.removeItem(PKCE_KEY);
  if (!saved || saved.state !== state) throw new Error('Login failed (state mismatch)');
  const res = await fetch(`${LICHESS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      code_verifier: saved.verifier,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`Could not obtain token (${res.status})`);
  const { access_token } = await res.json();
  const user = await verifyToken(access_token);
  setToken(access_token, user);
  return user;
}

export async function logout() {
  const token = getToken();
  setToken(null);
  if (token) {
    await fetch(`${LICHESS}/api/token`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Request queue: Lichess asks API clients to make one request at a time and to
// back off for a full minute after a 429.

let chain: Promise<unknown> = Promise.resolve();
let pausedUntil = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('The Lichess Opening Explorer requires you to log in with a (free) Lichess account.');
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('Lichess asks us to slow down (too many requests). Try again in a minute.');
  }
}

const cacheStore = typeof indexedDB !== 'undefined' ? createStore('repertoire-cache', 'lichess') : undefined;
const memCache = new Map<string, unknown>();
const EXPLORER_TTL = 1000 * 60 * 60 * 24 * 30; // explorer data changes slowly

const inflight = new Map<string, Promise<unknown>>();

function cached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  if (memCache.has(key)) return Promise.resolve(memCache.get(key) as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    if (cacheStore) {
      const hit = (await get(key, cacheStore).catch(() => undefined)) as { at: number; value: T } | undefined;
      if (hit && Date.now() - hit.at < ttl) {
        memCache.set(key, hit.value);
        return hit.value;
      }
    }
    const value = await fetcher();
    memCache.set(key, value);
    if (cacheStore) set(key, { at: Date.now(), value }, cacheStore).catch(() => {});
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Synchronous peek into the in-memory cache (used by the tree view to decorate nodes without fetching). */
export function peekCache<T>(key: string): T | undefined {
  return memCache.get(key) as T | undefined;
}

/** Loads previously fetched entries from IndexedDB into memory, so `peekCache` sees them. */
export async function warmCache(keys: string[]): Promise<number> {
  if (!cacheStore) return 0;
  const missing = keys.filter((k) => !memCache.has(k));
  if (!missing.length) return 0;
  const values = (await getMany(missing, cacheStore).catch(() => [])) as ({ at: number; value: unknown } | undefined)[];
  let n = 0;
  values.forEach((hit, i) => {
    if (hit) {
      memCache.set(missing[i], hit.value);
      n++;
    }
  });
  return n;
}

// ---------------------------------------------------------------------------
// Opening Explorer

export type ExplorerDb = 'lichess' | 'masters';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
  opening?: { eco: string; name: string } | null;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: { eco: string; name: string } | null;
}

export interface ExplorerQuery {
  db: ExplorerDb;
  fen: string;
  ratings: number[];
  speeds: string[];
}

export function explorerCacheKey(q: ExplorerQuery): string {
  const filters = q.db === 'lichess' ? `${[...q.ratings].sort((a, b) => a - b)}|${[...q.speeds].sort()}` : '';
  return `explorer|${q.db}|${filters}|${q.fen.split(' ').slice(0, 4).join(' ')}`;
}

export function fetchExplorer(q: ExplorerQuery): Promise<ExplorerResult> {
  return cached(explorerCacheKey(q), EXPLORER_TTL, () =>
    enqueue(async () => {
      const token = getToken();
      if (!token) throw new AuthRequiredError();
      const params = new URLSearchParams({ fen: q.fen, moves: '20', topGames: '0', recentGames: '0' });
      if (q.db === 'lichess') {
        params.set('variant', 'standard');
        if (q.ratings.length) params.set('ratings', q.ratings.join(','));
        if (q.speeds.length) params.set('speeds', q.speeds.join(','));
      }
      const res = await fetch(`${EXPLORER}/${q.db}?${params}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {
        throw new Error('Could not reach the Lichess database. Check your internet connection.');
      });
      if (res.status === 401 || res.status === 403) throw new AuthRequiredError();
      if (res.status === 429) {
        pausedUntil = Date.now() + 60_000;
        throw new RateLimitError();
      }
      if (!res.ok) throw new Error(`Opening Explorer: error ${res.status}`);
      const json = await res.json();
      return {
        white: json.white,
        draws: json.draws,
        black: json.black,
        opening: json.opening,
        moves: (json.moves ?? []).map((m: ExplorerMove) => ({
          uci: m.uci,
          san: m.san,
          white: m.white,
          draws: m.draws,
          black: m.black,
          averageRating: m.averageRating,
          opening: m.opening,
        })),
      } satisfies ExplorerResult;
    }),
  );
}

export const totalGames = (r: { white: number; draws: number; black: number }) => r.white + r.draws + r.black;

// ---------------------------------------------------------------------------
// Cloud evaluation (precomputed deep Stockfish evals of popular positions)

export interface CloudPv {
  moves: string; // space separated UCI
  cp?: number; // white's perspective
  mate?: number;
}

export interface CloudEval {
  depth: number;
  knodes: number;
  pvs: CloudPv[];
}

export function fetchCloudEval(fen: string, multiPv = 3): Promise<CloudEval | null> {
  const key = `cloud|${multiPv}|${fen.split(' ').slice(0, 4).join(' ')}`;
  return cached(key, 1000 * 60 * 60 * 24 * 7, () =>
    enqueue(async () => {
      const params = new URLSearchParams({ fen, multiPv: String(multiPv) });
      const res = await fetch(`${LICHESS}/api/cloud-eval?${params}`).catch(() => {
        throw new Error('Could not reach Lichess.');
      });
      if (res.status === 404) return null;
      if (res.status === 429) {
        pausedUntil = Date.now() + 60_000;
        throw new RateLimitError();
      }
      if (!res.ok) throw new Error(`Cloud eval: error ${res.status}`);
      const json = await res.json();
      return { depth: json.depth, knodes: json.knodes, pvs: json.pvs } as CloudEval;
    }),
  );
}

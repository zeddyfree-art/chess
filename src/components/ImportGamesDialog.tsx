import { useMemo, useRef, useState } from 'react';
import { colorOf, parsePgnGames, SPEED_NAMES, toPlayedGame, type GameSpeed, type PgnGamesResult } from '../lib/games';
import { useGames } from '../lib/gamesStore';
import { getLichessUser } from '../lib/lichess';
import { fetchLichessGames } from '../lib/lichessGames';
import { useApp, type Profile } from '../lib/store';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

type Period = 'week' | 'month' | 'year' | 'all';
const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: 'week', label: 'Last week', days: 7 },
  { id: 'month', label: 'Last month', days: 31 },
  { id: 'year', label: 'Last year', days: 365 },
  { id: 'all', label: 'All', days: null },
];
const SPEEDS: GameSpeed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const MAX_CHOICES = [50, 100, 200, 500, 0];

interface Prefs {
  period: Period;
  speeds: GameSpeed[];
  ratedOnly: boolean;
  max: number;
}

const prefsKey = (profileId: string) => `games-import-${profileId}`;
const fetchedKey = (profileId: string) => `lichess-fetched-${profileId}`;

function markFetched(profileId: string, at: number) {
  try {
    localStorage.setItem(fetchedKey(profileId), String(at));
  } catch {
    /* ignore */
  }
}

/** Fetches the games played since the last fetch (with the time controls chosen then). Null: never fetched here. */
export async function fetchNewLichessGames(profile: Profile): Promise<{ added: number } | null> {
  const user = profile.lichess;
  const last = Number(localStorage.getItem(fetchedKey(profile.id)) ?? 0);
  if (!user || !last) return null;
  const prefs = readPrefs(profile.id);
  // Lichess filters on when a game started: look back further for daily games, which can last weeks.
  const overlap = (prefs.speeds.includes('correspondence') ? 60 : 2) * 86_400_000;
  const started = Date.now();
  const { games } = await fetchLichessGames({ username: user, since: last - overlap, speeds: prefs.speeds, ratedOnly: prefs.ratedOnly });
  markFetched(profile.id, started);
  const mine = games.flatMap((g) => {
    const color = colorOf(g, [user]);
    return color ? [toPlayedGame(g, profile.id, color, 'lichess')] : [];
  });
  return { added: useGames.getState().addGames(mine).added };
}

export function hasFetchedBefore(profileId: string): boolean {
  try {
    return !!localStorage.getItem(fetchedKey(profileId));
  } catch {
    return false;
  }
}

function readPrefs(profileId: string): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(prefsKey(profileId)) ?? 'null');
    if (p) return p;
  } catch {
    /* ignore */
  }
  return { period: 'month', speeds: ['blitz', 'rapid', 'classical', 'correspondence'], ratedOnly: false, max: 100 };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Roughly how long the analysis of `n` games takes on this kind of device (about half a minute per game on a laptop). */
export function analysisEstimate(n: number): string {
  const phone = matchMedia('(max-width: 900px)').matches;
  const min = Math.ceil((n * (phone ? 75 : 35)) / 60);
  return min < 2 ? 'about a minute' : min < 90 ? `about ${min} minutes` : `about ${Math.round(min / 60)} hours`;
}

export function ImportGamesDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [tab, setTab] = useState<'lichess' | 'pgn'>('lichess');
  return (
    <Dialog title="Add your games" onClose={onClose}>
      <div className="row" style={{ gap: 6 }}>
        <span className={`chip ${tab === 'lichess' ? 'on' : ''}`} onClick={() => setTab('lichess')}>
          From Lichess
        </span>
        <span className={`chip ${tab === 'pgn' ? 'on' : ''}`} onClick={() => setTab('pgn')}>
          PGN file
        </span>
      </div>
      {tab === 'lichess' ? <LichessImport profile={profile} onClose={onClose} /> : <PgnImport profile={profile} onClose={onClose} />}
    </Dialog>
  );
}

function LichessImport({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const updateProfile = useApp((s) => s.updateProfile);
  const [user, setUser] = useState(profile.lichess ?? getLichessUser() ?? '');
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(profile.id));
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ added: number; already: number; notYou: number; skipped: { reason: string; n: number }[] } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const patch = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try {
      localStorage.setItem(prefsKey(profile.id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const fetchGames = async () => {
    const name = user.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setCount(0);
    abort.current = new AbortController();
    const started = Date.now();
    try {
      const days = PERIODS.find((p) => p.id === prefs.period)!.days;
      const { games, skipped } = await fetchLichessGames({
        username: name,
        since: days ? Date.now() - days * 86_400_000 : undefined,
        speeds: prefs.speeds,
        ratedOnly: prefs.ratedOnly,
        max: prefs.max || undefined,
        signal: abort.current.signal,
        onProgress: setCount,
      });
      if (profile.lichess !== name) updateProfile(profile.id, { lichess: name });
      markFetched(profile.id, started);
      const mine = games.flatMap((g) => {
        const color = colorOf(g, [name]);
        return color ? [toPlayedGame(g, profile.id, color, 'lichess')] : [];
      });
      const r = useGames.getState().addGames(mine);
      setDone({ ...r, notYou: games.length - mine.length, skipped });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const toggleSpeed = (s: GameSpeed) => patch({ speeds: prefs.speeds.includes(s) ? prefs.speeds.filter((x) => x !== s) : [...prefs.speeds, s] });

  if (done) {
    return (
      <>
        <div className="stat-row wrap">
          <div className="stat">
            <b>{done.added}</b>
            <span>new {done.added === 1 ? 'game' : 'games'}</span>
          </div>
          <div className="stat">
            <b>{done.already}</b>
            <span>already here</span>
          </div>
        </div>
        {done.added > 0 && (
          <div className="small muted">
            They are analysed one by one while the app is open ({analysisEstimate(done.added)} on this device). You can keep using the app meanwhile.
          </div>
        )}
        {done.added === 0 && done.already === 0 && <div className="notice small">No games found for these choices.</div>}
        {done.skipped.length > 0 && (
          <div className="small muted">Left out: {done.skipped.map((s) => `${plural(s.n, 'game')} (${s.reason})`).join(', ')}.</div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => setDone(null)}>
            Fetch more
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="field">
        <label>Your Lichess username</label>
        <input className="input" value={user} autoFocus placeholder="e.g. DrNykterstein" onChange={(e) => setUser(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchGames()} />
      </div>
      <div className="field">
        <label>Period</label>
        <div className="filter-row">
          {PERIODS.map((p) => (
            <span key={p.id} className={`chip ${prefs.period === p.id ? 'on' : ''}`} onClick={() => patch({ period: p.id })}>
              {p.label}
            </span>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Time controls</label>
        <div className="filter-row">
          {SPEEDS.map((s) => (
            <span key={s} className={`chip ${prefs.speeds.includes(s) ? 'on' : ''}`} onClick={() => toggleSpeed(s)}>
              {s === 'correspondence' ? 'Correspondence (daily)' : SPEED_NAMES[s]}
            </span>
          ))}
        </div>
      </div>
      <div className="row wrap">
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={prefs.ratedOnly} onChange={(e) => patch({ ratedOnly: e.target.checked })} />
          Rated games only
        </label>
        <span className="spacer" />
        <label className="row small muted" style={{ gap: 6 }}>
          At most
          <select className="input" value={prefs.max} onChange={(e) => patch({ max: Number(e.target.value) })}>
            {MAX_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m ? `${m} games` : 'all games'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="help">
        Newest first. Games Lichess has already analysed come with its evaluations, so they are ready sooner. Your games are public on
        Lichess, so no login is needed.
      </div>
      {busy && (
        <div className="small muted">
          Downloading… {count > 0 && `${plural(count, 'game')} so far`} (keep this window open; it takes a few seconds)
        </div>
      )}
      {error && <div className="notice error small">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={() => (busy ? abort.current?.abort() : onClose())}>
          {busy ? 'Stop' : 'Cancel'}
        </button>
        <button className="btn primary" disabled={busy || !user.trim() || !prefs.speeds.length} onClick={fetchGames}>
          <Icon name="download" size={16} /> {busy ? 'Fetching…' : 'Fetch games'}
        </button>
      </div>
    </>
  );
}

function PgnImport({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const updateProfile = useApp((s) => s.updateProfile);
  const showToast = useApp((s) => s.showToast);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);

  const parsed: PgnGamesResult | null = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parsePgnGames(text);
    } catch {
      return { games: [], skipped: [], names: [] };
    }
  }, [text]);

  const known = [profile.name, profile.lichess ?? '', ...(profile.aliases ?? [])];
  // You: a name you are known by, else the name in most games (in a file of your own games, that is you).
  const guess = parsed?.names.find((n) => colorOf({ white: n.name, black: '' }, known)) ?? parsed?.names[0];
  const chosen = me ?? guess?.name ?? null;
  const mine = parsed && chosen ? parsed.games.filter((g) => colorOf(g, [chosen])) : [];

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setText(await f.text());
      setFileName(f.name);
    } catch {
      showToast('Could not read that file');
    }
  };

  const add = () => {
    if (!chosen) return;
    const games = mine.map((g) => toPlayedGame(g, profile.id, colorOf(g, [chosen])!));
    const r = useGames.getState().addGames(games);
    if (!known.some((k) => k.toLowerCase() === chosen.toLowerCase())) updateProfile(profile.id, { aliases: [...(profile.aliases ?? []), chosen] });
    showToast(
      r.added
        ? `Added ${plural(r.added, 'game')}${r.already ? ` (${r.already} already here)` : ''}. Analysing them now…`
        : 'These games are already here.',
    );
    onClose();
  };

  return (
    <>
      <div className="muted small">
        A file with your games from any site (Chess.com: Archive → Download), or over-the-board games. Paste it or choose the file.
      </div>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), readFile(e.dataTransfer.files?.[0]))} className="stack" style={{ gap: 8 }}>
        {fileName ? (
          <div className="row file-chip">
            <Icon name="upload" size={15} />
            <b>{fileName}</b>
            <span className="spacer" />
            <button
              className="btn sm ghost"
              onClick={() => {
                setFileName(null);
                setText('');
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <textarea className="input" rows={6} value={text} spellCheck={false} placeholder="Paste PGN here, or drop a file on this window…" onChange={(e) => setText(e.target.value)} />
        )}
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <Icon name="upload" size={16} /> Choose file…
          <input
            type="file"
            accept=".pgn,text/plain"
            hidden
            onChange={(e) => {
              readFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {parsed && (
        <>
          {parsed.games.length === 0 ? (
            <div className="notice error small">No games found in this text. Is it a PGN?</div>
          ) : (
            <>
              <div className="field">
                <label>Which player is you?</label>
                <select className="input" value={chosen ?? ''} onChange={(e) => setMe(e.target.value)}>
                  {parsed.names.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name} ({plural(n.n, 'game')})
                    </option>
                  ))}
                </select>
              </div>
              <div className="small muted">
                {plural(mine.length, 'game')} with you in it
                {parsed.games.length > mine.length ? `; ${plural(parsed.games.length - mine.length, 'game')} without you are left out` : ''}.
                {mine.length > 0 && ` Analysing takes ${analysisEstimate(mine.length)}.`}
              </div>
            </>
          )}
          {parsed.skipped.length > 0 && (
            <div className="small muted">Also left out: {parsed.skipped.map((s) => `${plural(s.n, 'game')} (${s.reason})`).join(', ')}.</div>
          )}
        </>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!mine.length} onClick={add}>
          {mine.length ? `Add ${plural(mine.length, 'game')}` : 'Add'}
        </button>
      </div>
    </>
  );
}

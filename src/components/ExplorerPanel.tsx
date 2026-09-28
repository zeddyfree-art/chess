import { useState } from 'react';
import { turnOfKey, type Side } from '../lib/chess';
import type { Async } from '../lib/hooks';
import {
  AuthRequiredError,
  RATING_BUCKETS,
  ratingLabel,
  SPEED_LABELS,
  SPEEDS,
  startLogin,
  totalGames,
  type ExplorerDb,
  type ExplorerMove,
  type ExplorerResult,
} from '../lib/lichess';
import type { RepMove } from '../lib/repertoire';
import { useApp, type Profile } from '../lib/store';
import { Icon } from './Icon';

interface Props {
  positionKey: string;
  result: Async<ExplorerResult>;
  db: ExplorerDb;
  profile: Profile;
  repSide: Side;
  repMoves: RepMove[];
  /** Opponent moves above this share that are missing from the repertoire are marked as gaps. */
  gapShare: number;
  onPlay: (san: string) => void;
  onAdd: (san: string) => void;
  onHover: (uci: string | null) => void;
}

export function ExplorerPanel({ positionKey, result, db, profile, repSide, repMoves, gapShare, onPlay, onAdd, onHover }: Props) {
  const updateProfile = useApp((s) => s.updateProfile);
  const setView = useApp((s) => s.setView);
  const [showFilters, setShowFilters] = useState(false);
  const { data, error, loading } = result;
  const oppToMove = turnOfKey(positionKey) !== repSide;

  const toggle = (list: number[] | string[], v: number | string) =>
    (list as (number | string)[]).includes(v) ? (list as (number | string)[]).filter((x) => x !== v) : [...list, v];

  const filterSummary =
    db === 'masters'
      ? 'Master games (2200+ OTB)'
      : `${profile.ratings.length ? summarizeRatings(profile.ratings) : 'All ratings'} · ${
          profile.speeds.length ? profile.speeds.map((s) => SPEED_LABELS[s as keyof typeof SPEED_LABELS]).join(', ') : 'all time controls'
        }`;

  if (error instanceof AuthRequiredError) {
    return (
      <div className="notice stack">
        <div>
          <b>Connect your Lichess account</b> to use the database. Since 2026 Lichess requires a (free) login for it; your
          password never reaches this app.
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => startLogin()}>
            Log in with Lichess
          </button>
          <button className="btn ghost" onClick={() => setView('settings')}>
            Or paste a token…
          </button>
        </div>
      </div>
    );
  }

  const total = data ? totalGames(data) : 0;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button className="btn sm ghost" onClick={() => setShowFilters((v) => !v)} title="Change filters">
          <Icon name="settings" size={14} />
          <span className="muted">{filterSummary}</span>
        </button>
        <span className="spacer" />
        {loading && <span className="faint small">loading…</span>}
        {data && <span className="faint small num">{total.toLocaleString('en-US')} games</span>}
      </div>

      {showFilters && db === 'lichess' && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="filter-row">
            {RATING_BUCKETS.map((r) => (
              <span
                key={r}
                className={`chip ${profile.ratings.includes(r) ? 'on' : ''}`}
                onClick={() => updateProfile(profile.id, { ratings: (toggle(profile.ratings, r) as number[]).sort((a, b) => a - b) })}
              >
                {ratingLabel(r)}
              </span>
            ))}
          </div>
          <div className="filter-row">
            {SPEEDS.map((s) => (
              <span
                key={s}
                className={`chip ${profile.speeds.includes(s) ? 'on' : ''}`}
                onClick={() => updateProfile(profile.id, { speeds: toggle(profile.speeds, s) as string[] })}
              >
                {SPEED_LABELS[s]}
              </span>
            ))}
          </div>
          <div className="help">
            Rating = average of both players. These filters belong to the profile <b>{profile.name}</b> and are also used
            by the gap check.
          </div>
        </div>
      )}

      {error && <div className="notice error">{error.message}</div>}

      {data && !data.moves.length && <div className="empty">No games in this position with these filters.</div>}

      {data && data.moves.length > 0 && (
        <table className="explorer-table">
          <thead>
            <tr>
              <th>Move</th>
              <th>Played</th>
              <th className="col-games" style={{ textAlign: 'right' }}>
                Games
              </th>
              <th>White · draw · black</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.moves.map((m) => {
              const share = total ? totalGames(m) / total : 0;
              const inRep = repMoves.some((r) => r.san === m.san);
              const isGap = oppToMove && !inRep && repMoves.length > 0 && share >= gapShare;
              return (
                <tr
                  key={m.uci}
                  className={`clickable ${inRep ? 'in-rep' : ''} ${isGap ? 'is-gap' : ''}`}
                  onClick={() => onPlay(m.san)}
                  onMouseEnter={() => onHover(m.uci)}
                  onMouseLeave={() => onHover(null)}
                >
                  <td className="san">{m.san}</td>
                  <td style={{ width: '28%' }}>
                    <div className="pop-bar">
                      <div style={{ width: `${Math.max(2, share * 100)}%` }} />
                      <span className="num">{formatPct(share)}</span>
                    </div>
                  </td>
                  <td className="num muted col-games" style={{ textAlign: 'right' }}>
                    {compact(totalGames(m))}
                  </td>
                  <td style={{ width: '32%' }}>
                    <Wdl m={m} />
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {inRep ? (
                      <span className="badge mine" title="In your repertoire">
                        <Icon name="check" size={12} />
                      </span>
                    ) : (
                      <>
                        {isGap && <span className="badge gap">gap</span>}{' '}
                        <button
                          className="btn sm icon ghost"
                          title="Add to repertoire"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAdd(m.san);
                          }}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Wdl({ m }: { m: ExplorerMove }) {
  const t = totalGames(m) || 1;
  const w = (m.white / t) * 100;
  const d = (m.draws / t) * 100;
  const b = (m.black / t) * 100;
  return (
    <div className="wdl num" title={`White ${w.toFixed(0)}% · draw ${d.toFixed(0)}% · black ${b.toFixed(0)}%`}>
      <div className="w" style={{ width: `${w}%` }}>
        {w >= 14 ? `${w.toFixed(0)}%` : ''}
      </div>
      <div className="d" style={{ width: `${d}%` }}>
        {d >= 14 ? `${d.toFixed(0)}%` : ''}
      </div>
      <div className="b" style={{ width: `${b}%` }}>
        {b >= 14 ? `${b.toFixed(0)}%` : ''}
      </div>
    </div>
  );
}

export function formatPct(x: number): string {
  const p = x * 100;
  if (p >= 10) return `${p.toFixed(0)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  return `${p.toFixed(2)}%`;
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function summarizeRatings(ratings: number[]): string {
  const sorted = [...ratings].sort((a, b) => a - b);
  const contiguous = sorted.every((r, i) => i === 0 || RATING_BUCKETS.indexOf(r as never) === RATING_BUCKETS.indexOf(sorted[i - 1] as never) + 1);
  if (contiguous && sorted.length > 1) {
    const last = RATING_BUCKETS[RATING_BUCKETS.indexOf(sorted.at(-1) as never) + 1];
    return `${sorted[0] || '<1000'}–${last ? last - 1 : '+'}`;
  }
  return sorted.map(ratingLabel).join(', ');
}

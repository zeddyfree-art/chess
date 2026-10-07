import { useEffect, useRef, useState } from 'react';
import { formatLine } from '../lib/chess';
import { engineCheck, findGaps, lossLabel, type EngineIssue, type GapReport } from '../lib/audit';
import { AuthRequiredError, getToken, startLogin } from '../lib/lichess';
import { activeProfile, activeRep, useApp } from '../lib/store';
import { formatPct } from './ExplorerPanel';
import { Icon } from './Icon';

export function AuditView() {
  const rep = useApp(activeRep)!;
  const profile = useApp(activeProfile)!;
  const { goToSans, updateRep, setView } = useApp.getState();

  // 2% by default: a reply you meet in one of every fifty games with this colour. Your last choice is remembered.
  const [gapOpts, setGapOptsState] = useState(() => ({ minReach: Number(localStorage.getItem('gap-min-reach')) || 0.02, maxPly: 20 }));
  const setGapOpts = (fn: (o: typeof gapOpts) => typeof gapOpts) =>
    setGapOptsState((o) => {
      const next = fn(o);
      try {
        localStorage.setItem('gap-min-reach', String(next.minReach));
      } catch {
        /* ignore */
      }
      return next;
    });
  const [gapRun, setGapRun] = useState<{ done: number; line: string[] } | null>(null);
  const [gaps, setGaps] = useState<GapReport | null>(null);
  const [gapError, setGapError] = useState<Error | null>(null);

  const [engOpts, setEngOpts] = useState({ threshold: 50, maxPly: 24, localDepth: 16 });
  const [engRun, setEngRun] = useState<{ done: number; total: number; line: string[] } | null>(null);
  const [issues, setIssues] = useState<EngineIssue[] | null>(null);
  const [engError, setEngError] = useState<Error | null>(null);

  const abort = useRef<AbortController | null>(null);
  // Leaving the page stops a running check (it would otherwise keep the engine busy).
  useEffect(() => () => abort.current?.abort(), []);

  const runGaps = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setGapError(null);
    setGapRun({ done: 0, line: [] });
    try {
      const report = await findGaps(
        rep,
        { ratings: profile.ratings, speeds: profile.speeds, ...gapOpts },
        (done, line) => setGapRun({ done, line }),
        ctrl.signal,
      );
      setGaps(report);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setGapError(e as Error);
    } finally {
      setGapRun(null);
    }
  };

  const runEngine = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setEngError(null);
    setEngRun({ done: 0, total: 0, line: [] });
    try {
      const { flags, issues } = await engineCheck(rep, engOpts, (done, total, line) => setEngRun({ done, total, line }), ctrl.signal);
      updateRep(rep.id, (r) => ({ ...r, engine: { ...r.engine, ...flags } }), 'engine check', { undoable: false });
      setIssues(issues);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setEngError(e as Error);
    } finally {
      setEngRun(null);
    }
  };

  const stop = () => abort.current?.abort();

  // Engine flags saved from an earlier run, so results survive a reload.
  const storedIssues = Object.values(rep.engine).filter((f) => f.loss >= engOpts.threshold).length;

  return (
    <div className="audit-grid">
      <div className="card">
        <div className="section stack" style={{ gap: 8 }}>
          <div className="row">
            <Icon name="target" />
            <h2>Gaps in your preparation</h2>
          </div>
          <div className="help">
            Walks through your repertoire and compares every position where the opponent is to move with what is actually
            played in the Lichess database (filters of <b>{profile.name}</b>). You see which replies you are still missing,
            sorted by how often you will meet them.
          </div>
          <div className="help">
            The percentage is <b>of all your games with {rep.side === 'white' ? 'White' : 'Black'}</b> (like Chessbook): the shares of the
            opponent’s moves multiplied along the line. A reply played 10% of the time, in a position you reach in 20% of your
            games, counts as 2%. (The red boxes in the Tree look at one position at a time instead: a reply played in at least 5% of
            the games from that position.)
          </div>
          <div className="row wrap">
            <span className="muted small">Ignore what occurs in less than</span>
            {[0.005, 0.01, 0.02, 0.05].map((v) => (
              <span key={v} className={`chip ${gapOpts.minReach === v ? 'on' : ''}`} onClick={() => setGapOpts((o) => ({ ...o, minReach: v }))}>
                {formatPct(v)}
              </span>
            ))}
            <span className="muted small">of your games</span>
          </div>
          <div className="row">
            {gapRun ? (
              <>
                <button className="btn" onClick={stop}>
                  Stop
                </button>
                <span className="small muted">
                  {gapRun.done} positions checked… {formatLine(gapRun.line.slice(-6), Math.max(0, gapRun.line.length - 6))}
                </span>
              </>
            ) : (
              <button className="btn primary" onClick={runGaps}>
                Find gaps
              </button>
            )}
          </div>
          {!getToken() && (
            <div className="notice small">
              This needs your Lichess account to be connected.{' '}
              <button className="btn sm" onClick={() => startLogin()}>
                Log in with Lichess
              </button>
            </div>
          )}
          {gapError && (
            <div className="notice error">
              {gapError.message}{' '}
              {gapError instanceof AuthRequiredError && (
                <button className="btn sm" onClick={() => setView('settings')}>
                  Settings
                </button>
              )}
            </div>
          )}
        </div>
        {gaps && (
          <>
            <div className="section">
              <div className="coverage-ring">
                <span className="big-count">{Math.round(gaps.coverage * 100)}%</span>
                <span className="muted">
                  of your games stay inside your preparation until your lines end · {gaps.positions} positions checked
                </span>
              </div>
              <div className="progress" style={{ marginTop: 8 }}>
                <div style={{ width: `${gaps.coverage * 100}%`, background: 'var(--mine)' }} />
              </div>
            </div>
            <div className="section">
              <h3 style={{ marginBottom: 6 }}>Missing replies ({gaps.gaps.length})</h3>
              {gaps.gaps.length === 0 && <div className="empty">No gaps above the threshold. Nice!</div>}
              <div className="result-list">
                {gaps.gaps.map((g, i) => (
                  <div key={i} className="result-item" onClick={() => goToSans(g.line)} title="Open this position to add a reply">
                    <span className="badge gap num">{formatPct(g.reach)}</span>
                    <LineWithLast line={g.line} last={g.san} />
                    <span className="faint small num">{formatPct(g.share)} here</span>
                  </div>
                ))}
              </div>
            </div>
            {gaps.lineEnds.length > 0 && (
              <div className="section">
                <h3 style={{ marginBottom: 6 }}>Lines that end early</h3>
                <div className="help" style={{ marginBottom: 6 }}>
                  Your preparation stops here while many games continue. Not a problem, but you may want to go further.
                </div>
                <div className="result-list">
                  {gaps.lineEnds.slice(0, 15).map((g, i) => (
                    <div key={i} className="result-item" onClick={() => goToSans(g.line)}>
                      <span className="badge num">{formatPct(g.reach)}</span>
                      <span className="result-line">
                        {formatLine(g.line)} → {g.topMoves.map((m) => `${m.san} ${formatPct(m.share)}`).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {gaps.errors.length > 0 && <div className="section notice error small">{gaps.errors.slice(0, 3).join(' · ')}</div>}
          </>
        )}
      </div>

      <div className="card">
        <div className="section stack" style={{ gap: 8 }}>
          <div className="row">
            <Icon name="audit" />
            <h2>Engine check</h2>
          </div>
          <div className="help">
            Checks every move <i>you</i> play. First with the Lichess cloud evaluation (deep and fast); where there is none,
            Stockfish 19 runs in your browser. Moves clearly worse than the best move are marked (?!, ?, ??) — in the tree
            too.
          </div>
          <div className="row wrap">
            <span className="muted small">Flag from</span>
            {[30, 50, 100].map((v) => (
              <span key={v} className={`chip ${engOpts.threshold === v ? 'on' : ''}`} onClick={() => setEngOpts((o) => ({ ...o, threshold: v }))}>
                {(v / 100).toFixed(1)} pawn
              </span>
            ))}
          </div>
          <div className="row wrap">
            <span className="muted small">Local depth</span>
            {[12, 16, 20].map((v) => (
              <span key={v} className={`chip ${engOpts.localDepth === v ? 'on' : ''}`} onClick={() => setEngOpts((o) => ({ ...o, localDepth: v }))}>
                {v}
              </span>
            ))}
          </div>
          <div className="row">
            {engRun ? (
              <>
                <button className="btn" onClick={stop}>
                  Stop
                </button>
                <span className="small muted num">
                  {engRun.done}/{engRun.total} · {formatLine(engRun.line.slice(-4), Math.max(0, engRun.line.length - 4))}
                </span>
              </>
            ) : (
              <button className="btn primary" onClick={runEngine}>
                Check my moves
              </button>
            )}
          </div>
          {engRun && engRun.total > 0 && (
            <div className="progress">
              <div style={{ width: `${(engRun.done / engRun.total) * 100}%` }} />
            </div>
          )}
          {engError && <div className="notice error">{engError.message}</div>}
          {!issues && storedIssues > 0 && (
            <div className="help">
              An earlier check found {storedIssues} dubious {storedIssues === 1 ? 'move' : 'moves'} (see the tree, highlight
              “Engine doubts”).
            </div>
          )}
        </div>
        {issues && (
          <div className="section">
            <h3 style={{ marginBottom: 6 }}>Dubious moves ({issues.length})</h3>
            {issues.length === 0 && <div className="empty">All moves within the margin. 👍</div>}
            <div className="result-list">
              {issues.map((it) => {
                const l = lossLabel(it.flag.loss);
                return (
                  <div key={it.id} className="result-item" onClick={() => goToSans(it.line)}>
                    <span className="badge gap num">−{(it.flag.loss / 100).toFixed(1)}</span>
                    <LineWithLast line={it.line} last={it.san} suffix={l.symbol} />
                    <span className="small">
                      better: <b>{it.flag.bestSan}</b>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "1. e4 e5 2. Nf3 **Nc6**" – the whole line with the move in question in bold. */
function LineWithLast({ line, last, suffix = '' }: { line: string[]; last: string; suffix?: string }) {
  const prefix = formatLine(line);
  const full = formatLine([...line, last]);
  return (
    <span className="result-line">
      {prefix}
      <b>
        {full.slice(prefix.length)}
        {suffix}
      </b>
    </span>
  );
}

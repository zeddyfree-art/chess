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

  const [gapOpts, setGapOpts] = useState({ minReach: 0.01, maxPly: 20 });
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
      updateRep(rep.id, (r) => ({ ...r, engine: { ...r.engine, ...flags } }), 'engine-controle', { undoable: false });
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
            <h2>Gaten in je voorbereiding</h2>
          </div>
          <div className="help">
            Loopt je repertoire af en vergelijkt elke stelling waarin de tegenstander aan zet is met wat er echt gespeeld wordt
            in de Lichess-database (filters van <b>{profile.name}</b>). Zo zie je welke antwoorden je nog mist, gesorteerd op
            hoe vaak je ze gaat tegenkomen.
          </div>
          <div className="row wrap">
            <span className="muted small">Negeer wat voorkomt in minder dan</span>
            {[0.005, 0.01, 0.02, 0.05].map((v) => (
              <span key={v} className={`chip ${gapOpts.minReach === v ? 'on' : ''}`} onClick={() => setGapOpts((o) => ({ ...o, minReach: v }))}>
                {formatPct(v)}
              </span>
            ))}
            <span className="muted small">van je partijen</span>
          </div>
          <div className="row">
            {gapRun ? (
              <>
                <button className="btn" onClick={stop}>
                  Stoppen
                </button>
                <span className="small muted">
                  {gapRun.done} stellingen bekeken… {formatLine(gapRun.line.slice(-6), Math.max(0, gapRun.line.length - 6))}
                </span>
              </>
            ) : (
              <button className="btn primary" onClick={runGaps}>
                Zoek gaten
              </button>
            )}
          </div>
          {!getToken() && (
            <div className="notice small">
              Hiervoor moet je Lichess-account gekoppeld zijn.{' '}
              <button className="btn sm" onClick={() => startLogin()}>
                Inloggen met Lichess
              </button>
            </div>
          )}
          {gapError && (
            <div className="notice error">
              {gapError.message}{' '}
              {gapError instanceof AuthRequiredError && (
                <button className="btn sm" onClick={() => setView('settings')}>
                  Instellingen
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
                  van je partijen blijft binnen je voorbereiding tot je lijnen eindigen · {gaps.positions} stellingen bekeken
                </span>
              </div>
              <div className="progress" style={{ marginTop: 8 }}>
                <div style={{ width: `${gaps.coverage * 100}%`, background: 'var(--mine)' }} />
              </div>
            </div>
            <div className="section">
              <h3 style={{ marginBottom: 6 }}>Ontbrekende antwoorden ({gaps.gaps.length})</h3>
              {gaps.gaps.length === 0 && <div className="empty">Geen gaten boven de drempel. Mooi!</div>}
              <div className="result-list">
                {gaps.gaps.map((g, i) => (
                  <div key={i} className="result-item" onClick={() => goToSans(g.line)} title="Open deze stelling om een antwoord toe te voegen">
                    <span className="badge gap num">{formatPct(g.reach)}</span>
                    <LineWithLast line={g.line} last={g.san} />
                    <span className="faint small num">{formatPct(g.share)} hier</span>
                  </div>
                ))}
              </div>
            </div>
            {gaps.lineEnds.length > 0 && (
              <div className="section">
                <h3 style={{ marginBottom: 6 }}>Lijnen die vroeg eindigen</h3>
                <div className="help" style={{ marginBottom: 6 }}>
                  Hier stopt je voorbereiding terwijl er nog veel partijen zijn. Niet erg, maar misschien wil je verder.
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
            <h2>Engine-controle</h2>
          </div>
          <div className="help">
            Controleert elke zet die jíj speelt. Eerst met de Lichess cloud-evaluatie (diep en snel); ontbreekt die, dan rekent
            Stockfish 19 in je browser. Zetten die duidelijk slechter zijn dan de beste zet worden gemarkeerd (?!, ?, ??) — ook
            in de boom.
          </div>
          <div className="row wrap">
            <span className="muted small">Markeer vanaf</span>
            {[30, 50, 100].map((v) => (
              <span key={v} className={`chip ${engOpts.threshold === v ? 'on' : ''}`} onClick={() => setEngOpts((o) => ({ ...o, threshold: v }))}>
                {(v / 100).toFixed(1)} pion
              </span>
            ))}
          </div>
          <div className="row wrap">
            <span className="muted small">Lokale diepte</span>
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
                  Stoppen
                </button>
                <span className="small muted num">
                  {engRun.done}/{engRun.total} · {formatLine(engRun.line.slice(-4), Math.max(0, engRun.line.length - 4))}
                </span>
              </>
            ) : (
              <button className="btn primary" onClick={runEngine}>
                Controleer mijn zetten
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
              Een eerdere controle vond {storedIssues} twijfelachtige {storedIssues === 1 ? 'zet' : 'zetten'} (zie de boom, markeer
              “Engine-twijfels”).
            </div>
          )}
        </div>
        {issues && (
          <div className="section">
            <h3 style={{ marginBottom: 6 }}>Twijfelachtige zetten ({issues.length})</h3>
            {issues.length === 0 && <div className="empty">Alle zetten binnen de marge. 👍</div>}
            <div className="result-list">
              {issues.map((it) => {
                const l = lossLabel(it.flag.loss);
                return (
                  <div key={it.id} className="result-item" onClick={() => goToSans(it.line)}>
                    <span className="badge gap num">−{(it.flag.loss / 100).toFixed(1)}</span>
                    <LineWithLast line={it.line} last={it.san} suffix={l.symbol} />
                    <span className="small">
                      beter: <b>{it.flag.bestSan}</b>
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

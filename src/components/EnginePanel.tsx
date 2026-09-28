import { formatScore, whiteShare } from '../lib/engine';
import type { Evaluation } from '../lib/evaluate';

export function EvalBar({ evaluation, flipped }: { evaluation: Evaluation | null; flipped: boolean }) {
  const best = evaluation?.lines[0];
  const share = whiteShare(best);
  return (
    <div className={`eval-bar ${flipped ? 'flipped' : ''}`} title={best ? formatScore(best) : ''}>
      <div className="fill" style={{ height: `${share * 100}%` }} />
      <div className="mid" />
    </div>
  );
}

interface Props {
  evaluation: Evaluation | null;
  enabled: boolean;
  onToggle: () => void;
  onPlay: (san: string) => void;
  onHover: (uci: string | null) => void;
  startPly: number;
}

export function EnginePanel({ evaluation, enabled, onToggle, onPlay, onHover, startPly }: Props) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          Engine
        </label>
        <span className="spacer" />
        {enabled && evaluation && (
          <span className="faint small">
            {evaluation.source === 'cloud' ? 'Lichess cloud' : 'Stockfish 19 (lokaal)'} · diepte {evaluation.depth}
          </span>
        )}
        {enabled && !evaluation && <span className="faint small">rekenen…</span>}
      </div>
      {enabled && evaluation && (
        <div>
          {evaluation.lines.map((l, i) => (
            <div className="engine-line" key={i} onMouseEnter={() => onHover(l.uci[0] ?? null)} onMouseLeave={() => onHover(null)}>
              <span className="engine-score">{formatScore(l)}</span>
              <span className="engine-pv">
                {l.san.map((san, j) => {
                  const ply = startPly + j;
                  const num = ply % 2 === 0 ? `${ply / 2 + 1}. ` : j === 0 ? `${Math.floor(ply / 2) + 1}… ` : '';
                  return (
                    <span key={j}>
                      {num}
                      {j === 0 ? <b onClick={() => onPlay(san)}>{san}</b> : san}{' '}
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      )}
      {!enabled && (
        <div className="help">
          Eerst wordt de Lichess cloud-evaluatie gebruikt (diep en direct). Is die er niet, dan rekent Stockfish 19 lokaal
          in je browser.
        </div>
      )}
    </div>
  );
}

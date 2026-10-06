import { useEffect, useRef, useState } from 'react';
import { formatEval, JUDGMENT_NAMES, moveNo, winPct, type KeyMoment } from '../lib/analysis';

interface Props {
  /** Evaluation per position (0 = start), White's view. */
  evals: readonly number[];
  /** Position shown on the board. */
  current: number;
  /** Moves (SAN), for the hover label. */
  moves: readonly string[];
  moments: readonly KeyMoment[];
  phases: { middlegame: number; endgame: number };
  onSelect: (position: number) => void;
}

const HEIGHT = 120;
const PAD_TOP = 16;
const PAD_BOTTOM = 4;

/** White's winning chances through the game, like Lichess' graph: the light area is White's share, the dark
 *  area Black's. Your mistakes are marked (filled: blunder or miss, open: mistake); click to go there. */
export function EvalGraph({ evals, current, moves, moments, phases, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = evals.length - 1;
  if (n < 1) return null;
  const x = (i: number) => (i / n) * width;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const y = (cp: number) => PAD_TOP + (1 - winPct(cp) / 100) * plotH;
  const points = evals.map((e, i) => `${x(i).toFixed(1)},${y(e).toFixed(1)}`);
  const area = `M0,${HEIGHT} L${points.join(' L')} L${width},${HEIGHT} Z`;
  const line = `M${points.join(' L')}`;
  const mid = PAD_TOP + plotH / 2;

  const indexAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((clientX - r.left) / r.width) * n)));
  };

  const shown = hover ?? null;
  const label =
    shown === null
      ? null
      : shown === 0
        ? `Start · ${formatEval(evals[0])}`
        : `${moveNo(shown - 1)}${moves[shown - 1]} · ${formatEval(evals[shown])}${
            moments.find((m) => m.ply === shown - 1) ? ` · ${JUDGMENT_NAMES[moments.find((m) => m.ply === shown - 1)!.kind]}` : ''
          }`;

  const phaseMarks = [
    { at: 0, name: 'Opening' },
    { at: phases.middlegame, name: 'Middlegame' },
    { at: phases.endgame, name: 'Endgame' },
  ].filter((p) => p.at < n);

  return (
    <div
      ref={box}
      className="eval-graph"
      onPointerMove={(e) => setHover(indexAt(e.clientX))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => onSelect(indexAt(e.clientX))}
      role="img"
      aria-label="Evaluation through the game"
    >
      <svg width={width} height={HEIGHT}>
        <rect x={0} y={0} width={width} height={HEIGHT} className="eg-black" />
        <path d={area} className="eg-white" />
        <line x1={0} x2={width} y1={mid} y2={mid} className="eg-mid" />
        {phaseMarks.map((p, i) => (
          <g key={p.name}>
            {i > 0 && <line x1={x(p.at)} x2={x(p.at)} y1={0} y2={HEIGHT} className="eg-phase" />}
            <text x={x(p.at) + 4} y={11} className="eg-phase-label">
              {p.name}
            </text>
          </g>
        ))}
        <path d={line} className="eg-line" />
        <line x1={x(current)} x2={x(current)} y1={0} y2={HEIGHT} className="eg-cursor" />
        {hover !== null && hover !== current && <line x1={x(hover)} x2={x(hover)} y1={0} y2={HEIGHT} className="eg-hover" />}
        {moments.map((m) => {
          const cx = x(m.ply + 1);
          const cy = y(evals[m.ply + 1]);
          const filled = m.kind === 'blunder' || m.kind === 'miss';
          return <circle key={m.ply} cx={cx} cy={cy} r={4.5} className={filled ? 'eg-bad' : 'eg-mistake'} />;
        })}
      </svg>
      {label && <div className="eg-label">{label}</div>}
    </div>
  );
}

export function EvalGraphLegend() {
  return (
    <div className="eg-legend small muted">
      <span>
        <svg width="10" height="10">
          <circle cx="5" cy="5" r="4" className="eg-bad" />
        </svg>{' '}
        Blunder or miss
      </span>
      <span>
        <svg width="10" height="10">
          <circle cx="5" cy="5" r="3.5" className="eg-mistake" />
        </svg>{' '}
        Mistake or slip
      </span>
      <span>Light: White better · dark: Black better · click to jump</span>
    </div>
  );
}

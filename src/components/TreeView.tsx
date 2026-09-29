import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, keyToFen, moveNumber, uciToArrow } from '../lib/chess';
import { lossLabel } from '../lib/audit';
import { useKey } from '../lib/hooks';
import { explorerCacheKey, peekCache, totalGames, warmCache, type ExplorerResult } from '../lib/lichess';
import {
  buildTree,
  deleteMove,
  deletionImpact,
  findPath,
  isMine,
  movesAt,
  reachable,
  ROOT,
  toMoves,
  type Repertoire,
  type TreeNode,
} from '../lib/repertoire';
import { tokensToShapes } from '../lib/shapes';
import { State } from '../lib/srs';
import { activeProfile, activeRep, useApp, type Profile } from '../lib/store';
import { Board, type Shape } from './Board';
import { GAP_SHARE } from './BuildView';
import { ChoiceDialog, type Choice } from './Dialog';
import { formatPct } from './ExplorerPanel';
import { Icon } from './Icon';

const ROW_H = 30;
const BOX_H = 22;
const PAD = 16;
/** Horizontal room between columns: expand toggle plus the curve. */
const GUTTER = 44;
const LABEL_FONT = '600 12.5px system-ui, sans-serif';
const SMALL_FONT = '500 11px system-ui, sans-serif';

type Highlight = 'none' | 'due' | 'flags' | 'rare';

interface LNode {
  id: string;
  col: number;
  x: number;
  y: number;
  w: number;
  label: string;
  node: TreeNode | null; // null = root or gap ghost
  ghost?: { san: string; share: number };
  share?: number; // popularity of this move among the opponent's choices
  open: boolean;
  children: LNode[];
}

function explorerFor(profile: Profile, key: string): ExplorerResult | undefined {
  return peekCache<ExplorerResult>(explorerCacheKey({ db: 'lichess', fen: keyToFen(key), ratings: profile.ratings, speeds: profile.speeds }));
}

function shareOf(result: ExplorerResult | undefined, san: string): number | undefined {
  if (!result) return undefined;
  const total = totalGames(result);
  const m = result.moves.find((x) => x.san === san);
  return total ? (m ? totalGames(m) / total : 0) : undefined;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

function textWidth(text: string, font: string): number {
  const k = font + text;
  let w = widthCache.get(k);
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = font;
      w = measureCtx.measureText(text).width;
    } else w = text.length * 7.5;
    widthCache.set(k, w);
  }
  return w;
}

function boxWidth(label: string, extra?: string) {
  return Math.ceil(16 + textWidth(label, LABEL_FONT) + (extra ? 4 + textWidth(extra, SMALL_FONT) : 0));
}

export function TreeView() {
  const rep = useApp(activeRep)!;
  const profile = useApp(activeProfile)!;
  const { updateRep, showToast, undoLast, goToKey } = useApp.getState();

  const [depth, setDepth] = useState(10); // plies open by default
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight>('none');
  const [showGaps, setShowGaps] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [cacheTick, setCacheTick] = useState(0);
  const [dialog, setDialog] = useState<{ title: string; body: React.ReactNode; choices: Choice[] } | null>(null);

  const tree = useMemo(() => buildTree(rep), [rep]);

  // Pull explorer statistics we fetched earlier (browsing or gap analysis) into memory.
  useEffect(() => {
    const keys = [...reachable(rep.positions)]
      .filter((k) => !isMine(rep, k))
      .map((k) => explorerCacheKey({ db: 'lichess', fen: keyToFen(k), ratings: profile.ratings, speeds: profile.speeds }));
    warmCache(keys).then((n) => n && setCacheTick((t) => t + 1));
  }, [rep, profile.ratings, profile.speeds]);

  const byId = useMemo(() => {
    const m = new Map<string, TreeNode>();
    const walk = (ns: TreeNode[]) => ns.forEach((n) => (m.set(n.id, n), walk(n.children)));
    walk(tree);
    return m;
  }, [tree]);

  const isOpen = (n: TreeNode) => n.children.length > 0 && (n.ply < depth - 1) !== toggled.has(n.id);

  const layout = useMemo(() => {
    let row = 0;
    const nodes: LNode[] = [];
    const ghostsAt = (key: string, ply: number, prepared: string[]): LNode[] => {
      if (!showGaps || isMine(rep, key) || !prepared.length) return [];
      const result = explorerFor(profile, key);
      if (!result) return [];
      const total = totalGames(result);
      return result.moves
        .filter((m) => !prepared.includes(m.san) && total && totalGames(m) / total >= GAP_SHARE)
        .slice(0, 4)
        .map((m) => {
          const share = totalGames(m) / total;
          const label = `${moveNumber(ply, true)}${m.san}`;
          const g: LNode = {
            id: `gap:${key}:${m.san}`,
            col: ply + 1,
            x: 0,
            y: PAD + row++ * ROW_H,
            w: boxWidth(label, formatPct(share)),
            label,
            node: null,
            ghost: { san: m.san, share },
            open: false,
            children: [],
          };
          nodes.push(g);
          return g;
        });
    };
    const place = (n: TreeNode): LNode => {
      const parentStats = n.mine ? undefined : explorerFor(profile, n.from);
      // Moves outside the explorer's top list come back as 0: too rare to label.
      const rawShare = shareOf(parentStats, n.san);
      const share = rawShare ? rawShare : undefined;
      const flag = rep.engine[n.id];
      const label = `${moveNumber(n.ply, true)}${n.san}${flag ? lossLabel(flag.loss).symbol : ''}${n.transposition ? ' ↪' : ''}`;
      const ln: LNode = {
        id: n.id,
        col: n.ply + 1,
        x: 0,
        y: 0,
        w: boxWidth(label, share !== undefined ? formatPct(share) : undefined),
        label,
        node: n,
        share,
        open: isOpen(n),
        children: [],
      };
      nodes.push(ln);
      if (ln.open) ln.children = n.children.map(place);
      if (!n.transposition && (ln.open || !n.children.length)) {
        ln.children.push(...ghostsAt(n.to, n.ply + 1, movesAt(rep, n.to).map((m) => m.san)));
      }
      ln.y = ln.children.length ? (ln.children[0].y + ln.children.at(-1)!.y) / 2 : PAD + row++ * ROW_H;
      return ln;
    };
    const rootChildren = tree.map(place);
    rootChildren.push(...ghostsAt(ROOT, 0, movesAt(rep, ROOT).map((m) => m.san)));
    const root: LNode = {
      id: 'root',
      col: 0,
      x: 0,
      y: rootChildren.length ? (rootChildren[0].y + rootChildren.at(-1)!.y) / 2 : PAD,
      w: 56,
      label: 'Start',
      node: null,
      open: true,
      children: rootChildren,
    };
    nodes.push(root);
    // Columns are as wide as their widest label.
    const colW: number[] = [];
    for (const n of nodes) colW[n.col] = Math.max(colW[n.col] ?? 0, n.w);
    const colX: number[] = [];
    let x = PAD;
    for (let c = 0; c < colW.length; c++) {
      colX[c] = x;
      x += (colW[c] ?? 40) + GUTTER;
    }
    for (const n of nodes) n.x = colX[n.col];
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    return { nodes, root, width: maxX + PAD + 40, height: Math.max(row, 1) * ROW_H + PAD * 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, depth, toggled, showGaps, rep, profile, cacheTick]);

  const toggle = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const now = Date.now();
  const matches = (n: TreeNode | null): boolean => {
    if (highlight === 'none' || !n) return true;
    if (highlight === 'due') {
      const c = rep.cards[n.id];
      return !!c && c.state !== State.New && c.due <= now;
    }
    if (highlight === 'flags') return !!rep.engine[n.id] && lossLabel(rep.engine[n.id].loss).tone !== 'ok';
    if (highlight === 'rare') {
      const s = shareOf(n.mine ? undefined : explorerFor(profile, n.from), n.san);
      return s !== undefined && s < 0.02;
    }
    return true;
  };

  const focus = byId.get(hovered ?? '') ?? byId.get(selected ?? '') ?? null;
  const focusShapes = rep.shapes?.[focus ? focus.to : ROOT];
  const drawn = useMemo(() => tokensToShapes(focusShapes) as Shape[], [focusShapes]);
  const selectedNode = byId.get(selected ?? '') ?? null;

  const askPrune = (n: TreeNode) => {
    const impact = deletionImpact(rep, n.from, n.uci);
    setDialog({
      title: `Prune branch ${moveNumber(n.ply, true)}${n.san}?`,
      body: (
        <>
          This removes <b>{impact.moves}</b> {impact.moves === 1 ? 'move' : 'moves'}
          {impact.cards > 0 && (
            <>
              {' '}
              and <b>{impact.cards}</b> training card{impact.cards === 1 ? '' : 's'}
            </>
          )}
          . Positions you also reach through another move order are kept.
        </>
      ),
      choices: [
        {
          label: 'Prune',
          kind: 'danger',
          run: () => {
            updateRep(rep.id, (r) => deleteMove(r, n.from, n.uci), `pruned branch ${n.san}`);
            setSelected(null);
            showToast(`Branch pruned (${impact.moves} ${impact.moves === 1 ? 'move' : 'moves'})`, { label: 'Undo', run: undoLast });
          },
        },
      ],
    });
  };

  useKey(
    (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
        e.preventDefault();
        askPrune(selectedNode);
      }
    },
    [selectedNode, rep],
  );

  // Drag-to-pan on the background.
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const allIds = () => [...byId.values()].filter((n) => n.children.length).map((n) => n.id);

  return (
    <div className="tree-layout">
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="tree-toolbar">
          <span className="muted small">Open to move</span>
          <button className="btn sm icon" onClick={() => (setDepth((d) => Math.max(2, d - 2)), setToggled(new Set()))}>
            −
          </button>
          <b className="num" style={{ minWidth: 18, textAlign: 'center' }}>
            {Math.ceil(depth / 2)}
          </b>
          <button className="btn sm icon" onClick={() => (setDepth((d) => d + 2), setToggled(new Set()))}>
            +
          </button>
          <button className="btn sm ghost" onClick={() => (setDepth(200), setToggled(new Set()))} title="Expand all">
            <Icon name="expand" size={14} /> all
          </button>
          <button className="btn sm ghost" onClick={() => setToggled(new Set(allIds().filter((id) => byId.get(id)!.ply < depth - 1)))} title="Collapse all">
            <Icon name="collapse" size={14} /> collapse
          </button>
          <span className="spacer" />
          <select className="input" style={{ height: 28 }} value={highlight} onChange={(e) => setHighlight(e.target.value as Highlight)}>
            <option value="none">Highlight…</option>
            <option value="due">Due for review</option>
            <option value="flags">Engine doubts (?!, ?, ??)</option>
            <option value="rare">Rare moves (&lt;2%)</option>
          </select>
          <label className="row small" style={{ gap: 4 }}>
            <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} /> gaps
          </label>
          <button className="btn sm icon" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} title="Uitzoomen">
            −
          </button>
          <button className="btn sm icon" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))} title="Inzoomen">
            +
          </button>
        </div>
        <div
          ref={scroller}
          className={`tree-scroll ${dragging ? 'dragging' : ''}`}
          onMouseDown={(e) => {
            if ((e.target as Element).closest('.node, .toggle, .gap-node')) return;
            drag.current = { x: e.clientX, y: e.clientY, left: scroller.current!.scrollLeft, top: scroller.current!.scrollTop };
            setDragging(true);
          }}
          onMouseMove={(e) => {
            if (!drag.current || !scroller.current) return;
            scroller.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
            scroller.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
          }}
          onMouseUp={() => ((drag.current = null), setDragging(false))}
          onMouseLeave={() => ((drag.current = null), setDragging(false))}
        >
          {tree.length === 0 ? (
            <div className="empty" style={{ margin: 24 }}>
              This repertoire is still empty. Add moves in <b>Build</b> or import a PGN.
            </div>
          ) : (
            <svg
              className="tree-svg"
              width={layout.width * zoom}
              height={layout.height * zoom}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
            >
              <Edges root={layout.root} />
              {layout.nodes.map((ln) => {
                if (ln.ghost) {
                  return (
                    <g
                      key={ln.id}
                      className="gap-node"
                      transform={`translate(${ln.x},${ln.y - BOX_H / 2})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const parentKey = ln.id.split(':')[1];
                        goToKey(parentKey);
                      }}
                    >
                      <title>{`Not prepared: ${ln.ghost.san} (${formatPct(ln.ghost.share)} of games). Click to open.`}</title>
                      <rect width={ln.w} height={BOX_H} rx={6} />
                      <text x={8} y={15}>
                        {ln.label} <tspan className="size-label">{formatPct(ln.ghost.share)}</tspan>
                      </text>
                    </g>
                  );
                }
                if (!ln.node) {
                  return (
                    <g key={ln.id} className="node opp" transform={`translate(${ln.x},${ln.y - BOX_H / 2})`} onClick={() => goToKey(ROOT)}>
                      <rect width={ln.w} height={BOX_H} rx={6} />
                      <text x={10} y={15}>
                        {ln.label}
                      </text>
                    </g>
                  );
                }
                const n = ln.node;
                const card = rep.cards[n.id];
                const due = card && card.state !== State.New && card.due <= now;
                const cls = [
                  'node',
                  n.mine ? 'mine' : 'opp',
                  n.transposition ? 'transposition' : '',
                  selected === n.id ? 'selected' : '',
                  matches(n) ? '' : 'dim',
                ].join(' ');
                return (
                  <g key={ln.id}>
                    <g
                      className={cls}
                      transform={`translate(${ln.x},${ln.y - BOX_H / 2})`}
                      onClick={() => setSelected(n.id)}
                      onDoubleClick={() => goToKey(n.to)}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <rect width={ln.w} height={BOX_H} rx={6} />
                      <text x={8} y={15}>
                        {ln.label}
                        {ln.share !== undefined && <tspan className="size-label"> {formatPct(ln.share)}</tspan>}
                      </text>
                      {due && <circle cx={ln.w - 1} cy={1} r={4} fill="var(--due)" />}
                    </g>
                    {n.children.length > 0 && (
                      <g className="toggle" transform={`translate(${ln.x + ln.w + 9},${ln.y})`} style={{ cursor: 'pointer' }} onClick={() => toggle(n.id)}>
                        <circle r={7} />
                        <text textAnchor="middle" y={4}>
                          {ln.open ? '−' : '+'}
                        </text>
                        {!ln.open && (
                          <text className="size-label" x={12} y={4} textAnchor="start">
                            {toMoves(n.size - 1)}
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="section mini-board">
            <Board
              position={focus ? focus.to : ROOT}
              orientation={rep.side}
              movable={null}
              lastMove={focus ? uciToArrow(focus.uci) : null}
              drawn={drawn}
            />
          </div>
          <div className="section stack" style={{ gap: 10 }}>
            {selectedNode ? (
              <NodeDetails rep={rep} node={selectedNode} profile={profile} onOpen={() => goToKey(selectedNode.to)} onPrune={() => askPrune(selectedNode)} />
            ) : (
              <div className="help">
                Click a move to select it; double-click to open it on the build board. Hover over the tree to preview positions.
                Prune the selected branch with <span className="kbd">Delete</span>.
              </div>
            )}
          </div>
        </div>
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <h3>Legend</h3>
          <div className="legend" style={{ flexDirection: 'column', gap: 6 }}>
            <span>
              <i style={{ background: 'var(--mine-soft)', border: '1.5px solid var(--mine)' }} />
              Your move (a training card)
            </span>
            <span>
              <i style={{ background: 'var(--surface)', border: '1.5px solid var(--opp)' }} />
              Opponent move · % = how often it is played
            </span>
            <span>
              <i style={{ background: 'var(--gap-soft)', border: '1.5px dashed var(--gap)' }} />
              Gap: played often, not prepared
            </span>
            <span>
              <i style={{ border: '1.5px dashed var(--faint)' }} />↪ Transposition (continued elsewhere)
            </span>
            <span>
              <i style={{ background: 'var(--due)', borderRadius: '50%' }} />
              Due for review
            </span>
            <span>Line thickness = popularity (Lichess database)</span>
          </div>
        </div>
      </div>

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Edges({ root }: { root: LNode }) {
  const paths: React.ReactNode[] = [];
  const walk = (p: LNode) => {
    for (const c of p.children) {
      const x1 = p.x + p.w + (p.node?.children.length ? 16 : 0);
      const y1 = p.y;
      const x2 = c.x;
      const y2 = c.y;
      const mx = (x1 + x2) / 2;
      const width = c.share !== undefined ? 1.5 + c.share * 10 : c.ghost ? 1.5 : 2;
      paths.push(
        <path
          key={c.id}
          className={c.ghost ? 'gap-edge' : 'edge'}
          d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
          strokeWidth={width}
        />,
      );
      walk(c);
    }
  };
  walk(root);
  return <g>{paths}</g>;
}

function NodeDetails({
  rep,
  node,
  profile,
  onOpen,
  onPrune,
}: {
  rep: Repertoire;
  node: TreeNode;
  profile: Profile;
  onOpen: () => void;
  onPrune: () => void;
}) {
  const path = useMemo(() => {
    // Reconstruct the line by walking the tree down to this node.
    const find = (ns: TreeNode[], acc: string[]): string[] | null => {
      for (const n of ns) {
        if (n.id === node.id) return [...acc, n.san];
        const r = find(n.children, [...acc, n.san]);
        if (r) return r;
      }
      return null;
    };
    return find(buildTree(rep), []) ?? [node.san];
  }, [rep, node]);

  let due = 0;
  let cards = 0;
  const now = Date.now();
  const visit = (n: TreeNode) => {
    const c = rep.cards[n.id];
    if (c) {
      cards++;
      if (c.state !== State.New && c.due <= now) due++;
    }
    n.children.forEach(visit);
  };
  visit(node);
  const share = node.mine ? undefined : shareOf(explorerFor(profile, node.from), node.san);
  const flag = rep.engine[node.id];
  const comment = movesAt(rep, node.from).find((m) => m.uci === node.uci)?.comment;
  const { trainFrom, playFrom } = useApp.getState();

  return (
    <>
      <div style={{ fontWeight: 600 }}>{formatLine(path)}</div>
      <div className="row wrap">
        <span className={`badge ${isMine(rep, node.from) ? 'mine' : 'opp'}`}>{isMine(rep, node.from) ? 'your move' : 'opponent'}</span>
        <span className="badge" title={`${node.size} half-moves`}>
          {toMoves(node.size)} {toMoves(node.size) === 1 ? 'move' : 'moves'} in branch
        </span>
        <span className="badge">
          {node.leaves} {node.leaves === 1 ? 'line' : 'lines'}
        </span>
        {cards > 0 && <span className="badge accent">{cards} cards</span>}
        {due > 0 && <span className="badge due">{due} due</span>}
        {share !== undefined && <span className="badge">{formatPct(share)} played</span>}
        {flag && lossLabel(flag.loss).tone !== 'ok' && (
          <span className="badge gap">
            −{(flag.loss / 100).toFixed(1)} · better {flag.bestSan}
          </span>
        )}
        {node.transposition && <span className="badge">transposition</span>}
      </div>
      {comment && <div className="comment-text small muted">{comment}</div>}
      <div className="row wrap">
        <button className="btn primary" onClick={onOpen}>
          <Icon name="board" size={16} /> Open on board
        </button>
        <button className="btn" onClick={() => trainFrom(node.to)} title="Train the branch that starts here">
          <Icon name="train" size={16} /> Train from here
        </button>
        <button className="btn" onClick={() => playFrom(findPath(rep, node.to) ?? [])} title="Play a practice game from this position">
          <Icon name="play" size={16} /> Play from here
        </button>
        <button className="btn danger" onClick={onPrune}>
          <Icon name="scissors" size={16} /> Prune branch
        </button>
      </div>
    </>
  );
}

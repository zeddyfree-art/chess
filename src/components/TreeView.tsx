import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, keyToFen, moveNumber, uciToArrow } from '../lib/chess';
import { lossLabel } from '../lib/audit';
import { useKey } from '../lib/hooks';
import { explorerCacheKey, peekCache, totalGames, warmCache, type ExplorerResult } from '../lib/lichess';
import {
  buildTree,
  deleteMove,
  deletionImpact,
  isMine,
  movesAt,
  reachable,
  ROOT,
  type Repertoire,
  type TreeNode,
} from '../lib/repertoire';
import { State } from '../lib/srs';
import { activeProfile, activeRep, useApp, type Profile } from '../lib/store';
import { Board } from './Board';
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
  const selectedNode = byId.get(selected ?? '') ?? null;

  const askPrune = (n: TreeNode) => {
    const impact = deletionImpact(rep, n.from, n.uci);
    setDialog({
      title: `Tak ${moveNumber(n.ply, true)}${n.san} snoeien?`,
      body: (
        <>
          Dit verwijdert <b>{impact.moves}</b> {impact.moves === 1 ? 'zet' : 'zetten'}
          {impact.cards > 0 && (
            <>
              {' '}
              en <b>{impact.cards}</b> trainingskaart{impact.cards === 1 ? '' : 'en'}
            </>
          )}
          . Stellingen die je via een andere zetvolgorde bereikt blijven bewaard.
        </>
      ),
      choices: [
        {
          label: 'Snoeien',
          kind: 'danger',
          run: () => {
            updateRep(rep.id, (r) => deleteMove(r, n.from, n.uci), `tak ${n.san} gesnoeid`);
            setSelected(null);
            showToast(`Tak gesnoeid (${impact.moves} zetten)`, { label: 'Ongedaan maken', run: undoLast });
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
          <span className="muted small">Open tot zet</span>
          <button className="btn sm icon" onClick={() => (setDepth((d) => Math.max(2, d - 2)), setToggled(new Set()))}>
            −
          </button>
          <b className="num" style={{ minWidth: 18, textAlign: 'center' }}>
            {Math.ceil(depth / 2)}
          </b>
          <button className="btn sm icon" onClick={() => (setDepth((d) => d + 2), setToggled(new Set()))}>
            +
          </button>
          <button className="btn sm ghost" onClick={() => (setDepth(200), setToggled(new Set()))} title="Alles uitklappen">
            <Icon name="expand" size={14} /> alles
          </button>
          <button className="btn sm ghost" onClick={() => setToggled(new Set(allIds().filter((id) => byId.get(id)!.ply < depth - 1)))} title="Alles inklappen">
            <Icon name="collapse" size={14} /> inklappen
          </button>
          <span className="spacer" />
          <select className="input" style={{ height: 28 }} value={highlight} onChange={(e) => setHighlight(e.target.value as Highlight)}>
            <option value="none">Markeer…</option>
            <option value="due">Te herhalen</option>
            <option value="flags">Engine-twijfels (?!, ?, ??)</option>
            <option value="rare">Zeldzame zetten (&lt;2%)</option>
          </select>
          <label className="row small" style={{ gap: 4 }}>
            <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} /> gaten
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
              Dit repertoire is nog leeg. Voeg zetten toe via <b>Bouwen</b> of importeer een PGN.
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
                      <title>{`Niet voorbereid: ${ln.ghost.san} (${formatPct(ln.ghost.share)} van de partijen). Klik om te openen.`}</title>
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
                            {n.size - 1}
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
            />
          </div>
          <div className="section stack" style={{ gap: 10 }}>
            {selectedNode ? (
              <NodeDetails rep={rep} node={selectedNode} profile={profile} onOpen={() => goToKey(selectedNode.to)} onPrune={() => askPrune(selectedNode)} />
            ) : (
              <div className="help">
                Klik op een zet om hem te selecteren; dubbelklik om hem op het bouwbord te openen. Beweeg over de boom om stellingen
                te bekijken. Geselecteerde tak snoeien: <span className="kbd">Delete</span>.
              </div>
            )}
          </div>
        </div>
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <h3>Legenda</h3>
          <div className="legend" style={{ flexDirection: 'column', gap: 6 }}>
            <span>
              <i style={{ background: 'var(--mine-soft)', border: '1.5px solid var(--mine)' }} />
              Jouw zet (trainingskaart)
            </span>
            <span>
              <i style={{ background: 'var(--surface)', border: '1.5px solid var(--opp)' }} />
              Zet van de tegenstander · % = hoe vaak gespeeld
            </span>
            <span>
              <i style={{ background: 'var(--gap-soft)', border: '1.5px dashed var(--gap)' }} />
              Gat: vaak gespeeld, niet voorbereid
            </span>
            <span>
              <i style={{ border: '1.5px dashed var(--faint)' }} />↪ Transpositie (vervolg staat elders)
            </span>
            <span>
              <i style={{ background: 'var(--due)', borderRadius: '50%' }} />
              Te herhalen
            </span>
            <span>Dikte van een lijn = populariteit (uit de Lichess-database)</span>
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

  return (
    <>
      <div style={{ fontWeight: 600 }}>{formatLine(path)}</div>
      <div className="row wrap">
        <span className={`badge ${isMine(rep, node.from) ? 'mine' : 'opp'}`}>{isMine(rep, node.from) ? 'jouw zet' : 'tegenstander'}</span>
        <span className="badge">{node.size} zetten in deze tak</span>
        <span className="badge">{node.leaves} eindposities</span>
        {cards > 0 && <span className="badge accent">{cards} kaarten</span>}
        {due > 0 && <span className="badge due">{due} te herhalen</span>}
        {share !== undefined && <span className="badge">{formatPct(share)} gespeeld</span>}
        {flag && lossLabel(flag.loss).tone !== 'ok' && (
          <span className="badge gap">
            −{(flag.loss / 100).toFixed(1)} · beter {flag.bestSan}
          </span>
        )}
        {node.transposition && <span className="badge">transpositie</span>}
      </div>
      {comment && <div className="small muted">{comment}</div>}
      <div className="row wrap">
        <button className="btn primary" onClick={onOpen}>
          <Icon name="board" size={16} /> Open op bord
        </button>
        <button className="btn danger" onClick={onPrune}>
          <Icon name="scissors" size={16} /> Snoei tak
        </button>
      </div>
    </>
  );
}

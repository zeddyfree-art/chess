// Repertoire = a graph of positions (keyed by normalized FEN) with moves as edges.
// Keying by position means transpositions share their continuation, like Chessbook.
// All operations are pure and return a new Repertoire, which makes undo trivial.
import { START_KEY, turnOfKey, type PlayedMove, type Side } from './chess';

export interface RepMove {
  san: string;
  uci: string;
  to: string;
  comment?: string;
  addedAt: number;
}

export interface SrsCard {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: number;
}

export interface EngineFlag {
  /** Centipawns lost versus the engine's best move, from the repertoire side's view. */
  loss: number;
  bestSan: string;
  bestCp: number | null;
  depth: number;
  at: number;
}

export interface Repertoire {
  id: string;
  profileId: string;
  name: string;
  side: Side;
  positions: Record<string, RepMove[]>;
  notes: Record<string, string>;
  /** Arrows and circles per position, as PGN tokens ("Gc3b5", "Rc7"; see shapes.ts). Absent in older data. */
  shapes?: Record<string, string[]>;
  cards: Record<string, SrsCard>;
  engine: Record<string, EngineFlag>;
  createdAt: number;
  updatedAt: number;
}

export const ROOT = START_KEY;

export const edgeId = (from: string, uci: string) => `${from}|${uci}`;

export function splitEdgeId(id: string): { from: string; uci: string } {
  const i = id.lastIndexOf('|');
  return { from: id.slice(0, i), uci: id.slice(i + 1) };
}

export function newRepertoire(profileId: string, name: string, side: Side): Repertoire {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    profileId,
    name,
    side,
    positions: {},
    notes: {},
    cards: {},
    engine: {},
    createdAt: now,
    updatedAt: now,
  };
}

export const isMine = (rep: Repertoire, key: string) => turnOfKey(key) === rep.side;

export function movesAt(rep: Repertoire, key: string): RepMove[] {
  return rep.positions[key] ?? [];
}

export function findMove(rep: Repertoire, key: string, uci: string): RepMove | undefined {
  return movesAt(rep, key).find((m) => m.uci === uci);
}

/** Adds a sequence of moves (a line), skipping moves that are already present. */
export function addLine(rep: Repertoire, line: PlayedMove[]): Repertoire {
  if (!line.length) return rep;
  const positions = { ...rep.positions };
  const now = Date.now();
  let changed = false;
  for (const m of line) {
    const existing = positions[m.from] ?? [];
    if (existing.some((e) => e.uci === m.uci)) continue;
    positions[m.from] = [...existing, { san: m.san, uci: m.uci, to: m.to, addedAt: now }];
    changed = true;
  }
  return changed ? { ...rep, positions, updatedAt: now } : rep;
}

export function setMoveComment(rep: Repertoire, from: string, uci: string, comment: string): Repertoire {
  const moves = movesAt(rep, from).map((m) => (m.uci === uci ? { ...m, comment: comment || undefined } : m));
  return { ...rep, positions: { ...rep.positions, [from]: moves }, updatedAt: Date.now() };
}

export function setNote(rep: Repertoire, key: string, note: string): Repertoire {
  const notes = { ...rep.notes };
  if (note.trim()) notes[key] = note;
  else delete notes[key];
  return { ...rep, notes, updatedAt: Date.now() };
}

/** Sets the arrows and circles shown on a position; an empty list removes them. */
export function setShapes(rep: Repertoire, key: string, tokens: readonly string[]): Repertoire {
  const current = rep.shapes?.[key] ?? [];
  if (current.length === tokens.length && current.every((t, i) => t === tokens[i])) return rep;
  const shapes = { ...rep.shapes };
  if (tokens.length) shapes[key] = [...tokens];
  else delete shapes[key];
  return { ...rep, shapes, updatedAt: Date.now() };
}

/** Moves a move to the front of the list (first = main line in PGN export and trees). */
export function promoteMove(rep: Repertoire, from: string, uci: string): Repertoire {
  const moves = movesAt(rep, from);
  const m = moves.find((x) => x.uci === uci);
  if (!m) return rep;
  return {
    ...rep,
    positions: { ...rep.positions, [from]: [m, ...moves.filter((x) => x.uci !== uci)] },
    updatedAt: Date.now(),
  };
}

export function reachable(positions: Record<string, RepMove[]>, root = ROOT): Set<string> {
  const seen = new Set<string>([root]);
  const stack = [root];
  while (stack.length) {
    const key = stack.pop()!;
    for (const m of positions[key] ?? []) {
      if (!seen.has(m.to)) {
        seen.add(m.to);
        stack.push(m.to);
      }
    }
  }
  return seen;
}

/** Drops positions, cards, notes and engine flags that are no longer reachable from the root. */
export function garbageCollect(rep: Repertoire): Repertoire {
  const live = reachable(rep.positions);
  const positions: Record<string, RepMove[]> = {};
  for (const [k, v] of Object.entries(rep.positions)) if (live.has(k) && v.length) positions[k] = v;
  const liveEdge = (id: string) => {
    const { from, uci } = splitEdgeId(id);
    return !!positions[from]?.some((m) => m.uci === uci);
  };
  const cards = Object.fromEntries(Object.entries(rep.cards).filter(([id]) => liveEdge(id)));
  const engine = Object.fromEntries(Object.entries(rep.engine).filter(([id]) => liveEdge(id)));
  const notes = Object.fromEntries(Object.entries(rep.notes).filter(([k]) => live.has(k)));
  if (!rep.shapes) return { ...rep, positions, cards, engine, notes };
  const shapes = Object.fromEntries(Object.entries(rep.shapes).filter(([k]) => live.has(k)));
  return { ...rep, positions, cards, engine, notes, shapes };
}

function withoutEdge(rep: Repertoire, from: string, uci: string): Repertoire {
  const moves = movesAt(rep, from).filter((m) => m.uci !== uci);
  const positions = { ...rep.positions, [from]: moves };
  return { ...rep, positions, updatedAt: Date.now() };
}

/** Books, PGN and move numbers count a *move* as White's move plus Black's reply (1.e4 e5 is one move),
 *  so N half-moves (plies) make ceil(N / 2) moves. Everything the user sees is counted this way;
 *  the half-move counts stay available for tooltips. */
export const toMoves = (halfMoves: number): number => Math.ceil(halfMoves / 2);

/** Number of half-moves (edges) in a position graph. */
export function countEdges(positions: Record<string, RepMove[]>): number {
  let n = 0;
  for (const v of Object.values(positions)) n += v.length;
  return n;
}

/** Removes a move and everything that becomes unreachable because of it. */
export function deleteMove(rep: Repertoire, from: string, uci: string): Repertoire {
  return garbageCollect(withoutEdge(rep, from, uci));
}

/** How many moves disappear if this move is deleted (transposed lines that stay reachable are kept). */
export function deletionImpact(rep: Repertoire, from: string, uci: string): { moves: number; plies: number; cards: number } {
  const before = garbageCollect(rep);
  const after = deleteMove(rep, from, uci);
  const plies = countEdges(before.positions) - countEdges(after.positions);
  return {
    plies,
    moves: toMoves(plies),
    cards: Object.keys(before.cards).length - Object.keys(after.cards).length,
  };
}

export interface PathStep extends PlayedMove {
  ply: number;
}

/** Shortest move sequence from the root to `target` (BFS), or null if unreachable. */
export function findPath(rep: Repertoire, target: string): PathStep[] | null {
  if (target === ROOT) return [];
  const prev = new Map<string, { from: string; move: RepMove }>();
  const queue = [ROOT];
  const seen = new Set([ROOT]);
  while (queue.length) {
    const key = queue.shift()!;
    for (const m of movesAt(rep, key)) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      prev.set(m.to, { from: key, move: m });
      if (m.to === target) {
        const path: PathStep[] = [];
        let cur = target;
        while (cur !== ROOT) {
          const p = prev.get(cur)!;
          path.unshift({ san: p.move.san, uci: p.move.uci, from: p.from, to: cur, ply: 0 });
          cur = p.from;
        }
        path.forEach((s, i) => (s.ply = i));
        return path;
      }
      queue.push(m.to);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tree view of the graph

export interface TreeNode {
  id: string; // edge id
  from: string;
  to: string;
  san: string;
  uci: string;
  ply: number;
  mine: boolean;
  /** This position was already expanded elsewhere in the tree. */
  transposition: boolean;
  children: TreeNode[];
  /** Number of moves in this subtree (including this one). */
  size: number;
  leaves: number;
}

/** Depth-first unfolding of the graph from `root`. Each position is expanded only once;
 *  later occurrences become transposition leaves. */
export function buildTree(rep: Repertoire, root = ROOT, rootPly = 0): TreeNode[] {
  const expanded = new Set<string>([root]);
  const build = (from: string, ply: number): TreeNode[] =>
    movesAt(rep, from).map((m) => {
      const transposition = expanded.has(m.to);
      if (!transposition) expanded.add(m.to);
      const node: TreeNode = {
        id: edgeId(from, m.uci),
        from,
        to: m.to,
        san: m.san,
        uci: m.uci,
        ply,
        mine: isMine(rep, from),
        transposition,
        children: [],
        size: 1,
        leaves: 0,
      };
      if (!transposition) node.children = build(m.to, ply + 1);
      node.size += node.children.reduce((a, c) => a + c.size, 0);
      node.leaves = node.children.length ? node.children.reduce((a, c) => a + c.leaves, 0) : 1;
      return node;
    });
  return build(root, rootPly);
}

/** Pre-order list of positions where it is our move, following the tree order (for coherent training). */
export function myEdgesInOrder(rep: Repertoire): { from: string; uci: string; san: string; to: string }[] {
  const out: { from: string; uci: string; san: string; to: string }[] = [];
  const visit = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.mine) out.push({ from: n.from, uci: n.uci, san: n.san, to: n.to });
      visit(n.children);
    }
  };
  visit(buildTree(rep));
  return out;
}

export interface RepStats {
  /** Size in full moves (White's move + Black's reply), like books and PGN. */
  moves: number;
  /** The same size in half-moves. */
  plies: number;
  /** Your own moves: what you have to learn (one training card each). */
  myMoves: number;
  /** The opponent's half-moves that you prepared for. */
  oppMoves: number;
  positions: number;
  /** Number of distinct lines (variations): where a line ends. */
  lineEnds: number;
  /** Positions where we have more than one move prepared. */
  doubles: number;
  /** Longest line, in half-moves and in full moves. */
  maxDepth: number;
  longest: number;
  /** Average line length in full moves. */
  avgLine: number;
}

export function stats(rep: Repertoire): RepStats {
  const live = reachable(rep.positions);
  let myMoves = 0;
  let oppMoves = 0;
  let doubles = 0;
  for (const key of live) {
    const moves = movesAt(rep, key);
    if (isMine(rep, key)) {
      myMoves += moves.length;
      if (moves.length > 1) doubles++;
    } else oppMoves += moves.length;
  }
  let lineEnds = 0;
  let maxDepth = 0;
  let depthSum = 0;
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      maxDepth = Math.max(maxDepth, n.ply + 1);
      if (!n.children.length && !n.transposition) {
        lineEnds++;
        depthSum += toMoves(n.ply + 1);
      }
      walk(n.children);
    }
  };
  walk(buildTree(rep));
  const plies = myMoves + oppMoves;
  return {
    moves: toMoves(plies),
    plies,
    myMoves,
    oppMoves,
    positions: live.size,
    lineEnds,
    doubles,
    maxDepth,
    longest: toMoves(maxDepth),
    avgLine: lineEnds ? Math.round(depthSum / lineEnds) : 0,
  };
}

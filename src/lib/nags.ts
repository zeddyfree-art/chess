// NAGs (numeric annotation glyphs): the "$1", "$14" codes of PGN that programs show as ! ?! ± and so on.
// A NAG belongs to the move it follows, like a comment. Numbers 1-6 rate the move, 10-19 rate the position
// after it; the rest are kept and written back as they are.

export interface Nag {
  symbol: string;
  text: string;
}

export const NAGS: Record<number, Nag> = {
  1: { symbol: '!', text: 'Good move' },
  2: { symbol: '?', text: 'Mistake' },
  3: { symbol: '!!', text: 'Brilliant move' },
  4: { symbol: '??', text: 'Blunder' },
  5: { symbol: '!?', text: 'Interesting move' },
  6: { symbol: '?!', text: 'Dubious move' },
  7: { symbol: '□', text: 'Forced move' },
  8: { symbol: '□', text: 'Only move' },
  10: { symbol: '=', text: 'Equal position' },
  11: { symbol: '=', text: 'Equal chances, quiet position' },
  12: { symbol: '=', text: 'Equal chances, active position' },
  13: { symbol: '∞', text: 'Unclear position' },
  14: { symbol: '+/=', text: 'White is slightly better' },
  15: { symbol: '=/+', text: 'Black is slightly better' },
  16: { symbol: '±', text: 'White is better' },
  17: { symbol: '∓', text: 'Black is better' },
  18: { symbol: '+−', text: 'White is winning' },
  19: { symbol: '−+', text: 'Black is winning' },
  22: { symbol: 'ZZ', text: 'White is in zugzwang' },
  23: { symbol: 'ZZ', text: 'Black is in zugzwang' },
  32: { symbol: '⟳', text: 'White is ahead in development' },
  33: { symbol: '⟳', text: 'Black is ahead in development' },
  36: { symbol: '↑', text: 'White has the initiative' },
  37: { symbol: '↑', text: 'Black has the initiative' },
  40: { symbol: '→', text: 'White has the attack' },
  41: { symbol: '→', text: 'Black has the attack' },
  44: { symbol: '=/∞', text: 'White has compensation for the material' },
  45: { symbol: '=/∞', text: 'Black has compensation for the material' },
  132: { symbol: '⇆', text: 'White has counterplay' },
  133: { symbol: '⇆', text: 'Black has counterplay' },
  138: { symbol: 'TT', text: 'White is in time trouble' },
  139: { symbol: 'TT', text: 'Black is in time trouble' },
  140: { symbol: '∆', text: 'With the idea' },
  142: { symbol: '⌓', text: 'Better is' },
  145: { symbol: 'RR', text: 'Editorial comment' },
  146: { symbol: 'N', text: 'Novelty' },
};

/** What the picker offers, strongest first. */
export const MOVE_NAGS = [3, 1, 5, 6, 2, 4];
export const POSITION_NAGS = [18, 16, 14, 10, 13, 15, 17, 19];

export const isMoveNag = (n: number) => n >= 1 && n <= 6;
export const isPositionNag = (n: number) => n >= 10 && n <= 19;
const sameKind = (a: number, b: number) => (isMoveNag(a) && isMoveNag(b)) || (isPositionNag(a) && isPositionNag(b));

export function nagInfo(n: number): Nag {
  return NAGS[n] ?? { symbol: `$${n}`, text: `Annotation $${n}` };
}

/** Whatever a PGN or stored data offers, reduced to valid NAG numbers (1-255, no duplicates, sorted). */
export function cleanNags(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<number>();
  for (const n of list) if (Number.isInteger(n) && n >= 1 && n <= 255) out.add(n);
  return [...out].sort((a, b) => a - b);
}

/** Adds incoming NAGs to existing ones. What is already rated stays: a move keeps its "!" and a position
 *  its "±" when another source says something else about the same thing. */
export function mergeNags(existing: readonly number[] | undefined, incoming: readonly number[]): number[] {
  const out = [...(existing ?? [])];
  for (const n of incoming) if (!out.some((e) => e === n || sameKind(e, n))) out.push(n);
  return out.sort((a, b) => a - b);
}

/** The picker's toggle: choosing a symbol replaces the other one of its kind; choosing it again removes it. */
export function toggleNag(nags: readonly number[] | undefined, n: number): number[] {
  const current = nags ?? [];
  if (current.includes(n)) return current.filter((x) => x !== n);
  return [...current.filter((x) => !sameKind(x, n)), n].sort((a, b) => a - b);
}

/** "!?" goes right behind the move ("e4!?"); everything else follows separated by spaces ("± N"). */
export function nagText(nags: readonly number[] | undefined): { move: string; rest: string } {
  const list = nags ?? [];
  return {
    move: list.filter(isMoveNag).map((n) => nagInfo(n).symbol).join(''),
    rest: list.filter((n) => !isMoveNag(n)).map((n) => nagInfo(n).symbol).join(' '),
  };
}

export const nagTitle = (nags: readonly number[] | undefined) => (nags ?? []).map((n) => nagInfo(n).text).join(' · ');

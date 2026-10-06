// "My mistakes": positions from your own games where you went wrong, trained like the repertoire with
// spaced repetition. A card holds everything it needs (the position, the moves that are fine, the engine's
// line), so it does not depend on the game it came from being on this device.
import { type Side } from './chess';
import { explainMoment, type KeyMoment, type MomentKind } from './analysis';
import { gameLabel, gameLine, type PlayedGame } from './games';
import type { SrsCard } from './repertoire';
import { newCard, State } from './srs';

export interface MistakeCard {
  /** `m|<profile id>|<position>`: one card per position, however many games it came up in. */
  id: string;
  profileId: string;
  /** The position before your move. */
  key: string;
  side: Side;
  /** The moves from the start to this position (SAN), as in the first game it came from. */
  line: string[];
  /** What you played. */
  played: string;
  /** Moves that are fine (SAN), the engine's best first. */
  best: string[];
  /** The engine's line, starting with its best move (SAN). */
  answer: string[];
  bestEval: number;
  playedEval: number;
  reply?: string[];
  threat?: string[];
  kind: MomentKind;
  maia?: { best: number; played: number };
  rating?: number;
  /** The games where this happened. */
  games: { id: string; label: string; ply: number }[];
  card: SrsCard;
  createdAt: number;
  /** Last change to the card's content (not its training). */
  updatedAt: number;
}

export const mistakeId = (profileId: string, key: string) => `m|${profileId}|${key}`;

export function cardFromMoment(game: PlayedGame, m: KeyMoment, rating?: number, now = Date.now()): MistakeCard {
  const line = gameLine(game.moves);
  const key = m.ply === 0 ? line[0].from : line[m.ply - 1].to;
  return {
    id: mistakeId(game.profileId, key),
    profileId: game.profileId,
    key,
    side: game.myColor,
    line: line.slice(0, m.ply).map((x) => x.san),
    played: line[m.ply].san,
    best: m.best,
    answer: m.line,
    bestEval: m.bestEval,
    playedEval: m.playedEval,
    ...(m.reply ? { reply: m.reply } : {}),
    ...(m.threat ? { threat: m.threat } : {}),
    kind: m.kind,
    ...(m.maia ? { maia: m.maia } : {}),
    ...(rating ? { rating } : {}),
    games: [{ id: game.id, label: gameLabel(game), ply: m.ply }],
    card: newCard(now),
    createdAt: now,
    updatedAt: now,
  };
}

/** Adds cards; a position that already has a card only gets the new game added to it. */
export function addCards(existing: MistakeCard[], incoming: MistakeCard[]): { cards: MistakeCard[]; added: number } {
  const byId = new Map(existing.map((c) => [c.id, c]));
  let added = 0;
  for (const c of incoming) {
    const have = byId.get(c.id);
    if (!have) {
      byId.set(c.id, c);
      added++;
    } else {
      const games = [...have.games, ...c.games.filter((g) => !have.games.some((x) => x.id === g.id))];
      if (games.length !== have.games.length) byId.set(c.id, { ...have, games, updatedAt: c.updatedAt });
    }
  }
  return { cards: [...byId.values()], added };
}

export function explainCard(c: MistakeCard): string[] {
  return explainMoment({ ...c, ply: c.line.length, line: c.answer }, { played: c.played, previous: c.line.at(-1), rating: c.rating });
}

export function mistakeCounts(cards: MistakeCard[], now = Date.now()) {
  let due = 0;
  let fresh = 0;
  let learned = 0;
  for (const c of cards) {
    if (c.card.state === State.New) fresh++;
    else {
      learned++;
      if (c.card.due <= now) due++;
    }
  }
  return { due, fresh, learned, total: cards.length };
}

/** Due cards first (oldest due first), then up to `newLimit` new ones (oldest first). */
export function mistakeQueue(cards: MistakeCard[], newLimit: number, now = Date.now()): MistakeCard[] {
  const due = cards.filter((c) => c.card.state !== State.New && c.card.due <= now).sort((a, b) => a.card.due - b.card.due);
  const fresh = cards.filter((c) => c.card.state === State.New).sort((a, b) => a.createdAt - b.createdAt);
  return [...due, ...fresh.slice(0, newLimit)];
}

/** Merge for syncing: content from the side that changed it last, training from the side that trained last. */
export function mergeMistakes(a: MistakeCard[] = [], b: MistakeCard[] = []): MistakeCard[] {
  const byId = new Map(a.map((c) => [c.id, c]));
  for (const r of b) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    if (l === r) continue;
    const content = r.updatedAt > l.updatedAt ? r : l;
    const card = (r.card.last_review ?? 0) > (l.card.last_review ?? 0) ? r.card : l.card;
    const games = [...content.games, ...(content === l ? r : l).games.filter((g) => !content.games.some((x) => x.id === g.id))];
    byId.set(r.id, content.card === card && games.length === content.games.length ? content : { ...content, card, games });
  }
  // Keep the local order, new ones after.
  return [...byId.values()];
}

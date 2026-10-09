// Spaced repetition with FSRS (the algorithm modern Anki uses). One card per
// "your move" in the repertoire: position where it is your turn -> the move you play.
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { edgeId, inTrainDepth, myEdgesInOrder, splitEdgeId, type Repertoire, type SrsCard } from './repertoire';

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true });

export { Rating, State };

function toStored(card: Card): SrsCard {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.getTime(),
  };
}

export function newCard(now = Date.now()): SrsCard {
  return toStored(createEmptyCard(new Date(now)));
}

export function gradeCard(card: SrsCard, grade: Grade, now = Date.now()): SrsCard {
  return toStored(scheduler.next({ ...card, last_review: card.last_review ?? null }, now, grade).card);
}

/** Makes sure every one of your moves has a card, and removes cards for moves that are gone. */
export function syncCards(rep: Repertoire, now = Date.now()): Repertoire {
  const edges = myEdgesInOrder(rep);
  const cards: Record<string, SrsCard> = {};
  let changed = false;
  for (const e of edges) {
    const id = edgeId(e.from, e.uci);
    if (rep.cards[id]) cards[id] = rep.cards[id];
    else {
      cards[id] = newCard(now);
      changed = true;
    }
  }
  if (Object.keys(rep.cards).length !== Object.keys(cards).length) changed = true;
  return changed ? { ...rep, cards } : rep;
}

export interface TrainItem {
  id: string;
  from: string;
  uci: string;
  san: string;
  isNew: boolean;
}

/** Due reviews first (in tree order so consecutive quizzes share context), then up to `newLimit` new moves.
 *  Only moves within the repertoire's training depth. */
export function buildQueue(rep: Repertoire, opts: { newLimit: number; now?: number; subtreeOf?: Set<string> }): TrainItem[] {
  const now = opts.now ?? Date.now();
  const due: TrainItem[] = [];
  const fresh: TrainItem[] = [];
  const inDepth = inTrainDepth(rep);
  for (const e of myEdgesInOrder(rep)) {
    const id = edgeId(e.from, e.uci);
    if (opts.subtreeOf && !opts.subtreeOf.has(e.from)) continue;
    if (!inDepth(e.from)) continue;
    const card = rep.cards[id];
    if (!card) continue;
    const item = { id, from: e.from, uci: e.uci, san: e.san, isNew: card.state === State.New };
    if (item.isNew) fresh.push(item);
    else if (card.due <= now) due.push(item);
  }
  return [...due, ...fresh.slice(0, opts.newLimit)];
}

/** Cards within the training depth; `deeper`: those beyond it (they wait, with their schedule). */
export function counts(rep: Repertoire, now = Date.now()) {
  let due = 0;
  let fresh = 0;
  let learned = 0;
  let deeper = 0;
  const inDepth = inTrainDepth(rep);
  for (const [id, c] of Object.entries(rep.cards)) {
    if (rep.trainDepth && !inDepth(splitEdgeId(id).from)) {
      deeper++;
      continue;
    }
    if (c.state === State.New) fresh++;
    else {
      learned++;
      if (c.due <= now) due++;
    }
  }
  return { due, fresh, learned, total: fresh + learned, deeper };
}

export function formatInterval(ms: number): string {
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)} d`;
  const mo = d / 30.4;
  if (mo < 12) return `${Math.round(mo)} mo`;
  return `${(d / 365).toFixed(1)} y`;
}

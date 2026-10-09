// Merging app data from two devices (used by Drive sync).
//
// Each device remembers the data as it was at its last successful sync (the "base"). Comparing both
// sides with that base tells who changed what, like a three-way merge in Git:
// - A repertoire changed on one side only takes that side's version.
// - Changed on both sides: merged move by move. Moves added on either side are kept, moves deleted on
//   either side are deleted (with everything after them), and for a comment, symbol, note or drawing
//   changed on both sides the most recent edit wins.
// - Without a base (first sync of a device, or data from before this existed) nothing is deleted:
//   both sides' moves are kept.
// - Training progress is merged per card: whichever side reviewed a card last wins.
// - Whole profiles and repertoires deleted on purpose stay deleted (tombstones), unless edited later.
// - Which profile/repertoire is selected stays a per-device choice.
import { mergeMistakes } from './mistakes';
import { mergeChecks } from './checkResults';
import { garbageCollect, type EngineFlag, type RepMove, type Repertoire, type SrsCard } from './repertoire';
import { syncCards } from './srs';
import type { AppData, Profile } from './store';

type Stamped = { id: string; updatedAt?: number };

/** What a device remembers of its last sync. */
export type SyncBase = Pick<AppData, 'profiles' | 'repertoires' | 'deleted'>;

function mergeDeleted(a: Record<string, number> = {}, b: Record<string, number> = {}): Record<string, number> {
  const out = { ...a };
  for (const [id, t] of Object.entries(b)) out[id] = Math.max(out[id] ?? 0, t);
  return out;
}

function unionBy<T extends Stamped>(a: T[], b: T[], pick: (x: T, y: T) => T): T[] {
  const byId = new Map<string, T>();
  for (const x of a) byId.set(x.id, x);
  for (const y of b) {
    const x = byId.get(y.id);
    byId.set(y.id, x ? pick(x, y) : y);
  }
  // Keep the local order, append new ones.
  const order = [...a.map((x) => x.id), ...b.filter((y) => !a.some((x) => x.id === y.id)).map((y) => y.id)];
  return order.map((id) => byId.get(id)!);
}

const newer = <T extends Stamped>(x: T, y: T) => ((y.updatedAt ?? 0) > (x.updatedAt ?? 0) ? y : x);

// ---------------------------------------------------------------------------
// Repertoires

const contentKeys = new WeakMap<Repertoire, string>();

/** Everything that is edited (not trained) in a repertoire, as one comparable string. */
function contentKey(r: Repertoire): string {
  let k = contentKeys.get(r);
  if (k === undefined) {
    k = JSON.stringify([r.name, r.side, r.profileId, r.positions, r.notes, r.shapes ?? {}, r.engine, !!r.study, r.trainDepth ?? 0]);
    contentKeys.set(r, k);
  }
  return k;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const empty = (v: unknown) => v === undefined || (Array.isArray(v) && v.length === 0);

function mergeCards(a: Record<string, SrsCard>, b: Record<string, SrsCard>): Record<string, SrsCard> {
  const out = { ...a };
  for (const [id, card] of Object.entries(b)) {
    const mine = out[id];
    if (!mine || (card.last_review ?? 0) > (mine.last_review ?? 0)) out[id] = card;
  }
  return out;
}

/** Three-way merge of the edited content of one repertoire. `local` wins ties. */
function mergeContent(local: Repertoire, remote: Repertoire, base: Repertoire | undefined): Repertoire {
  const localNewer = (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0);
  /** One value (a comment, a note…): whoever changed it; if both did, the latest edit. Without a base, keep what exists. */
  function pick<T>(l: T, r: T, b: T | undefined, known: boolean): T {
    if (same(l, r)) return l;
    if (known) {
      if (same(l, b) || (empty(l) && empty(b))) return r;
      if (same(r, b) || (empty(r) && empty(b))) return l;
    } else {
      if (empty(l)) return r;
      if (empty(r)) return l;
    }
    return localNewer ? l : r;
  }

  const positions: Record<string, RepMove[]> = {};
  const keys = new Set([...Object.keys(local.positions), ...Object.keys(remote.positions)]);
  for (const key of keys) {
    const lm = local.positions[key] ?? [];
    const rm = remote.positions[key] ?? [];
    const bm = base?.positions[key] ?? [];
    const [first, second] = localNewer ? [lm, rm] : [rm, lm];
    const order = [...first, ...second.filter((m) => !first.some((x) => x.uci === m.uci))].map((m) => m.uci);
    const out: RepMove[] = [];
    for (const uci of order) {
      const l = lm.find((m) => m.uci === uci);
      const r = rm.find((m) => m.uci === uci);
      const b = bm.find((m) => m.uci === uci);
      if (l && r) {
        const comment = pick(l.comment, r.comment, b?.comment, !!b);
        const nags = pick(l.nags, r.nags, b?.nags, !!b);
        const move: RepMove = { san: l.san, uci, to: l.to, addedAt: Math.min(l.addedAt, r.addedAt) };
        if (comment) move.comment = comment;
        if (nags?.length) move.nags = nags;
        out.push(move);
      } else if (!b) {
        out.push((l ?? r)!); // added on one side
      } // else: it was there before and one side deleted it
    }
    if (out.length) positions[key] = out;
  }

  const byKey = <T,>(l: Record<string, T> = {}, r: Record<string, T> = {}, b: Record<string, T> | undefined) => {
    const out: Record<string, T> = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const v = pick(l[k], r[k], b?.[k], !!base);
      if (!empty(v) && v !== '') out[k] = v;
    }
    return out;
  };

  const engine: Record<string, EngineFlag> = { ...local.engine };
  for (const [id, flag] of Object.entries(remote.engine)) if (!engine[id] || flag.at > engine[id].at) engine[id] = flag;

  return {
    ...(localNewer ? local : remote),
    name: pick(local.name, remote.name, base?.name, !!base),
    side: pick(local.side, remote.side, base?.side, !!base),
    study: pick(!!local.study, !!remote.study, base ? !!base.study : undefined, !!base) || undefined,
    trainDepth: pick(local.trainDepth, remote.trainDepth, base?.trainDepth, !!base),
    positions,
    notes: byKey(local.notes, remote.notes, base?.notes),
    shapes: byKey(local.shapes, remote.shapes, base?.shapes),
    engine,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0),
  };
}

/** The cards of `own`, each replaced by the other side's copy when that one was reviewed later. */
function laterReviews(own: Record<string, SrsCard>, other: Record<string, SrsCard>): Record<string, SrsCard> {
  let out = own;
  for (const [id, card] of Object.entries(own)) {
    const theirs = other[id];
    if (theirs && (theirs.last_review ?? 0) > (card.last_review ?? 0)) {
      if (out === own) out = { ...own };
      out[id] = theirs;
    }
  }
  return out;
}

function mergeRepertoire(local: Repertoire, remote: Repertoire, base: Repertoire | undefined): Repertoire {
  const lk = contentKey(local);
  const rk = contentKey(remote);
  const bk = base && contentKey(base);
  // The usual case: the same content, or only one device edited it. That side's version is complete
  // (a card for each of its moves), so only the review times need merging.
  const content = lk === rk ? newer(local, remote) : bk === lk ? remote : bk === rk ? local : null;
  if (content) {
    const cards = laterReviews(content.cards, content === local ? remote.cards : local.cards);
    return cards === content.cards ? content : { ...content, cards };
  }
  // Both edited it: merge the moves, then drop cards of moves that are gone and add cards for new ones.
  const merged = mergeContent(local, remote, base);
  return syncCards(garbageCollect({ ...merged, cards: mergeCards(local.cards, remote.cards) }));
}

export function mergeData(local: AppData, remote: AppData, base?: SyncBase | null): AppData {
  const deleted = mergeDeleted(local.deleted, remote.deleted);
  const alive = (x: Stamped) => !(deleted[x.id] !== undefined && deleted[x.id] >= (x.updatedAt ?? 0));
  const baseReps = new Map((base?.repertoires ?? []).map((r) => [r.id, r]));

  const profiles = unionBy<Profile>(local.profiles, remote.profiles, newer).filter(alive);
  const profileIds = new Set(profiles.map((p) => p.id));
  const repertoires = unionBy<Repertoire>(local.repertoires, remote.repertoires, (l, r) => mergeRepertoire(l, r, baseReps.get(l.id))).filter(
    (r) => alive(r) && profileIds.has(r.profileId),
  );

  const mistakes = mergeMistakes(local.mistakes, remote.mistakes).filter(
    (m) => !(deleted[m.id] !== undefined && deleted[m.id] >= m.updatedAt) && profileIds.has(m.profileId),
  );

  const checks = mergeChecks(local.checks, remote.checks, new Set(repertoires.map((r) => r.id)));

  return {
    // Fields this version does not know (added by a newer version on another device) are kept, not dropped.
    ...remote,
    ...local,
    version: 1,
    profiles,
    repertoires,
    mistakes,
    checks,
    deleted,
    lastBackupAt: Math.max(local.lastBackupAt ?? 0, remote.lastBackupAt ?? 0) || null,
  };
}

/** Whether two versions hold the same synced content (ignores the per-device selection and the order).
 *  Items the merge took over unchanged are the same objects, so usually nothing needs comparing. */
export function sameSyncedContent(a: AppData, b: AppData): boolean {
  if (JSON.stringify(a.deleted ?? {}) !== JSON.stringify(b.deleted ?? {})) return false;
  const sameItems = <T extends { id: string }>(x: T[], y: T[]) => {
    if (x.length !== y.length) return false;
    const byId = new Map(y.map((v) => [v.id, v]));
    return x.every((v) => {
      const w = byId.get(v.id);
      return w !== undefined && (w === v || JSON.stringify(v) === JSON.stringify(w));
    });
  };
  return (
    sameItems(a.profiles, b.profiles) &&
    sameItems(a.repertoires, b.repertoires) &&
    sameItems(a.mistakes ?? [], b.mistakes ?? []) &&
    (a.checks === b.checks || JSON.stringify(a.checks ?? {}) === JSON.stringify(b.checks ?? {}))
  );
}

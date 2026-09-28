// Merging app data from two devices (used by Drive sync).
//
// Rules, in order of importance:
// - Nothing that exists on only one side is lost, unless it was explicitly deleted
//   (tombstone) after its last edit.
// - When both sides edited the same repertoire, the most recently edited version
//   wins, but training progress per card is kept from whichever side reviewed it last.
// - Which profile/repertoire is selected stays a per-device choice.
import type { Repertoire } from './repertoire';
import type { AppData, Profile } from './store';

type Stamped = { id: string; updatedAt?: number };

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

function mergeRepertoire(x: Repertoire, y: Repertoire): Repertoire {
  const base = newer(x, y);
  const other = base === x ? y : x;
  let cards = base.cards;
  for (const [id, card] of Object.entries(base.cards)) {
    const theirs = other.cards[id];
    if (theirs && (theirs.last_review ?? 0) > (card.last_review ?? 0)) {
      if (cards === base.cards) cards = { ...base.cards };
      cards[id] = theirs;
    }
  }
  return cards === base.cards ? base : { ...base, cards };
}

export function mergeData(local: AppData, remote: AppData): AppData {
  const deleted = mergeDeleted(local.deleted, remote.deleted);
  const alive = (x: Stamped) => !(deleted[x.id] !== undefined && deleted[x.id] >= (x.updatedAt ?? 0));

  const profiles = unionBy<Profile>(local.profiles, remote.profiles, newer).filter(alive);
  const profileIds = new Set(profiles.map((p) => p.id));
  const repertoires = unionBy<Repertoire>(local.repertoires, remote.repertoires, mergeRepertoire).filter(
    (r) => alive(r) && profileIds.has(r.profileId),
  );

  return {
    ...local,
    version: 1,
    profiles,
    repertoires,
    deleted,
    lastBackupAt: Math.max(local.lastBackupAt ?? 0, remote.lastBackupAt ?? 0) || null,
  };
}

/** Cheap structural comparison of the parts that sync (ignores the per-device selection). */
export function sameSyncedContent(a: AppData, b: AppData): boolean {
  const strip = (d: AppData) => JSON.stringify([d.profiles, d.repertoires, d.deleted ?? {}]);
  return strip(a) === strip(b);
}

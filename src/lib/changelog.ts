// What changed, shown once after an update ("What's new"), and in full on the About page.
//
// When a version people will notice is published: raise "version" in package.json and add an entry at the top, in
// plain words about what a player sees (not how it was built). A build without a new entry shows nothing.

export const APP_VERSION = __APP_VERSION__;

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  items: string[];
}

/** Newest first. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-11-07',
    items: [
      'Install it as an app (Settings → App and storage): its own icon and window, and it starts without a network.',
      'Training: after a mistake you play the move again at once, from memory, before going on — and the card comes back at the end of the session.',
      'Practice all lines: every line of a repertoire or a branch to its end, the most played first, without adding cards. A line with a mistake comes again.',
      'Each repertoire keeps its own settings: new moves per session, whole lines, and how deep you train.',
      'Play: practise the sidelines from any position (untick the main move and meet each other one in turn), let Maia aim at your weak spots, see your prepared move when you pick up a piece, and get each move coloured as you play.',
      'Check: rare lines to trim — the branches you meet too rarely to be worth training, to delete or keep.',
      'Thirteen boards, among them Lichess’ wood, maple and marble, and a second sound set, Wood (Settings → Sound and display).',
      'Send feedback straight from the app: at the bottom of every screen.',
    ],
  },
];

const SEEN_KEY = 'seen-version';

function seenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markVersionSeen() {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    /* ignore */
  }
}

/** What to show once after an update, or null: nothing new, already seen, or a new player (who has seen nothing older).
 *  A new player is marked as up to date at once. */
export function newsToShow(isNewPlayer: boolean): ChangelogEntry | null {
  const seen = seenVersion();
  if (seen === APP_VERSION) return null;
  if (isNewPlayer) {
    markVersionSeen();
    return null;
  }
  return CHANGELOG.find((c) => c.version === APP_VERSION) ?? null;
}

/** The feedback e-mail, with the version and device filled in so a report says what it is about. */
export function feedbackHref(app = 'Repertoire'): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const body = `\n\n\n—\n${app} ${APP_VERSION} (${__APP_COMMIT__}, ${__BUILD_DATE__})\n${ua}`;
  return `mailto:zeddyfree@gmail.com?subject=${encodeURIComponent(`${app} feedback`)}&body=${encodeURIComponent(body)}`;
}

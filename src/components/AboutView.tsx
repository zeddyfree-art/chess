import { APP_VERSION, CHANGELOG, feedbackHref } from '../lib/changelog';
import { useApp } from '../lib/store';
import { Icon } from './Icon';

const REPO = 'https://github.com/zeddyfree-art/chess';

/** Why the app exists, what it does, how it works and how to make your own version. Also reachable before
 *  any player exists (from the first screen) and as a link: …/chess/#about. */
export function AboutView({ standalone = false }: { standalone?: boolean }) {
  const setView = useApp((s) => s.setView);
  const version = `${APP_VERSION} · ${__APP_COMMIT__ === 'local' ? `${__BUILD_DATE__} (local build)` : `${__BUILD_DATE__} · ${__APP_COMMIT__}`}`;

  return (
    <article className="about">
      {standalone && (
        <button className="btn ghost" onClick={() => setView('home')}>
          <Icon name="prev" size={16} /> Back
        </button>
      )}

      <header className="about-head">
        <div className="brand-mark">♞</div>
        <div>
          <h1>About Repertoire</h1>
          <p className="muted">A free, open-source app to build, check and train chess opening repertoires. No move limit, no account, no ads.</p>
        </div>
      </header>

      <div className="card">
      <section className="section">
        <h2>Why it exists</h2>
        <p>
          I kept my opening repertoires, and my daughter’s, in Chessbook and kept running into the move limit of the free tier. I wanted
          something without limits that also shows what people at our own level actually play, checks our moves with an engine,
          drills them with spaced repetition and lets us practise against an opponent that plays like a person.
        </p>
        <p>
          I’m not a programmer, so I built it in plain-language conversations with Claude Code, an AI coding assistant, and made it
          free for everyone.
        </p>
      </section>

      <section className="section">
        <h2>What it does</h2>
        <dl className="about-list">
          <dt>Build</dt>
          <dd>
            Your repertoire on a board, with the Lichess database at your rating, master games and an engine next to it. Import PGNs
            from Chessbook, Lichess studies, Chessable or ChessBase, with their comments, arrows and symbols.
          </dd>
          <dt>Tree</dt>
          <dd>Every branch at a glance. Red dashed boxes are replies people play that you haven’t prepared.</dd>
          <dt>Check</dt>
          <dd>
            Lists the gaps by how often you will meet them, the reverse too — rare lines you could trim, or keep when they
            matter — and flags your moves the engine dislikes. The results stay (on all
            your devices) until you check again: go through them one by one from the board, each ticked off as soon as your
            repertoire deals with it. It tells you when the repertoire changed since, and checking again only redoes the new
            parts.
          </dd>
          <dt>Train</dt>
          <dd>
            One session a day for everything: the reviews of all your repertoires, your mistake cards and some new moves, with
            the same number on the Overview and in the session. Spaced repetition: every move you play is a card that comes
            back just before you would forget it, each card asking for its own move. Moves you keep missing get a different
            approach: a note, playing the position, or a simpler line. New moves come with the comments around them; when you find a move the session goes
            straight on, and its comment stays in view on the next card. For a wide repertoire, train up to an early move first and go deeper step by
            step. Practice all lines plays every line to its end, the most played first, without touching your cards.
          </dd>
          <dt>Install</dt>
          <dd>
            Install it as an app (Settings → Install the app, or Share → Add to Home Screen on an iPhone or iPad): its own icon
            and window, and it starts without a network.
          </dd>
          <dt>Play</dt>
          <dd>
            Practice games against Maia-3, a human-like opponent, at any rating from 600 to 2600, with or without a clock.
            Rated games give you a rating against Maia per tempo (bullet, blitz, rapid, classical), worked out like on
            Lichess and starting at 400, with a graph of how it moves; start a new run at 400 for a speedrun or a new opening.
            A rated game you leave waits for you, with your clock running. From any position you can practise the sidelines: untick the
            opponent's main move and meet each other one in turn, prepared or not. The opponent can also aim at your weak spots, and
            in casual games your moves are coloured as you play and your prepared move shows when you pick up a piece, for moves
            you are still learning. Your games are kept: analyse them and turn your mistakes into training cards.
          </dd>
          <dt>Games</dt>
          <dd>
            The games you played, from Lichess or a PGN file, analysed on your device: where it left your repertoire (forgotten,
            on purpose, or time to change it), which replies you still need to prepare, where it went wrong and whether players
            at your level find the better move. You look for it yourself first, with a hint if
            you want one, before the answer is shown. The mistakes you pick become a deck of their own in Train, and Insights shows
            what all your games say together: your weakest phase, the tactical themes and the clock behind your mistakes, and the
            replies your repertoires in play still lack.
          </dd>
        </dl>
      </section>

      <section className="section">
        <h2>How it works</h2>
        <ul>
          <li>
            <b>Your data stays with you.</b> Everything is stored in your browser. If you connect Google Drive, the app keeps a copy
            and backups in a folder in your own Drive (“Repertoire app”, with Sync and Backups inside), the only part of your Drive
            it can see. There is no server, no account and no tracking.
          </li>
          <li>
            <b>Several devices.</b> Each device remembers its last sync, so changes made on different devices are merged move by
            move. Google gives browser apps one-hour sessions, so after a break the app asks you to tap “Sync now”.
          </li>
          <li>
            <b>Lichess</b> provides the opening database (a free Lichess login is needed for it) and cloud evaluations. Where there
            is no cloud evaluation, Stockfish 19 runs in your browser.
          </li>
          <li>
            <b>Maia-3</b>, from the CSSLab at the University of Toronto, is a neural network trained on human games. It predicts
            what a player of a given rating would play, mistakes included, and runs in your browser after a one-time download of
            about 50 MB.
          </li>
          <li>
            <b>Spaced repetition</b> uses FSRS, the scheduler Anki also offers: a move you know well comes back after weeks, one you
            just missed comes back today.
          </li>
          <li>
            <b>Game analysis</b> follows Lichess’ public formulas for winning chances, accuracy, mistakes and game phases, and adds
            Chess.com’s “miss”: a mistake right after your opponent’s, when the chance was there. Stockfish looks at your worst
            moves twice, deeper the second time, and checks whether you overlooked a threat.
          </li>
          <li>
            <b>Positions, not move orders.</b> 1.d4 Nf6 2.c4 e6 and 1.c4 e6 2.d4 Nf6 reach the same position, so they share one
            continuation.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>Make it your own</h2>
        <p>
          We are in an era where you can shape software around the way you study, instead of adapting to someone else’s. Everything
          here is open source, so you can make your own version:
        </p>
        <ol>
          <li>
            Create a free GitHub account, open the{' '}
            <a href={REPO} target="_blank" rel="noreferrer">
              repository
            </a>{' '}
            and click <b>Fork</b>.
          </li>
          <li>
            In your fork, open <b>Actions</b> and enable the workflows, then <b>Settings → Pages → Source: GitHub Actions</b>. Every
            change on the default branch is then tested and published at <code>https://&lt;your-name&gt;.github.io/chess/</code>.
          </li>
          <li>
            Describe the change you want to an AI coding assistant such as Claude Code, which can work directly in your GitHub
            repository. Or change the code yourself: <code>npm install</code>, then <code>npm run dev</code>.
          </li>
          <li>
            For Google Drive sync in your copy, create your own Google client ID (about ten minutes, see{' '}
            <a href={`${REPO}/blob/HEAD/docs/google-drive-setup.md`} target="_blank" rel="noreferrer">
              the guide
            </a>
            ). Everything else works as it is.
          </li>
        </ol>
        <p className="muted small">
          The app is licensed under the GNU GPL v3: if you share a changed version, share its source under the same licence. Ideas
          others could use are welcome as an issue or a pull request.
        </p>
      </section>

      <section className="section">
        <h2>Credits</h2>
        <p>
          Lichess (the chessground board, chessops, the opening database and cloud evaluations), Stockfish, Maia-3 by the CSSLab at
          the University of Toronto, FSRS (ts-fsrs) and ONNX Runtime Web. The sounds were made by Enigmahack for Lichess (AGPL-3.0); the opening names come from Lichess' public-domain list
          (lichess-org/chess-openings).
          The app as a whole is free software under the GNU GPL v3.
        </p>
      </section>

      <section className="section">
        <h2>What’s new</h2>
        {CHANGELOG.map((c) => (
          <div key={c.version} className="stack" style={{ gap: 4 }}>
            <b>
              Version {c.version} <span className="faint small">· {c.date}</span>
            </b>
            <ul className="whats-new">
              {c.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="section">
        <h2>Feedback</h2>
        <p>Found a bug or have an idea? Send an e-mail (the version and your device are filled in), or open an issue on GitHub.</p>
        <div className="row wrap about-links">
          <a className="btn sm primary" href={feedbackHref()}>
            <Icon name="flag" size={14} /> Send feedback
          </a>
          <a className="btn sm" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            Report on GitHub
          </a>
          <a className="btn sm ghost" href={REPO} target="_blank" rel="noreferrer">
            <Icon name="external" size={14} /> Source code
          </a>
          <a className="btn sm ghost" href="privacy.html">
            Privacy Policy
          </a>
          <a className="btn sm ghost" href="terms.html">
            Terms of Service
          </a>
        </div>
        <p className="small faint">
          Version{' '}
          {__APP_COMMIT__ === 'local' ? (
            version
          ) : (
            <a href={`${REPO}/commit/${__APP_COMMIT__}`} target="_blank" rel="noreferrer">
              {version}
            </a>
          )}
        </p>
      </section>
      </div>
    </article>
  );
}

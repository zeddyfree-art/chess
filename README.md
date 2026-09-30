# Repertoire — build, check and train your chess openings

A web app in the spirit of Chessbook, but with **no move limit**, **several players** per device, **sync
across devices** through your own Google Drive, and a **human-like practice opponent**. Build opening
repertoires, see all branches at a glance, prune what you don't need, check your moves with an engine and
against what people at your level actually play (Lichess database), train with spaced repetition (FSRS),
and play practice games from any position.

Live: <https://zeddyfree-art.github.io/chess/> · [Privacy Policy](https://zeddyfree-art.github.io/chess/privacy.html) · [Terms of Service](https://zeddyfree-art.github.io/chess/terms.html)

![Build: your prepared move, the Lichess database at your rating, and the engine](docs/screenshots/build.png)

| | |
| --- | --- |
| ![Tree: every branch, popularity as line thickness, gaps as red dashed nodes](docs/screenshots/tree.png) | ![Check: gaps in your preparation, sorted by how often you will meet them](docs/screenshots/check.png) |
| **Tree**: the whole repertoire; red dashed nodes are replies people play that you have not prepared. | **Check**: missing replies sorted by how often you will meet them, plus a coverage percentage. |
| ![Train: spaced repetition, one card per move you play](docs/screenshots/train.png) | ![Play: a practice game against the human-like Maia-3](docs/screenshots/play.png) |
| **Train**: spaced repetition; every move you play is a card. | **Play**: a practice game against Maia-3; move tags show where the opponent's moves came from. |

*The screenshots use a demo repertoire and sample database percentages, not live Lichess numbers.*

## What's inside

| Screen | What you do there |
| --- | --- |
| **Overview** | The active player's repertoires with their size and what is due today. Sizes are counted like books and PGN do: one **move** is White's move plus Black's reply (1.e4 e5 is one move); hover a number for the half-moves, your own moves and line lengths. Each card has **Download** (PGN), **Add lines from a PGN** (paste or file) and **Delete** (with confirmation and an Undo). |
| **Build** | Board plus the current line. Moves you play are a *proposal* (dashed blue) until you **Save** (Enter) or **Discard** (Esc). Next to it: your prepared moves in this position (○ White / ● Black, with number of follow-up moves, comments, ★ main move, delete), a note per position, and tabs **Lichess games**, **Masters** and **Engine**. **Train from here** and **Play from here** start from the position on the board. Imported comments and arrows/circles show here; you can draw your own (see below). |
| **Tree** | The whole repertoire as a diagram. Green = your move, outlined = opponent move with how often it is played; line thickness = popularity; red dashed nodes = **gaps** (played often, not prepared). Collapse/expand per branch or to a depth, highlight due / dubious / rare moves. Select a node to open it, train or play from it, or **Prune branch** (Delete) — you see beforehand how many moves and cards disappear, and everything can be undone (Ctrl+Z). |
| **Train** | FSRS spaced repetition: each move you play is a card. New moves are shown first and quizzed again later in the session. **Practice lines** plays random lines through without affecting the schedule. Scoped to one branch when started with *Train from here* (review, drill the whole branch, or practice lines). |
| **Play** | Practice games against **Maia-3**, a human-like neural network, at any strength from 600 to 2600. In the opening it plays what people at that level actually play (Lichess database) or sticks to your prepared lines; afterwards it plays like a human of that rating. Tells you when you (or it) leave your repertoire; take back, copy PGN, analyse on Lichess, or open the game in Build to add moves. |
| **Check** | **Find gaps**: walks your repertoire against the Lichess database (the player's rating groups and time controls) and sorts missing replies by how often you'll meet them, with a coverage percentage. **Engine check**: rates each of your moves (?!, ?, ??) with the Lichess cloud evaluation or local Stockfish 19. |
| **Settings** | Players (name, own rating, colour, rating groups, time controls), Google Drive sync and backups, Lichess connection, PGN export/import per repertoire, backup file download/restore. |

Transpositions are recognised: the repertoire is a graph of *positions*, so 1.d4 Nf6 2.c4 e6 and 1.c4 e6 2.d4 Nf6
share their continuation.

## Your data and sync

**Autosave:** every change is written to your device within a moment, and immediately when you switch tab or close it.
The top bar shows *Saved* (or a warning if your browser blocks storage). With Google Drive connected, a repertoire edit
is uploaded about a second and a half later, and training progress as soon as a session ends (or you press Stop), not
card by card.


Everything is stored in the browser (IndexedDB) — no account, no server. Optionally connect **Google Drive**
(Settings → Sync & automatic backup) on each device you use:

- all devices share the same players, repertoires and training progress;
- a dated backup is written to the `Repertoire app` folder in your Drive once a day (last 30 kept), and can be
  restored from Settings;
- the app uses the `drive.file` permission: it can only see the files it created itself.

**Google gives browser apps one-hour sessions**, and a new one needs a tap (a website without its own server cannot
renew it silently). So when you open the app after a while, typically on a phone, it cannot fetch your latest data by
itself: a banner says *Not synced with Google Drive since …* with a **Sync now** button, and until you tap it you are
looking at this device's own copy. Local changes are kept meanwhile and go up with the next sync.

**How two devices are merged.** Each device remembers what Drive held at its last sync, so it can tell who changed what,
like a three-way merge in Git. A repertoire changed on one device only takes that version; changed on both, it is merged
move by move: lines added on either device are kept, lines pruned on either device are removed, and for a comment,
symbol, note or drawing changed on both the latest edit wins. Training progress is merged per card (the latest review
wins) and does not count as editing, so training on an old copy can never undo lines added elsewhere. Deleted players and
repertoires stay deleted.

The site owner has to create a Google OAuth client ID once: see [docs/google-drive-setup.md](docs/google-drive-setup.md).

Switching from Chessbook, Chessable or a Lichess study: export your repertoire as PGN there and choose it under
*New repertoire*. Variations, comments, arrows/circles and multiple chapters are merged.

## PGN import, comments, arrows and circles

**Adding lines to a repertoire you already have.** Use the upload icon on the repertoire's card in the Overview, *Add PGN*
in Build, or *Add PGN…* in Settings. Paste text, use *Paste from clipboard*, choose a file or drop one on the window. Before
anything is added you see what the file contains: new moves, new comments, arrows and circles, and how much is already there.
Moves you already have are kept; comments and drawings are filled in only where they are missing. If the file has a
different move of *yours* in a position where you already play something, choose **Keep both** (either counts as correct in
training) or **Keep only my move**. One **Undo** takes the whole import back. A book with hundreds of chapters (2 MB, 5,800 moves)
is read in a couple of seconds.

**Arrows and circles.** Lichess studies, Chessable and ChessBase write them into move comments as `[%cal Gc3b5,Rf4f7]` (arrows)
and `[%csl Rc7]` (circles), with the colours G/R/B/Y. The app reads them, shows them and writes them back on export:

- in **Build** on the board, and the comment of the move that led to the position is shown above the moves (that is where
  a book explains the position you are looking at); the eye button hides or shows the drawings, ✕ clears them;
- in **Tree** for the selected or hovered move, and in **Train** while a new move is being taught (not during review, so
  they do not give the answer away).

**The app's own arrows never look like annotations.** PGN only knows green, red, blue and yellow, so prepared moves are
drawn in white or black (the side that plays them) and run *under* the pieces; in a position that has annotations they are
softer still, so the author's arrows and circles stand out. The engine's best move is violet, a database move you point at
is pink. The move list uses the same ○ White / ● Black marks.

**Draw your own, like on Lichess.** Right-click and drag on the Build board for an arrow, right-click a square for a circle;
Shift or Ctrl gives red, Alt gives blue, both give yellow; drawing the same thing again removes it. Drawings belong to the
position, so they follow transpositions, are saved and synced like everything else, are undoable (Ctrl+Z) and are exported to
PGN. A click on the board never wipes them. (There is no drawing on touch screens yet; imported drawings show everywhere.)

**Annotation symbols.** The `$1`, `$14`, `!`, `?!` codes (NAGs) are kept per move and shown behind it: `e5!` for the move
rating (`!!` `!` `!?` `?!` `?` `??`), then the position rating (`+−` `±` `+/=` `=` `∞` `=/+` `∓` `−+`) and others such as `N` (novelty).
Use the `!?` button above the moves to set them yourself; they are written back on export. Unknown codes are kept as `$n`.

**Also understood.** Comments before the first move (kept as the note and drawings of the start position), arrows written as
`[%cal Ge2e4, Rd7d5]` with spaces, castling written as `0-0`, `;` comments, Lichess "From Position" games. Exports contain all
seven mandatory tags.

**What is not imported.** Chessable's setup chapters that use a pass move (`1. d4 -- 2. Nc3 --`, the opponent "does nothing") cannot
be represented in a repertoire of real games; the app tells you how many lines were cut at a pass. Clocks (`[%clk]`), engine evaluations
(`[%eval]`), Chessable's internal `[%mdl …]` codes and chess variants such as Chess960 or Atomic are ignored.

## The Lichess database

The app uses the Lichess **Opening Explorer** API (`https://explorer.lichess.org/lichess?fen=…&ratings=1600,1800&speeds=blitz,rapid`).
Ratings are groups (`0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500`, each up to the next), based on the average
rating of both players. **Since 2026 Lichess requires a login** for the explorer; the app does this with "Log in
with Lichess" (OAuth 2 with PKCE — you log in on lichess.org itself and the app only gets a token without extra
permissions), or you paste a personal token with no scopes. Requests are made one at a time and cached for 30 days.

Engine: first `https://lichess.org/api/cloud-eval` (deep precomputed evaluations, no login); otherwise
**Stockfish 19 (WASM)** runs locally in a Web Worker.

## The human-like opponent

[Maia-3](https://www.maiachess.com/) (CSSLab, University of Toronto) is a network trained on human games that predicts
the move a player of a given rating would make; one model covers 600–2600. The app runs it in the browser with
ONNX Runtime Web (±150 ms per move on a laptop), downloaded once (±50 MB) and cached. The board encoding was checked
against the reference implementation of the Maia platform. Move choice is sampled from the predicted probabilities
(very unlikely moves excluded), so it plays varied, human moves — including human mistakes. Inspired by Noctie, the
opening phase uses the Lichess database at the opponent's level while there are enough games, or your own prepared
lines if you choose so.

## Make it your own

We are in an era where you can shape software around your own way of studying, instead of adapting to someone else's.
This app was made that way: in plain-language conversations with [Claude Code](https://claude.com/claude-code), by someone
who does not program. So make it your own:

- **Change what doesn't fit you.** Fork the repository, open it with an AI coding assistant such as Claude Code, and
  describe what you want in your own words: a different training rhythm, other rating groups, your language, a new view.
- **Keep it open.** The app is GPL-3.0: you may change it and share it; if you share a changed version, share its source
  under the same licence.
- **Share back** what others could use, as an [issue](https://github.com/zeddyfree-art/chess/issues) or a pull request.

## Run locally

Requires [Node.js](https://nodejs.org) 22+.

```bash
npm install          # also copies Stockfish to public/
npm run fetch-maia   # optional: serve the Maia model locally (otherwise it is fetched from GitHub)
npm run dev          # open http://localhost:5173
npm test             # unit tests (repertoire graph, PGN, SRS, sync merge, Maia encoding)
npm run build        # production build in dist/
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` tests and builds on every push and publishes the repository's default branch to
GitHub Pages (enable once: **Settings → Pages → Source: GitHub Actions**). Optional repository variable
`GOOGLE_CLIENT_ID` enables Drive sync (see the setup guide).

## How it's built

```
src/lib/chess.ts        chessops helpers: position keys (no move counters → transpositions), SAN/UCI, castling
src/lib/repertoire.ts   data model and pure operations: add, delete + clean up, tree, paths, stats
src/lib/srs.ts          FSRS cards (ts-fsrs), training queue in tree order
src/lib/pgn.ts          PGN import (into an existing repertoire, with comments and drawings) and export
src/lib/shapes.ts       arrows and circles as PGN tokens ("Gc3b5"), conversions to chessground and chessops
src/lib/nags.ts         annotation symbols ($1 = "!", $14 = "+/=" …): table, merging, picker logic
src/lib/lichess.ts      Opening Explorer, cloud eval, Lichess OAuth PKCE, request queue + cache
src/lib/engine.ts       Stockfish worker (UCI, MultiPV); evaluate.ts: cloud first, local fallback
src/lib/audit.ts        gap/coverage analysis and engine check
src/lib/maia*.ts        Maia-3: board/move encoding, ONNX worker, download + cache
src/lib/opponent.ts     practice opponent: your lines → Lichess database → Maia
src/lib/drive.ts        Google Identity Services + Drive REST (drive.file)
src/lib/sync.ts         sync loop, daily backups; merge.ts: merging two devices' data
src/lib/store.ts        app state (zustand), undo/redo, IndexedDB persistence
src/components/         React screens: Build, Tree, Train, Play, Check, Overview, Settings
```

## Privacy

No account, no server, no analytics: your data stays in your browser, or in your own Google Drive if you connect it.
See the [Privacy Policy](https://zeddyfree-art.github.io/chess/privacy.html) and [Terms of Service](https://zeddyfree-art.github.io/chess/terms.html) (sources: `public/privacy.html`
and `public/terms.html`). Contact and bug reports: [GitHub Issues](https://github.com/zeddyfree-art/chess/issues).

## Licence and credits

The app is free software under the [GNU GPL v3](LICENSE).


Built on [chessground](https://github.com/lichess-org/chessground) and [chessops](https://github.com/niklasf/chessops)
(Lichess), [Stockfish.js](https://github.com/nmrugg/stockfish.js), [Maia-3](https://github.com/CSSLab/maia-platform-frontend)
(CSSLab) — all GPL-3.0 — plus [ONNX Runtime Web](https://onnxruntime.ai) and [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT).
Because of the GPL components, the app as a whole is distributed under GPL-3.0.

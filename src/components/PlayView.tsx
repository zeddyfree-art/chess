import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLine, keyToFen, moveFromBoard, posFromFen, START_KEY, turnOfKey, uciToArrow, type PlayedMove, type Side } from '../lib/chess';
import { loadMaia, MAIA_DOWNLOAD_MB, MAIA_MAX, MAIA_MIN, isMaiaDownloaded, useMaia } from '../lib/maia';
import { chooseOpponentMove, type MoveSource, type OpponentSettings } from '../lib/opponent';
import { findMove, movesAt, type Repertoire } from '../lib/repertoire';
import { activeProfile, activeRep, profileRating, useApp } from '../lib/store';
import { getToken } from '../lib/lichess';
import { Board } from './Board';
import { Icon } from './Icon';

interface GameConfig {
  start: PlayedMove[];
  color: Side;
  settings: OpponentSettings;
  coach: boolean;
}

export function levelName(level: number): string {
  if (level < 1000) return 'beginner';
  if (level < 1400) return 'casual player';
  if (level < 1800) return 'club player';
  if (level < 2100) return 'strong club player';
  if (level < 2400) return 'expert';
  return 'master';
}

function readPrefs(): Partial<{ level: number; mode: OpponentSettings['mode']; coach: boolean }> {
  try {
    return JSON.parse(localStorage.getItem('play-prefs') ?? '{}');
  } catch {
    return {};
  }
}

export function PlayView() {
  const [game, setGame] = useState<GameConfig | null>(null);
  const [round, setRound] = useState(0);
  if (game) return <GameSession key={round} config={game} onNew={() => setGame(null)} onRematch={() => setRound((r) => r + 1)} />;
  return <PlaySetup onStart={setGame} />;
}

function PlaySetup({ onStart }: { onStart: (g: GameConfig) => void }) {
  const rep = useApp(activeRep);
  const profile = useApp(activeProfile)!;
  const start = useApp((s) => s.playStart);
  const playFrom = useApp((s) => s.playFrom);
  const maia = useMaia();
  const prefs = readPrefs();
  const [level, setLevel] = useState(prefs.level ?? Math.min(MAIA_MAX, Math.max(MAIA_MIN, profileRating(profile))));
  const [color, setColor] = useState<Side>(rep?.side ?? 'white');
  const [mode, setMode] = useState<OpponentSettings['mode']>(prefs.mode ?? 'realistic');
  const [coach, setCoach] = useState(prefs.coach ?? true);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isMaiaDownloaded().then(setDownloaded);
  }, []);
  useEffect(() => {
    localStorage.setItem('play-prefs', JSON.stringify({ level, mode, coach }));
  }, [level, mode, coach]);

  const go = async () => {
    setError(null);
    try {
      await loadMaia();
      onStart({
        start,
        color,
        coach,
        settings: { level, playerRating: profileRating(profile), mode, speeds: profile.speeds },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = maia.status === 'downloading' || maia.status === 'loading';

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }} className="stack">
      <div className="card card-pad stack" style={{ gap: 16 }}>
        <div>
          <h2>Play a practice game</h2>
          <div className="muted">Against a human-like opponent: it plays like a real person of the chosen rating.</div>
        </div>

        <div className="field">
          <label>Start from</label>
          <div className="row wrap">
            <span>{start.length ? formatLine(start.map((m) => m.san)) : 'the starting position'}</span>
            {start.length > 0 && (
              <button className="btn sm ghost" onClick={() => playFrom([])}>
                <Icon name="x" size={14} /> from move 1
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>
            Opponent strength: <span className="num">{level}</span> <span className="muted">({levelName(level)})</span>
          </label>
          <input type="range" min={MAIA_MIN} max={MAIA_MAX} step={100} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <div className="row small faint">
            <span>{MAIA_MIN}</span>
            <span className="spacer" />
            <span>your rating ≈ {profileRating(profile)}</span>
            <span className="spacer" />
            <span>{MAIA_MAX}</span>
          </div>
        </div>

        <div className="field">
          <label>You play</label>
          <div className="row">
            <button className={`btn ${color === 'white' ? 'primary' : ''}`} onClick={() => setColor('white')}>
              ♔ White
            </button>
            <button className={`btn ${color === 'black' ? 'primary' : ''}`} onClick={() => setColor('black')}>
              ♚ Black
            </button>
          </div>
        </div>

        <div className="field">
          <label>Opponent's opening choices</label>
          <label className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'realistic'} onChange={() => setMode('realistic')} style={{ marginTop: 4 }} />
            <span>
              <b>Like real opponents</b>
              <div className="help">
                Plays what people at this level actually play (Lichess database), then thinks for itself. Tests whether your
                preparation holds up — including moves you have not prepared.
              </div>
            </span>
          </label>
          <label className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'repertoire'} onChange={() => setMode('repertoire')} style={{ marginTop: 4 }} />
            <span>
              <b>Stay inside my repertoire</b>
              <div className="help">
                Follows your prepared lines as long as they last (popular replies more often), then plays on as a human
                would. Good for rehearsing what you studied.
              </div>
            </span>
          </label>
          {!getToken() && (
            <div className="help">Tip: connect Lichess in Settings so the opponent can use real game statistics.</div>
          )}
        </div>

        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} />
          Tell me when I leave my repertoire
        </label>

        {maia.status === 'downloading' && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="small muted">Downloading Maia… {maia.progress}%</div>
            <div className="progress">
              <div style={{ width: `${maia.progress}%` }} />
            </div>
          </div>
        )}
        {(error || maia.error) && <div className="notice error small">{error || maia.error}</div>}

        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={go}>
            <Icon name="play" size={16} />{' '}
            {busy ? 'Preparing…' : downloaded === false ? `Download Maia (±${MAIA_DOWNLOAD_MB} MB) and start` : 'Start game'}
          </button>
          {downloaded === false && <span className="small muted">One-time download, then it works offline too.</span>}
        </div>
      </div>
      <div className="help">
        Opponent: Maia-3 by the CSSLab (University of Toronto) — a network trained on millions of human games that predicts
        what a player of a given rating would play. In the opening it uses the Lichess database at the same level, like Noctie.
      </div>
    </div>
  );
}

type Source = MoveSource | 'you' | 'start';

function isGameOver(key: string, history: string[]): string | null {
  const pos = posFromFen(keyToFen(key));
  const outcome = pos.outcome();
  if (outcome) {
    if (!outcome.winner) return pos.isStalemate() ? 'Draw by stalemate' : 'Draw (insufficient material)';
    return `${outcome.winner === 'white' ? 'White' : 'Black'} wins by checkmate`;
  }
  if (history.filter((k) => k === key).length >= 3) return 'Draw by threefold repetition';
  return null;
}

function GameSession({ config, onNew, onRematch }: { config: GameConfig; onNew: () => void; onRematch: () => void }) {
  const rep = useApp(activeRep);
  const { openLine, showToast } = useApp.getState();
  const [moves, setMoves] = useState<PlayedMove[]>(config.start);
  const [sources, setSources] = useState<Source[]>(config.start.map(() => 'start'));
  const [result, setResult] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: React.ReactNode; takeback?: boolean } | null>(null);
  const [orientation, setOrientation] = useState<Side>(config.color);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const key = moves.at(-1)?.to ?? START_KEY;
  const turn = turnOfKey(key);
  const myTurn = turn === config.color;
  const coachRep: Repertoire | null = config.coach && rep && rep.side === config.color ? rep : null;
  // Still inside the repertoire: every move so far is a prepared move.
  const inBook = useMemo(() => !!rep && moves.every((m) => !!findMove(rep, m.from, m.uci)), [rep, moves]);

  const history = useMemo(() => [START_KEY, ...moves.map((m) => m.to)], [moves]);

  useEffect(() => {
    const over = isGameOver(key, history);
    if (over) {
      setResult(over);
      return;
    }
    if (myTurn || result) return;
    let cancelled = false;
    setThinking(true);
    setError(null);
    const started = Date.now();
    chooseOpponentMove(rep, key, config.settings)
      .then(async (choice) => {
        // Humans take a moment; so does this opponent.
        const wait = 350 + Math.random() * 700 - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled || !alive.current || !choice) return;
        const leftBook = inBook && rep && !findMove(rep, choice.move.from, choice.move.uci) && movesAt(rep, key).length > 0;
        setMoves((ms) => [...ms, choice.move]);
        setSources((ss) => [...ss, choice.source]);
        if (coachRep && leftBook) {
          setNotice({ text: <>The opponent left your preparation with {choice.move.san} — you are on your own now.</> });
        }
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setThinking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, myTurn, result]);

  const onMove = (orig: string, dest: string) => {
    if (!myTurn || result || thinking) return;
    const m = moveFromBoard(key, orig, dest);
    if (!m) return;
    const prepared = coachRep && inBook ? movesAt(coachRep, key) : [];
    setNotice(
      prepared.length && !prepared.some((p) => p.uci === m.uci)
        ? { text: <>You left your repertoire: you prepared <b>{prepared.map((p) => p.san).join(' or ')}</b> here.</>, takeback: true }
        : null,
    );
    setMoves((ms) => [...ms, m]);
    setSources((ss) => [...ss, 'you']);
  };

  const takeBack = () => {
    // Undo your last move (and the reply to it), back to a position where it is your turn.
    for (let n = moves.length - 1; n >= config.start.length; n--) {
      if (turnOfKey(moves[n].from) !== config.color) continue;
      setMoves(moves.slice(0, n));
      setSources(sources.slice(0, n));
      setResult(null);
      setNotice(null);
      return;
    }
  };

  const sans = moves.map((m) => m.san);
  const pgn = `[Event "Practice game"]\n[White "${config.color === 'white' ? 'You' : `Maia ${config.settings.level}`}"]\n[Black "${
    config.color === 'black' ? 'You' : `Maia ${config.settings.level}`
  }"]\n\n${formatLine(sans)}${result ? '' : ' *'}\n`;
  const lastMove = useMemo(() => (moves.length ? uciToArrow(moves[moves.length - 1].uci) : null), [moves]);

  const status = result
    ? result
    : thinking
      ? `Maia ${config.settings.level} is thinking…`
      : myTurn
        ? 'Your move'
        : '';

  return (
    <div className="train">
      <div className="board-area">
        <Board
          position={key}
          orientation={orientation}
          movable={myTurn && !result && !thinking ? config.color : null}
          lastMove={lastMove}
          onMove={onMove}
        />
      </div>
      <div className="stack">
        <div className="card card-pad stack">
          <div className="row">
            <span className="avatar" style={{ background: '#6b5bd6', width: 28, height: 28 }}>
              M
            </span>
            <div>
              <b>Maia {config.settings.level}</b>
              <div className="small muted">{levelName(config.settings.level)} · plays {config.color === 'white' ? 'Black' : 'White'}</div>
            </div>
            <span className="spacer" />
            {inBook && rep && <span className="badge mine">in your repertoire</span>}
          </div>
          <div className={`feedback ${result ? 'info' : myTurn ? 'good' : 'info'}`}>{status}</div>
          {notice && (
            <div className="notice small row wrap">
              <span style={{ flex: 1 }}>{notice.text}</span>
              {notice.takeback && (
                <button className="btn sm" onClick={takeBack}>
                  Take back
                </button>
              )}
            </div>
          )}
          {error && <div className="notice error small">{error}</div>}
          <MoveList moves={moves} sources={sources} />
          <div className="row wrap">
            <button className="btn" onClick={takeBack} disabled={thinking || moves.length <= config.start.length}>
              <Icon name="undo" size={16} /> Take back
            </button>
            {!result ? (
              <button className="btn" onClick={() => setResult(`${config.color === 'white' ? 'Black' : 'White'} wins (you resigned)`)}>
                <Icon name="flag" size={16} /> Resign
              </button>
            ) : (
              <button className="btn primary" onClick={onRematch}>
                <Icon name="refresh" size={16} /> Play again
              </button>
            )}
            <button className="btn icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip board">
              <Icon name="flip" />
            </button>
          </div>
          <div className="row wrap">
            <button className="btn sm ghost" onClick={() => openLine(moves)} title="Load this game on the build board to add moves to your repertoire">
              <Icon name="board" size={14} /> Open in Build
            </button>
            <button
              className="btn sm ghost"
              onClick={() => navigator.clipboard?.writeText(pgn).then(() => showToast('PGN copied'), () => showToast('Could not copy'))}
            >
              <Icon name="copy" size={14} /> Copy PGN
            </button>
            <a
              className="btn sm ghost"
              href={`https://lichess.org/analysis/pgn/${encodeURIComponent(formatLine(sans).replace(/ /g, '_'))}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={14} /> Analyse on Lichess
            </a>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={onNew}>
              New game…
            </button>
          </div>
        </div>
        <div className="help">
          Tags: <span className="badge mine">book</span> your prepared line · <span className="badge accent">db</span> Lichess
          games at this level · <span className="badge">maia</span> the network's own choice.
        </div>
      </div>
    </div>
  );
}

function MoveList({ moves, sources }: { moves: PlayedMove[]; sources: Source[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [moves.length]);
  if (!moves.length) return <div className="small faint">No moves yet.</div>;
  const tag = (s: Source) =>
    s === 'repertoire' ? <span className="badge mine">book</span> : s === 'database' ? <span className="badge accent">db</span> : s === 'maia' ? <span className="badge">maia</span> : null;
  return (
    <div style={{ maxHeight: 220, overflow: 'auto', lineHeight: 2 }}>
      {moves.map((m, i) => (
        <span key={i} style={{ marginRight: 6, whiteSpace: 'nowrap', opacity: sources[i] === 'start' ? 0.6 : 1 }}>
          {i % 2 === 0 && <span className="faint">{i / 2 + 1}. </span>}
          <b>{m.san}</b> {tag(sources[i])}
        </span>
      ))}
      <div ref={end} />
    </div>
  );
}

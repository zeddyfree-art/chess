import { useMemo, useState } from 'react';
import { divide, formatEval, isLearnable, JUDGMENT_NAMES, moveNo, summarize, type KeyMoment } from '../lib/analysis';
import { needsAnalysis, pauseQueue, useAnalysisQueue } from '../lib/analyzer';
import { START_KEY } from '../lib/chess';
import { gameLabel, gameLine, outcome, SPEED_NAMES, type GameSpeed, type PlayedGame } from '../lib/games';
import { gamesOf, useGames } from '../lib/gamesStore';
import { cardFromMoment, mistakeId } from '../lib/mistakes';
import { activeProfile, useApp } from '../lib/store';
import { keepAwakeWanted, setKeepAwake, wakeLockSupported } from '../lib/wakeLock';
import { Dialog } from './Dialog';
import { GameReview } from './GameReview';
import { Icon } from './Icon';
import { fetchNewLichessGames, hasFetchedBefore, ImportGamesDialog } from './ImportGamesDialog';
import { InsightsView } from './InsightsView';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function GamesView() {
  const openId = useApp((s) => s.openGameId);
  const game = useGames((s) => (openId ? s.data.games.find((g) => g.id === openId) : undefined));
  if (openId && game) return <GameReview key={game.id} game={game} />;
  return <GamesList />;
}

/** A moment of a game that could become a training card. */
export interface Suggestion {
  game: PlayedGame;
  moment: KeyMoment;
  /** The position already has a card. */
  carded: boolean;
}

/** Your mistakes in analysed games that are not cards yet and that you did not set aside. */
export function suggestionsFor(games: PlayedGame[], cardIds: Set<string>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const game of games) {
    const a = game.analysis;
    if (!a || needsAnalysis(game)) continue;
    const line = gameLine(game.moves);
    for (const moment of a.moments) {
      if (game.dismissed?.includes(moment.ply)) continue;
      const key = moment.ply === 0 ? START_KEY : line[moment.ply - 1]?.to;
      if (!key) continue;
      const carded = cardIds.has(mistakeId(game.profileId, key));
      if (!carded) out.push({ game, moment, carded });
    }
  }
  return out;
}

function GamesList() {
  const profile = useApp(activeProfile)!;
  const mistakes = useApp((s) => s.data.mistakes);
  const all = useGames((s) => s.data);
  const queue = useAnalysisQueue();
  const games = useMemo(() => gamesOf(all, profile.id), [all, profile.id]);
  const [importing, setImporting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [speed, setSpeed] = useState<GameSpeed | null>(null);
  const [limit, setLimit] = useState(60);
  const [tab, setTabState] = useState<'games' | 'insights'>(() => (localStorage.getItem('games-tab') === 'insights' ? 'insights' : 'games'));
  const [fetching, setFetching] = useState(false);
  const setTab = (t: 'games' | 'insights') => {
    setTabState(t);
    try {
      localStorage.setItem('games-tab', t);
    } catch {
      /* ignore */
    }
  };
  const showToast = useApp((s) => s.showToast);
  const fetchNew = async () => {
    setFetching(true);
    try {
      const r = await fetchNewLichessGames(profile);
      if (!r) setImporting(true);
      else showToast(r.added ? `${plural(r.added, 'new game')} from Lichess. Analysing…` : 'No new games on Lichess.');
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setFetching(false);
    }
  };

  const cardIds = useMemo(() => new Set((mistakes ?? []).map((m) => m.id)), [mistakes]);
  const suggestions = useMemo(() => suggestionsFor(games, cardIds), [games, cardIds]);
  const waiting = games.filter(needsAnalysis).length;
  const speeds = [...new Set(games.map((g) => g.speed).filter(Boolean))] as GameSpeed[];
  const shown = speed ? games.filter((g) => g.speed === speed) : games;
  const current = queue.current ? all.games.find((g) => g.id === queue.current) : undefined;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }} className="stack">
      <div className="card card-pad stack">
        <div className="row wrap">
          <h2>Games</h2>
          <span className="muted">{profile.name}</span>
          <span className="spacer" />
          {profile.lichess && hasFetchedBefore(profile.id) && (
            <button className="btn" disabled={fetching} onClick={fetchNew} title={`New games of ${profile.lichess} since the last fetch`}>
              <Icon name="refresh" size={16} /> {fetching ? 'Fetching…' : 'Fetch new'}
            </button>
          )}
          <button className="btn primary" onClick={() => setImporting(true)}>
            <Icon name="download" size={16} /> Add games
          </button>
        </div>
        {games.length > 0 && (
          <div className="deck-tabs view-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'games'} className={tab === 'games' ? 'on' : ''} onClick={() => setTab('games')}>
              Games <span className="faint">{games.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'insights'} className={tab === 'insights' ? 'on' : ''} onClick={() => setTab('insights')}>
              Insights
            </button>
          </div>
        )}

        {games.length === 0 ? (
          <div className="empty stack" style={{ gap: 10 }}>
            <div>
              Bring in the games you played, from Lichess or a PGN file. Each game is analysed on this device: where it went wrong
              (opening, middlegame, endgame), blunders and missed chances, and which mistakes are worth learning at your level.
            </div>
            <div>The mistakes you choose become cards in Train → My mistakes: “you played this, what is better?”</div>
            <div>
              <button className="btn primary" onClick={() => setImporting(true)}>
                <Icon name="download" size={16} /> Add your first games
              </button>
            </div>
          </div>
        ) : (
          <>
            {(waiting > 0 || queue.error) && <AnalysisNotice waiting={waiting} current={current} />}
            {tab === 'games' && suggestions.length > 0 && (
              <div className="notice row wrap suggest-banner">
                <Icon name="target" size={16} />
                <span style={{ flex: 1 }}>
                  <b>{plural(suggestions.length, 'mistake')}</b> from your games could become training cards.
                </span>
                <button className="btn sm primary" onClick={() => setChoosing(true)}>
                  Choose cards
                </button>
              </div>
            )}
            {tab === 'games' && speeds.length > 1 && (
              <div className="filter-row">
                <span className={`chip ${speed === null ? 'on' : ''}`} onClick={() => setSpeed(null)}>
                  All ({games.length})
                </span>
                {speeds.map((s) => (
                  <span key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeed(s)}>
                    {SPEED_NAMES[s]} ({games.filter((g) => g.speed === s).length})
                  </span>
                ))}
              </div>
            )}
            {tab === 'games' && (
              <div className="game-list">
                {shown.slice(0, limit).map((g) => (
                  <GameRow key={g.id} game={g} analysing={queue.current === g.id} />
                ))}
              </div>
            )}
            {tab === 'games' && shown.length > limit && (
              <button className="btn ghost" onClick={() => setLimit((l) => l + 100)}>
                Show more ({shown.length - limit})
              </button>
            )}
          </>
        )}
      </div>
      {games.length > 0 && tab === 'insights' && (
        <InsightsView games={games} profileId={profile.id} suggestions={suggestions.length} onChoose={() => setChoosing(true)} />
      )}
      {importing && <ImportGamesDialog profile={profile} onClose={() => setImporting(false)} />}
      {choosing && <ChooseCardsDialog suggestions={suggestions} onClose={() => setChoosing(false)} />}
    </div>
  );
}

/** How the analysis is doing, and what happens if you leave. */
function AnalysisNotice({ waiting, current }: { waiting: number; current?: PlayedGame }) {
  const queue = useAnalysisQueue();
  const [awake, setAwake] = useState(keepAwakeWanted);
  return (
    <div className="notice small stack" style={{ gap: 6 }}>
      <div className="row wrap">
        {queue.error ? (
          <span style={{ flex: 1 }}>{queue.error}</span>
        ) : (
          <span style={{ flex: 1 }}>
            {queue.paused
              ? `Analysis paused · ${plural(waiting, 'game')} to go.`
              : queue.held
                ? `Analysis waits while you play · ${plural(waiting, 'game')} to go.`
                : current
                  ? `Analysing ${gameLabel(current)} · ${Math.round(queue.progress * 100)}% · ${plural(waiting, 'game')} to go`
                  : `${plural(waiting, 'game')} waiting for analysis.`}
          </span>
        )}
        <button className="btn sm" onClick={() => pauseQueue(!queue.paused)}>
          {queue.paused || queue.error ? 'Resume' : 'Pause'}
        </button>
      </div>
      {!queue.paused && !queue.error && (
        <div className="muted">
          It runs while the app is open: you can use the rest of the app and other tabs meanwhile. If you close the app, or a phone locks
          its screen or switches apps, it pauses and carries on the next time you open the app. Finished games are kept; at most
          the game in progress starts again.
        </div>
      )}
      {wakeLockSupported && queue.running && (
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={awake}
            onChange={(e) => {
              setAwake(e.target.checked);
              setKeepAwake(e.target.checked);
            }}
          />
          Keep the screen on until it is done
        </label>
      )}
    </div>
  );
}

/** In the top bar while games are being analysed (elsewhere than in Games): how many are left. */
export function AnalysisPill() {
  const queue = useAnalysisQueue();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const waiting = useGames((s) => s.data.games.filter(needsAnalysis).length);
  if (view === 'games' || !waiting || !(queue.running || queue.held)) return null;
  return (
    <button
      className="btn sm ghost analysis-pill"
      onClick={() => setView('games')}
      title={queue.held ? `Game analysis waits while you play (${waiting} to go)` : `Analysing your games: ${waiting} to go`}
    >
      <Icon name="games" size={14} />
      <span className="num">{waiting}</span>
    </button>
  );
}

const RESULT_BADGE = { win: ['W', 'mine'], loss: ['L', 'gap'], draw: ['½', ''] } as const;

function GameRow({ game, analysing }: { game: PlayedGame; analysing: boolean }) {
  const openGame = useApp((s) => s.openGame);
  const o = outcome(game);
  const [letter, cls] = o ? RESULT_BADGE[o] : ['·', ''];
  const a = !needsAnalysis(game) ? game.analysis : undefined;
  const summary = useMemo(() => {
    if (!a) return null;
    const keys = [START_KEY, ...gameLine(game.moves).map((m) => m.to)];
    return summarize(a.evals, divide(keys), game.myColor);
  }, [a, game.moves, game.myColor]);

  return (
    <button className="game-row" onClick={() => openGame(game.id)}>
      <span className={`badge result ${cls}`} title={o ?? 'unfinished'}>
        {letter}
      </span>
      <span className="game-main">
        <b>{gameLabel(game)}</b>
        <span className="small muted">
          {game.myColor === 'white' ? '♔ White' : '♚ Black'}
          {game.speed ? ` · ${SPEED_NAMES[game.speed]}` : ''}
          {game.opening ? ` · ${game.opening}` : ''}
          {` · ${Math.ceil(game.moves.length / 2)} moves`}
        </span>
      </span>
      <span className="game-stats small">
        {summary ? (
          <>
            <span title="Your accuracy (Lichess' method)">
              <b>{Math.round(summary.accuracy ?? 0)}%</b>
            </span>
            {summary.blunders + summary.misses > 0 && <span className="sym bad">{summary.blunders + summary.misses}×??</span>}
            {summary.mistakes > 0 && <span className="sym mistake">{summary.mistakes}×?</span>}
          </>
        ) : (
          <span className="faint">{analysing ? 'analysing…' : 'waiting'}</span>
        )}
      </span>
    </button>
  );
}

/** Pick which mistakes become cards. The learnable ones are ticked; what you leave unticked is not suggested again. */
export function ChooseCardsDialog({ suggestions, onClose }: { suggestions: Suggestion[]; onClose: () => void }) {
  const addMistakes = useApp((s) => s.addMistakes);
  const showToast = useApp((s) => s.showToast);
  const profiles = useApp((s) => s.data.profiles);
  const [ticked, setTicked] = useState(() => new Set(suggestions.filter((s) => isLearnable(s.moment)).map((s) => `${s.game.id}#${s.moment.ply}`)));
  const id = (s: Suggestion) => `${s.game.id}#${s.moment.ply}`;
  const byGame = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const s of suggestions) m.set(s.game.id, [...(m.get(s.game.id) ?? []), s]);
    return [...m.values()];
  }, [suggestions]);

  const apply = (dismissRest: boolean) => {
    const chosen = suggestions.filter((s) => ticked.has(id(s)));
    const cards = chosen.map((s) => {
      const p = profiles.find((x) => x.id === s.game.profileId);
      return cardFromMoment(s.game, s.moment, s.game.analysis?.maiaRating ?? p?.rating);
    });
    const added = cards.length ? addMistakes(cards) : 0;
    if (dismissRest) {
      const { updateGame } = useGames.getState();
      for (const group of byGame) {
        const rest = group.filter((s) => !ticked.has(id(s))).map((s) => s.moment.ply);
        if (rest.length) updateGame(group[0].game.id, (g) => ({ ...g, dismissed: [...new Set([...(g.dismissed ?? []), ...rest])] }));
      }
    }
    if (added) showToast(`${plural(added, 'card')} added to Train → My mistakes`);
    onClose();
  };

  const toggle = (s: Suggestion) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(id(s))) n.delete(id(s));
      else n.add(id(s));
      return n;
    });

  return (
    <Dialog title="Choose mistakes to train" onClose={onClose}>
      <div className="small muted">
        Ticked: mistakes players at your level can learn to avoid (Maia’s estimate). Moves only an engine finds are left unticked; tick
        them if you want them anyway.
      </div>
      <div className="choose-list">
        {byGame.map((group) => (
          <div key={group[0].game.id} className="stack" style={{ gap: 4 }}>
            <div className="small faint">{gameLabel(group[0].game)}</div>
            {group.map((s) => {
              const m = s.moment;
              const line = gameLine(s.game.moves);
              return (
                <label key={id(s)} className="choose-row">
                  <input type="checkbox" checked={ticked.has(id(s))} onChange={() => toggle(s)} />
                  <span>
                    <b>
                      {moveNo(m.ply)}
                      {line[m.ply]?.san}
                    </b>{' '}
                    <span className={`badge kind-${m.kind}`}>{JUDGMENT_NAMES[m.kind]}</span> → {m.best[0]}{' '}
                    <span className="muted small">
                      ({formatEval(m.bestEval)} → {formatEval(m.playedEval)})
                      {m.maia ? ` · ${Math.round(m.maia.best * 100)}% find it` : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose} title="Close and decide later">
          Later
        </button>
        <button className="btn primary" disabled={!ticked.size && !suggestions.length} onClick={() => apply(true)}>
          {ticked.size ? `Add ${plural(ticked.size, 'card')}` : 'Add none'}
        </button>
      </div>
      <div className="help">Unticked mistakes are set aside and not suggested again. You can still add them from the game’s review.</div>
    </Dialog>
  );
}

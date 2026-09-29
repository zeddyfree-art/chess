import { useEffect, useRef, useState } from 'react';
import { importGames, parseGames, type ImportResult } from '../lib/pgn';
import { toMoves, type Repertoire } from '../lib/repertoire';
import { useApp } from '../lib/store';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

type Conflicts = 'both' | 'keep-mine';

const count = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** Adds the lines of a PGN (pasted or from a file) to an existing repertoire. What the file contains is
 *  shown first, so nothing is added blindly; one Undo takes the whole import back. */
export function ImportPgnDialog({ rep, onClose }: { rep: Repertoire; onClose: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [conflicts, setConflicts] = useState<Conflicts>('both');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const games = useRef<{ text: string; parsed: ReturnType<typeof parseGames> } | null>(null);

  // Reading a big book takes a moment; wait for typing to stop and let the "Reading…" line show first.
  useEffect(() => {
    if (!text.trim()) {
      setResult(null);
      setFailure(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    let stale = false;
    const timer = setTimeout(() => {
      try {
        if (games.current?.text !== text) games.current = { text, parsed: parseGames(text) };
        const res = importGames(rep, games.current.parsed, { conflicts });
        if (!stale) {
          setResult(res);
          setFailure(null);
        }
      } catch (e) {
        if (!stale) {
          setResult(null);
          setFailure((e as Error).message || 'This does not look like a PGN.');
        }
      } finally {
        if (!stale) setBusy(false);
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [text, conflicts, rep]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setText(await f.text());
      setFile({ name: f.name, size: f.size });
    } catch {
      useApp.getState().showToast('Could not read that file');
    }
  };

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) return useApp.getState().showToast('The clipboard is empty');
      setText(clip);
      setFile(null);
    } catch {
      useApp.getState().showToast('Your browser did not allow clipboard access. Paste into the box with Ctrl+V instead.');
    }
  };

  const changes = result ? result.added + result.comments + result.drawings : 0;

  const add = () => {
    if (!result || !games.current) return;
    const parsed = games.current.parsed;
    const { updateRep, showToast, undoLast } = useApp.getState();
    // Merge into the repertoire as it is now, in case a sync brought changes in while this window was open.
    let done = result;
    updateRep(
      rep.id,
      (current) => {
        done = importGames(current, parsed, { conflicts });
        return done.rep;
      },
      'PGN import',
    );
    const parts = [plural(toMoves(done.added), 'move')];
    if (done.comments) parts.push(plural(done.comments, 'comment'));
    if (done.drawings) parts.push(plural(done.drawings, 'arrow or circle', 'arrows and circles'));
    showToast(`Added ${parts.join(', ')}`, { label: 'Undo', run: undoLast });
    onClose();
  };

  const clashes = result ? result.alternatives + result.skippedConflicts : 0;
  const side = rep.side === 'white' ? 'White' : 'Black';

  return (
    <Dialog title={`Add lines to “${rep.name}”`} onClose={onClose}>
      <div className="muted small">
        Paste a PGN or choose a file (a Lichess study, a Chessable or Chessbook export, ChessBase…). Moves you already have are kept;
        new lines are added, and comments and arrows or circles are filled in where they are missing.
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), readFile(e.dataTransfer.files?.[0]))} className="stack" style={{ gap: 8 }}>
        {file ? (
          <div className="row file-chip">
            <Icon name="upload" size={15} />
            <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</b>
            <span className="muted small">{file.size > 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
            <span className="spacer" />
            <button
              className="btn sm ghost"
              onClick={() => {
                setFile(null);
                setText('');
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <textarea
            className="input"
            rows={6}
            autoFocus
            value={text}
            spellCheck={false}
            placeholder="Paste a PGN here (Ctrl+V), or drop a file on this window…"
            onChange={(e) => setText(e.target.value)}
          />
        )}
        <div className="row wrap">
          <label className="btn">
            <Icon name="upload" size={16} /> Choose file…
            <input
              type="file"
              accept=".pgn,text/plain"
              hidden
              onChange={(e) => {
                readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn" onClick={paste}>
            <Icon name="copy" size={16} /> Paste from clipboard
          </button>
        </div>
      </div>

      {busy && <div className="muted small">Reading…</div>}
      {failure && <div className="notice error small">{failure}</div>}

      {result && !busy && (
        <>
          <div className="stat-row wrap">
            <div className="stat" title={`${count(result.added)} half-moves`}>
              <b>{count(toMoves(result.added))}</b>
              <span>new {toMoves(result.added) === 1 ? 'move' : 'moves'}</span>
            </div>
            <div className="stat">
              <b>{count(result.comments)}</b>
              <span>new {result.comments === 1 ? 'comment' : 'comments'}</span>
            </div>
            <div className="stat" title="Drawn on the board, like on Lichess">
              <b>{count(result.drawings)}</b>
              <span>arrows &amp; circles</span>
            </div>
            <div className="stat" title={`${count(result.alreadyHad)} half-moves`}>
              <b>{count(toMoves(result.alreadyHad))}</b>
              <span>already there</span>
            </div>
          </div>
          <div className="small muted">
            {plural(result.games, 'game')} read in the file. You play {side} here, so the {side} moves that are added become training cards.
          </div>

          {clashes > 0 && (
            <div className="field">
              <label>Where you already play a different move</label>
              <label className="radio">
                <input type="radio" name="conflicts" checked={conflicts === 'both'} onChange={() => setConflicts('both')} />
                <span>
                  <b>Keep both</b>: the file’s {plural(clashes, 'move')} {clashes === 1 ? 'is' : 'are'} added next to yours; in training either counts as correct.
                </span>
              </label>
              <label className="radio">
                <input type="radio" name="conflicts" checked={conflicts === 'keep-mine'} onChange={() => setConflicts('keep-mine')} />
                <span>
                  <b>Keep only my move</b>: skip the file’s move and the lines after it.
                </span>
              </label>
            </div>
          )}

          {result.found === 0 ? (
            <div className="notice error small">No chess moves found in this text. Is it a PGN?</div>
          ) : (
            changes === 0 && <div className="notice small">Nothing new: everything in this file is already in your repertoire.</div>
          )}
          {result.errors.length > 0 && (
            <div className="notice small">
              <b>Good to know</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {result.errors.slice(0, 5).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!result || busy || changes === 0} onClick={add}>
          {result && changes > 0 ? (result.added > 0 ? `Add ${plural(toMoves(result.added), 'move')}` : 'Add comments & drawings') : 'Add'}
        </button>
      </div>
    </Dialog>
  );
}

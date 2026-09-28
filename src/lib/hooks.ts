import { useEffect, useState } from 'react';
import { keyToFen } from './chess';
import { cloudEvaluation, type Evaluation } from './evaluate';
import { engine } from './engine';
import { pvToSan } from './evaluate';
import { fetchExplorer, type ExplorerDb, type ExplorerResult } from './lichess';

export interface Async<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

export function useExplorer(key: string, db: ExplorerDb, ratings: number[], speeds: string[], enabled = true): Async<ExplorerResult> {
  const [state, setState] = useState<Async<ExplorerResult>>({ data: null, error: null, loading: false });
  const filterKey = `${ratings.join(',')}|${speeds.join(',')}`;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    // Small debounce so scrolling through a line doesn't fire a request per move.
    const t = setTimeout(() => {
      fetchExplorer({ db, fen: keyToFen(key), ratings, speeds })
        .then((data) => alive && setState({ data, error: null, loading: false }))
        .catch((error) => alive && setState({ data: null, error, loading: false }));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, db, filterKey, enabled]);
  return state;
}

/** Cloud eval if Lichess has one, otherwise streams a local Stockfish analysis. */
export function useEvaluation(key: string, enabled: boolean, multiPv = 3, depth = 22): Evaluation | null {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  useEffect(() => {
    if (!enabled) {
      setEvaluation(null);
      return;
    }
    let alive = true;
    setEvaluation(null);
    const t = setTimeout(async () => {
      const cloud = await cloudEvaluation(key, multiPv);
      if (!alive) return;
      if (cloud) {
        setEvaluation(cloud);
        return;
      }
      engine
        .analyse(keyToFen(key), { multiPv, depth }, (lines) => {
          if (!alive) return;
          setEvaluation({
            source: 'local',
            depth: lines[0]?.depth ?? 0,
            lines: lines.map((l) => ({ cp: l.cp, mate: l.mate, ...pvToSan(key, l.pv) })),
          });
        })
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
      engine.stop();
    };
  }, [key, enabled, multiPv, depth]);
  return evaluation;
}

export function useKey(handler: (e: KeyboardEvent) => void, deps: unknown[]) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      handler(e);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

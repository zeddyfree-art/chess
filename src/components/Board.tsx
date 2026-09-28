import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { dests, isCheck, keyToFen, turnOfKey, type Side } from '../lib/chess';

export type Shape = DrawShape;

interface Props {
  /** Position key (FEN without counters). */
  position: string;
  orientation: Side;
  /** Which side the user may move; null = view only. */
  movable: Side | 'both' | null;
  lastMove?: [string, string] | null;
  shapes?: Shape[];
  onMove?: (orig: string, dest: string) => void;
  className?: string;
}

export function Board({ position, orientation, movable, lastMove, shapes, onMove, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      coordinates: true,
      draggable: { showGhost: true },
      drawable: { enabled: true, visible: true },
      movable: { free: false, showDests: true, events: { after: (o, d) => onMoveRef.current?.(o, d) } },
      premovable: { enabled: false },
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    const turn = turnOfKey(position);
    const canMove = movable === 'both' || movable === turn;
    api.current?.set({
      fen: keyToFen(position),
      orientation,
      turnColor: turn,
      check: isCheck(position) ? turn : false,
      lastMove: (lastMove as Key[] | null) ?? undefined,
      movable: {
        color: canMove ? turn : undefined,
        dests: canMove ? (dests(position) as Map<Key, Key[]>) : new Map(),
      },
    });
  }, [position, orientation, movable, lastMove]);

  useEffect(() => {
    api.current?.setAutoShapes(shapes ?? []);
  }, [shapes]);

  return (
    <div className={`board-wrap ${className ?? ''}`}>
      <div ref={el} className="cg-wrap" />
    </div>
  );
}

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
  /** Helper arrows drawn by the app itself (prepared moves, engine line, hovered move). */
  shapes?: Shape[];
  /** The position's own arrows and circles (the ones stored in the repertoire). */
  drawn?: Shape[];
  /** Every board can be drawn on like on Lichess (right-click and drag for an arrow, right-click a square for a
   *  circle; Shift/Ctrl = red, Alt = blue, both = yellow). Temporary drawings vanish when the position changes.
   *  Pass this to keep them: it is called with everything drawn after each change. */
  onDraw?: (shapes: Shape[]) => void;
  onMove?: (orig: string, dest: string) => void;
  className?: string;
}

export function Board({ position, orientation, movable, lastMove, shapes, drawn, onDraw, onMove, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onDrawRef = useRef(onDraw);
  onDrawRef.current = onDraw;
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  // True while the user is drawing (right button or Shift held). Chessground also wipes all drawings when
  // the board is clicked, and reports that as a change; only real drawing may change what is stored.
  const drawing = useRef(false);

  useEffect(() => {
    const board = el.current;
    if (!board) return;
    const down = (e: MouseEvent | TouchEvent) => {
      drawing.current = 'button' in e && (e.button === 2 || e.buttons === 2 || e.shiftKey);
    };
    const up = () => {
      setTimeout(() => {
        drawing.current = false;
      }, 0);
    };
    board.addEventListener('mousedown', down, true);
    board.addEventListener('touchstart', down, true);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
    return () => {
      board.removeEventListener('mousedown', down, true);
      board.removeEventListener('touchstart', down, true);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchend', up);
    };
  }, []);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      coordinates: true,
      draggable: { showGhost: true },
      drawable: {
        enabled: true,
        visible: true,
        eraseOnMovablePieceClick: false,
        onChange: (all) => {
          if (drawing.current) onDrawRef.current?.([...all]);
          else api.current?.setShapes(drawnRef.current ?? []); // a click on the board: the drawings stay
        },
      },
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

  useEffect(() => {
    api.current?.setShapes(drawn ?? []);
  }, [drawn, position]);

  return (
    <div className={`board-wrap ${className ?? ''}`}>
      <div ref={el} className="cg-wrap" />
    </div>
  );
}

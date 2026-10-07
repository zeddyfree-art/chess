import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawBrush, DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { dests, isCheck, keyToFen, turnOfKey, uciToArrow, type Side } from '../lib/chess';

export type Shape = DrawShape;

/** Colours of the arrows the app draws itself. PGN annotations ([%cal]/[%csl] from Lichess, Chessable,
 *  ChessBase) only know green, red, blue and yellow, so the app never uses those: moves are white or black
 *  after the side that plays them and run under the pieces like a trail, so annotations stay on top; the
 *  engine's move is violet and a move you point at in the database is pink. */
/** Thin dark edge that keeps white arrows and circles visible on the light squares. */
const WHITE_EDGE = '#6b6252';

const APP_BRUSHES: Record<string, DrawBrush> = {
  moveWhite: { key: 'mw', color: '#ffffff', opacity: 0.85, lineWidth: 12 },
  moveBlack: { key: 'mb', color: '#000000', opacity: 0.55, lineWidth: 12 },
  moveWhiteSoft: { key: 'mws', color: '#ffffff', opacity: 0.5, lineWidth: 12 },
  moveBlackSoft: { key: 'mbs', color: '#000000', opacity: 0.3, lineWidth: 12 },
  engine: { key: 'eng', color: '#7a3db8', opacity: 0.6, lineWidth: 12 },
  pointer: { key: 'ptr', color: '#e0457b', opacity: 0.75, lineWidth: 10 },
};

/** A move as an arrow in the colour of the side that plays it. `soft` when the position has annotations
 *  (they should stand out), `onTop` to draw it over the pieces instead of under them. */
export function moveArrow(uci: string, side: Side, opts: { soft?: boolean; width?: number; onTop?: boolean } = {}): Shape {
  const [orig, dest] = uciToArrow(uci);
  const brush = `move${side === 'white' ? 'White' : 'Black'}${opts.soft ? 'Soft' : ''}`;
  return {
    orig,
    dest,
    brush,
    modifiers: { ...(opts.width ? { lineWidth: opts.width } : {}), ...(side === 'white' ? { hilite: WHITE_EDGE } : {}) },
    ...(opts.onTop ? {} : { below: true }),
  } as Shape;
}

/** A circle around a square in the colour of a side (e.g. the piece to move, as a hint). */
export function sideCircle(square: string, side: Side): Shape {
  return { orig: square, brush: side === 'white' ? 'moveWhite' : 'moveBlack', modifiers: { hilite: side === 'white' ? WHITE_EDGE : '#ffffff' } } as Shape;
}

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
      // Rank numbers on the left-hand file, so chessground marks each label with the colour of the square it is on.
      ranksPosition: 'left',
      draggable: { showGhost: true },
      drawable: {
        enabled: true,
        visible: true,
        brushes: APP_BRUSHES as never,
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

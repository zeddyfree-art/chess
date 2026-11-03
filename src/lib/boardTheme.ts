// Board colours: Lichess' brown (the default), the boards of Rookahead (https://github.com/rookahead/rookahead,
// src/components/Board.tsx, GPL-3.0-or-later, like this app), and a few of Lichess' own pictures of wood, marble and
// leather (public/boards, AGPL-3.0-or-later, see the README there). Chosen in Settings, remembered per device. A plain
// board is two square colours drawn as a small SVG; a picture board is the image itself. Either way behind every board
// in the app, with the coordinates and the last move's tint to match.
import { useSyncExternalStore } from 'react';

export interface BoardTheme {
  label: string;
  light: string;
  dark: string;
  /** The last move's squares, where the usual green-yellow would not show well. */
  lastMove?: string;
  /** A picture of the whole board (in public/boards), instead of the two colours. */
  image?: string;
}

export const BOARD_THEMES = {
  brown: { label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  green: { label: 'Green', light: '#ebecd0', dark: '#739552' },
  blue: { label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  slate: { label: 'Slate', light: '#c9cfd8', dark: '#6b7a8f', lastMove: 'rgba(255, 214, 102, 0.55)' },
  graphite: { label: 'Graphite', light: '#d9dce1', dark: '#8e96a1', lastMove: 'rgba(255, 214, 102, 0.55)' },
  iris: { label: 'Iris', light: '#d3cff3', dark: '#7d70dc', lastMove: 'rgba(238, 150, 232, 0.62)' },
  // Lichess' boards; `light` and `dark` are its coordinate colours for them.
  wood: { label: 'Wood', light: '#caaf7d', dark: '#7b5330', image: 'wood4.jpg' },
  maple: { label: 'Maple', light: '#e8ceab', dark: '#bc7944', image: 'maple.jpg' },
  marble: { label: 'Marble', light: '#93ab91', dark: '#4f644e', image: 'marble.jpg' },
  blueMarble: { label: 'Blue marble', light: '#eae6dd', dark: '#7c7f87', image: 'blue-marble.jpg' },
  leather: { label: 'Leather', light: '#d1d1c9', dark: '#c28e16', image: 'leather.jpg' },
  olive: { label: 'Olive', light: '#b8b19f', dark: '#6d6655', image: 'olive.jpg' },
  icc: { label: 'ICC', light: '#ececec', dark: '#c1c18e', image: 'ic.png' },
} satisfies Record<string, BoardTheme>;

export type BoardThemeName = keyof typeof BOARD_THEMES;

const KEY = 'board-theme';

export function boardThemeName(): BoardThemeName {
  try {
    const v = localStorage.getItem(KEY);
    return v && v in BOARD_THEMES ? (v as BoardThemeName) : 'brown';
  } catch {
    return 'brown';
  }
}

/** The 8×8 squares as an SVG background. */
export function boardImage(light: string, dark: string): string {
  let rects = '';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if ((r + f) % 2 === 1) rects += `<rect x="${f}" y="${r}" width="1" height="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The CSS background of a board: its picture, or its two colours. */
export function boardBackground(t: BoardTheme): string {
  return t.image ? `url("${import.meta.env.BASE_URL}boards/${t.image}")` : boardImage(t.light, t.dark);
}

/** A colour mixed towards black by `amount` (0–1). */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

const listeners = new Set<() => void>();

/** Puts the chosen board on every board of the app (the default brown is chessground's own). */
export function applyBoardTheme(name: BoardThemeName = boardThemeName()) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('board-theme') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'board-theme';
    document.head.appendChild(el);
  }
  const t: BoardTheme = BOARD_THEMES[name];
  el.textContent =
    name === 'brown'
      ? ''
      : t.image
        ? // As on Lichess: each label in the colour of the other kind of square, with a little shadow.
          `cg-board { background-color: ${t.dark}; background-image: ${boardBackground(t)}; background-size: 100% 100%; }
.cg-wrap coords:is(.ranks, .files) coord { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.cg-wrap coords:is(.ranks, .files) coord.coord-light { color: ${t.dark}; }
.cg-wrap coords:is(.ranks, .files) coord.coord-dark { color: ${t.light}; }
${t.lastMove ? `cg-board square.last-move { background-color: ${t.lastMove}; }` : ''}`
        : `cg-board { background-color: ${t.light}; background-image: ${boardImage(t.light, t.dark)}; }
.cg-wrap coords:is(.ranks, .files) coord.coord-light { color: ${darken(t.dark, 0.1)}; }
.cg-wrap coords:is(.ranks, .files) coord.coord-dark { color: ${darken(t.dark, 0.55)}; }
${t.lastMove ? `cg-board square.last-move { background-color: ${t.lastMove}; }` : ''}`;
}

export function setBoardTheme(name: BoardThemeName) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* ignore */
  }
  applyBoardTheme(name);
  listeners.forEach((l) => l());
}

export function useBoardTheme(): BoardThemeName {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    boardThemeName,
    () => 'brown',
  );
}

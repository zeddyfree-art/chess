const PATHS = {
  first: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  last: 'M13 17l5-5-5-5M6 17l5-5-5-5',
  flip: 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h4',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  board: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  tree: 'M5 4h5v4H5zM14 10h5v4h-5zM14 17h5v4h-5zM7.5 8v11H14M7.5 12H14',
  train: 'M13 2L4 14h8l-1 8 9-12h-8l1-8z',
  audit: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  plus: 'M12 5v14M5 12h14',
  comment: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  hint: 'M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  expand: 'M4 12h16M12 4v16',
  collapse: 'M4 12h16',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16a4 4 0 100-8 4 4 0 000 8z',
  lichess: 'M12 2l3 5-2 2 5 4-1 9H7l2-6-4-3 3-7z',
  play: 'M7 4l13 8-13 8z',
  cloud: 'M17.5 19H7a5 5 0 01-.9-9.9A6 6 0 0117.7 8a4.5 4.5 0 01-.2 11z',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  games: 'M3 3v18h18M7 15l4-5 3 3 6-7',
  grip: 'M5 9h14M5 15h14',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

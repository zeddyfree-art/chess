import { THEME_NAMES, type Theme } from '../lib/themes';

/** The tactical themes of a mistake, as small labels. */
export function ThemeChips({ themes }: { themes: Theme[] }) {
  if (!themes.length) return null;
  return (
    <span className="theme-chips">
      {themes.map((t) => (
        <span key={t} className="theme-chip">
          {THEME_NAMES[t]}
        </span>
      ))}
    </span>
  );
}

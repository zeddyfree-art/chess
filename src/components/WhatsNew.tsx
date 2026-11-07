import { useEffect, useState } from 'react';
import { feedbackHref, markVersionSeen, newsToShow, type ChangelogEntry } from '../lib/changelog';
import { useApp } from '../lib/store';
import { Dialog } from './Dialog';

/** Once after an update: what is new in this version. Not for someone who has just started (nothing was old to them). */
export function WhatsNew() {
  const loaded = useApp((s) => s.loaded);
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  useEffect(() => {
    if (!loaded) return;
    setEntry(newsToShow(useApp.getState().data.profiles.length === 0));
  }, [loaded]);
  if (!entry) return null;
  const close = () => {
    markVersionSeen();
    setEntry(null);
  };
  return (
    <Dialog title={`What’s new in version ${entry.version}`} onClose={close}>
      <ul className="whats-new">
        {entry.items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
      <div className="small muted">
        Something not right, or an idea? <a href={feedbackHref()}>Send feedback</a>.
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" autoFocus onClick={close}>
          Nice!
        </button>
      </div>
    </Dialog>
  );
}

/** Permanent, informational notice for the retained legacy app. No storage or sync changes. */
export function SuccessorNotice() {
  return (
    <aside
      className="sync-banner successor-notice"
      aria-label="Newer version of Repertoire available"
      style={{ flexWrap: 'wrap', gap: 10 }}
    >
      <div className="sync-banner-text" style={{ minWidth: 0, flex: '1 1 230px' }}>
        <strong>Repertoire 2 is available.</strong>{' '}
        <span className="muted">
          You're using Repertoire 1. This version remains available, but will no longer receive updates.
          Repertoire 2 is a separate app; your data is not moved automatically.
        </span>
      </div>
      <a
        className="btn primary sm"
        href="https://zeddyfree-art.github.io/repertoire2/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open Repertoire 2
      </a>
    </aside>
  );
}

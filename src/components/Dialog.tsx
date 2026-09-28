import { useEffect, type ReactNode } from 'react';

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog card" role="dialog" aria-modal aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface Choice {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  run: () => void;
}

export function ChoiceDialog({ title, body, choices, onClose }: { title: string; body: ReactNode; choices: Choice[]; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div>{body}</div>
      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {choices.map((c) => (
          <button
            key={c.label}
            autoFocus={c.kind === 'primary' || c.kind === 'danger'}
            className={`btn ${c.kind === 'primary' ? 'primary' : c.kind === 'danger' ? 'danger solid' : ''}`}
            onClick={() => {
              c.run();
              onClose();
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

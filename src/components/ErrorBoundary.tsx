import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

/** Shows what went wrong instead of a blank page, with a way back. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}\n\n${navigator.userAgent}`;
    return (
      <div style={{ maxWidth: 640, margin: '40px auto' }} className="card card-pad stack">
        <h2>Something went wrong</h2>
        <div className="muted">
          This screen hit an error. Your data is safe. You can go back, or reload the page. If it keeps happening, copy the
          details below and send them to whoever maintains the app.
        </div>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8, overflow: 'auto' }}>
          {details}
        </pre>
        <div className="row wrap">
          <button
            className="btn primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Back to overview
          </button>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
          <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(details)}>
            Copy details
          </button>
        </div>
      </div>
    );
  }
}

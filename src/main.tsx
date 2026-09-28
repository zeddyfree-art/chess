import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { completeLoginIfRedirected } from './lib/lichess';
import { loadData, useApp } from './lib/store';
import { initSync } from './lib/sync';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={() => useApp.getState().setView('home')}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Errors outside React rendering (e.g. in a worker or a promise) are shown as a message.
addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
  if (msg) useApp.getState().showToast(`Error: ${msg}`);
});

loadData().then(() => {
  initSync();
  completeLoginIfRedirected()
    .then((user) => user && useApp.getState().showToast(`Connected to Lichess as ${user}`))
    .catch((e) => useApp.getState().showToast((e as Error).message));
});

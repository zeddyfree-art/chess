import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { takeOverDeviceResults } from './lib/checkResults';
import { completeLoginIfRedirected } from './lib/lichess';
import { loadGames } from './lib/gamesStore';
import { loadData, useApp } from './lib/store';
import { initSync } from './lib/sync';
import { initUpdateCheck } from './lib/version';
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

/** Check results now live in the synced data: take over the ones the previous version kept on this device only, and
 *  drop those of repertoires that are gone. */
async function tidyCheckResults() {
  const old = await takeOverDeviceResults().catch(() => ({}));
  const { data, saveChecks } = useApp.getState();
  const ids = new Set(data.repertoires.map((r) => r.id));
  for (const [id, results] of Object.entries(old)) if (ids.has(id) && !data.checks?.[id]) saveChecks(id, results);
  const checks = useApp.getState().data.checks;
  if (checks && Object.keys(checks).some((id) => !ids.has(id)))
    useApp.setState((s) => ({ data: { ...s.data, checks: Object.fromEntries(Object.entries(checks).filter(([id]) => ids.has(id))) } }));
}

Promise.all([loadData(), loadGames()]).then(() => {
  void tidyCheckResults();
  initSync();
  initUpdateCheck();
  completeLoginIfRedirected()
    .then((user) => user && useApp.getState().showToast(`Connected to Lichess as ${user}`))
    .catch((e) => useApp.getState().showToast((e as Error).message));
});

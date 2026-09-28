import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { completeLoginIfRedirected } from './lib/lichess';
import { loadData, useApp } from './lib/store';
import { initSync } from './lib/sync';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

loadData().then(() => {
  initSync();
  completeLoginIfRedirected()
    .then((user) => user && useApp.getState().showToast(`Connected to Lichess as ${user}`))
    .catch((e) => useApp.getState().showToast((e as Error).message));
});

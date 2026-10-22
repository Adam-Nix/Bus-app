import './style.css';
import { showBoard } from './board';
import { initPwa } from './pwa';
import { showStops } from './stops';
import { getFavourites, getLastStop, migrateFavourites, pruneCache } from './store';

migrateFavourites();

const app = document.getElementById('app')!;
let teardown: (() => void) | null = null;
let currentRoute = '';

// Hash routes work on GitHub Pages without any server-side rewrites.
function route(): void {
  const hash = location.hash.replace(/^#/, '');
  const stopMatch = hash.match(/^\/stop\/([^/]+)$/);

  let next: string;
  if (stopMatch) next = `stop:${decodeURIComponent(stopMatch[1])}`;
  else if (hash === '/stops') next = 'stops';
  else {
    // Reopen the saved stop they looked at last, like most transit apps.
    const saved = getFavourites();
    const last = getLastStop();
    const home = saved.find((f) => f.atco === last) ?? saved[0];
    location.replace(home ? `#/stop/${encodeURIComponent(home.atco)}` : '#/stops');
    return;
  }
  if (next === currentRoute) return;
  currentRoute = next;

  teardown?.();
  window.scrollTo(0, 0);
  teardown = next === 'stops' ? showStops(app) : showBoard(app, next.slice('stop:'.length));

  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((link) => {
    const isCurrent = link.dataset.nav === (next === 'stops' ? 'stops' : 'board');
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

window.addEventListener('hashchange', route);
route();

initPwa(() => {
  // Re-render the stops page so the install button appears or disappears.
  if (currentRoute === 'stops') {
    currentRoute = '';
    route();
  }
});

// Trip timetables are cached for a week; drop anything long expired.
pruneCache(24 * 60 * 60_000);

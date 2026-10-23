import './style.css';
import { showBoard } from './board';
import { initPwa, isStandalone, promptInstall } from './pwa';
import { showStops } from './stops';
import { getFavourites, pruneCache } from './store';

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
    // Always open on the first saved stop; the dropdown switches from there.
    const [home] = getFavourites();
    location.replace(home ? `#/stop/${encodeURIComponent(home.atco)}` : '#/stops');
    return;
  }
  if (next === currentRoute) return;
  currentRoute = next;

  teardown?.();
  window.scrollTo(0, 0);
  teardown = next === 'stops' ? showStops(app) : showBoard(app, next.slice('stop:'.length));
  if (next === 'stops' && scrollToInstall) {
    scrollToInstall = false;
    document.getElementById('install')?.scrollIntoView({ block: 'start' });
  }

  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((link) => {
    const isCurrent = link.dataset.nav === (next === 'stops' ? 'stops' : 'board');
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// The Install button in the top bar uses the browser's prompt when there is
// one; otherwise it opens the steps at the bottom of the Stops page.
const installButton = document.querySelector<HTMLButtonElement>('[data-install]')!;
let scrollToInstall = false;

function updateInstallButton(): void {
  installButton.hidden = isStandalone();
}

installButton.addEventListener('click', async () => {
  if (await promptInstall()) return;
  scrollToInstall = true;
  if (location.hash === '#/stops') currentRoute = '';
  location.hash = '#/stops';
  route();
});

updateInstallButton();

// Every launch starts on the first built-in stop. A stop left in the address
// from last time (possibly one an older version used) would otherwise win.
if (location.hash.startsWith('#/stop/')) {
  history.replaceState(null, '', location.pathname + location.search);
}

window.addEventListener('hashchange', route);
route();

initPwa(() => {
  updateInstallButton();
  // Re-render the stops page so the install section appears or disappears.
  if (currentRoute === 'stops') {
    currentRoute = '';
    route();
  }
});

// Trip timetables are cached for a week; drop anything long expired.
pruneCache(24 * 60 * 60_000);

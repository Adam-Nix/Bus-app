import { fetchStop, stopPageUrl, type Stop } from './api';
import { loadBoard, type Board, type Departure } from './departures';
import { countdown, departureTime, escapeHtml, punctuality, stopsAwayText } from './format';
import {
  cacheGet,
  cacheGetStale,
  cacheSet,
  getFavourite,
  getRouteFilter,
  removeFavourite,
  saveFavourite,
  setRouteFilter,
} from './store';
import { formatClock } from './time';

const REFRESH_MS = 30_000;
const TICK_MS = 10_000;
/** A saved board older than this is too old to show while loading. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60_000;

interface State {
  atco: string;
  stop: Pick<Stop, 'common_name' | 'long_name' | 'indicator'> | null;
  board: Board | null;
  loading: boolean;
  error: string | null;
}

let state: State | null = null;
let timer: number | undefined;
let root: HTMLElement;

function snapshotKey(atco: string) {
  return `board:${atco}`;
}

async function getStopInfo(atco: string): Promise<State['stop']> {
  const key = `stop:${atco}`;
  const cached = cacheGet<State['stop']>(key) ?? null;
  if (cached) return cached;
  const stop = await fetchStop(atco);
  if (!stop) return null;
  const info = { common_name: stop.common_name, long_name: stop.long_name, indicator: stop.indicator };
  cacheSet(key, info, 7 * 24 * 60 * 60_000);
  return info;
}

function stopTitle(s: State): string {
  return getFavourite(s.atco)?.name ?? s.stop?.common_name ?? 'Bus stop';
}

function stopSubtitle(s: State): string {
  if (!s.stop) return '';
  const parts = [s.stop.long_name !== stopTitle(s) ? s.stop.long_name : null];
  if (s.stop.indicator && !s.stop.long_name.includes(s.stop.indicator)) parts.push(s.stop.indicator);
  return parts.filter(Boolean).join(' · ');
}

function metaLine(d: Departure): string {
  const bits: string[] = [];
  if (d.expected !== null) {
    bits.push('<span class="live"><span class="live-dot" aria-hidden="true"></span>Live</span>');
    const away = stopsAwayText(d.stopsAway);
    if (away) bits.push(escapeHtml(away));
    const punct = punctuality(d);
    if (punct) bits.push(`<span class="punct ${d.delay! >= 120 ? 'late' : ''}">${escapeHtml(punct)}</span>`);
  } else {
    bits.push('<span class="scheduled">Timetable</span>');
  }
  return bits.join('<span class="sep" aria-hidden="true">·</span>');
}

function timesLine(d: Departure): string {
  const sched = formatClock(d.scheduled);
  if (d.expected === null || formatClock(d.expected) === sched) return `Due ${sched}`;
  return `Due ${sched} · <strong>Expected ${formatClock(d.expected)}</strong>`;
}

function renderHero(d: Departure, now: number): string {
  const c = countdown(d, now);
  return `
    <article class="hero" aria-label="Next bus: ${escapeHtml(d.line)} to ${escapeHtml(d.destination)}, ${escapeHtml(c.label)}">
      <div class="hero-route">
        <span class="route-badge">${escapeHtml(d.line)}</span>
        <span class="hero-dest">${escapeHtml(d.destination)}</span>
      </div>
      <div class="hero-countdown" aria-hidden="true">
        <span class="hero-value">${escapeHtml(c.value)}</span>
        ${c.unit ? `<span class="hero-unit">${c.unit}</span>` : ''}
      </div>
      <div class="hero-meta">${metaLine(d)}</div>
      <div class="hero-times">${timesLine(d)}</div>
    </article>`;
}

function renderRow(d: Departure, now: number): string {
  const c = countdown(d, now);
  const clock = formatClock(departureTime(d));
  return `
    <li class="row" aria-label="${escapeHtml(d.line)} to ${escapeHtml(d.destination)}, ${escapeHtml(c.label)}">
      <span class="route-badge small">${escapeHtml(d.line)}</span>
      <div class="row-main">
        <div class="row-dest">${escapeHtml(d.destination)}</div>
        <div class="row-meta">${metaLine(d)}</div>
      </div>
      <div class="row-when" aria-hidden="true">
        <span class="row-value">${escapeHtml(c.value)}${c.unit ? `<small> ${c.unit}</small>` : ''}</span>
        ${c.value === clock ? '' : `<span class="row-clock">${clock}</span>`}
      </div>
    </li>`;
}

function renderStatus(s: State, now: number): string {
  const bits: string[] = [];
  if (s.loading) bits.push('Updating…');
  else if (s.board) bits.push(`Updated ${formatClock(s.board.fetchedAt)}`);
  if (s.error) {
    bits.push(
      s.board
        ? `<span class="warn">Can't reach bustimes.org, showing times from ${formatClock(s.board.fetchedAt)}</span>`
        : `<span class="warn">${escapeHtml(s.error)}</span>`,
    );
  } else if (s.board && !s.board.liveOk) {
    bits.push(
      navigator.onLine === false
        ? '<span class="warn">Offline, showing timetable times</span>'
        : '<span class="warn">Live tracking unavailable, timetable only</span>',
    );
  }
  if (s.board && now - s.board.fetchedAt > 5 * 60_000 && !s.error && !s.loading) {
    bits.push('<span class="warn">These times may be out of date</span>');
  }
  return bits.join('<span class="sep" aria-hidden="true">·</span>');
}

function render(): void {
  if (!state) return;
  const s = state;
  const now = Date.now();
  const favourite = getFavourite(s.atco);
  const filter = getRouteFilter(s.atco);
  const lines = s.board?.lines ?? [];

  const visible = (s.board?.departures ?? []).filter(
    (d) => departureTime(d) >= now - 60_000 && (filter.length === 0 || filter.includes(d.line)),
  );

  let body: string;
  if (!s.board) {
    body = s.error
      ? `<div class="empty"><p>Couldn't load departures.</p><button class="button" data-action="refresh">Try again</button></div>`
      : `<div class="skeleton" aria-hidden="true"><div></div><div></div><div></div></div>`;
  } else if (visible.length === 0) {
    const which = filter.length ? `${filter.join(', ')} ` : '';
    body = `<div class="empty"><p>No ${escapeHtml(which)}buses in the next 3 hours.</p></div>`;
  } else {
    const [next, ...rest] = visible;
    body = `${renderHero(next, now)}${
      rest.length ? `<h2 class="list-title">Later</h2><ol class="list">${rest.map((d) => renderRow(d, now)).join('')}</ol>` : ''
    }`;
  }

  const chips =
    lines.length > 1
      ? `<div class="chips" role="group" aria-label="Show routes">
          <button class="chip" data-action="route" data-route="" aria-pressed="${filter.length === 0}">All</button>
          ${lines
            .map(
              (line) =>
                `<button class="chip" data-action="route" data-route="${escapeHtml(line)}" aria-pressed="${filter.includes(line)}">${escapeHtml(line)}</button>`,
            )
            .join('')}
        </div>`
      : '';

  // Re-rendering replaces the buttons, so put keyboard focus back after.
  const focused = root.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset
    : null;

  root.innerHTML = `
    <section class="board">
      <div class="stop-head">
        <div class="stop-names">
          <h1>${escapeHtml(stopTitle(s))}</h1>
          <p class="stop-sub">${escapeHtml(stopSubtitle(s))}</p>
        </div>
        <button class="star" data-action="favourite" aria-pressed="${Boolean(favourite)}"
          aria-label="${favourite ? 'Remove from saved stops' : 'Save this stop'}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>
        </button>
      </div>
      ${chips}
      <div class="status">
        <span class="status-text">${renderStatus(s, now)}</span>
        <button class="refresh" data-action="refresh" aria-label="Refresh now" ${s.loading ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>
        </button>
      </div>
      ${body}
      <p class="credit">
        Times from <a href="${stopPageUrl(s.atco)}" target="_blank" rel="noopener">bustimes.org</a>,
        using public transport open data.
      </p>
    </section>`;

  if (focused?.action) {
    const selector = `[data-action="${focused.action}"]${
      focused.route !== undefined ? `[data-route="${CSS.escape(focused.route)}"]` : ''
    }`;
    root.querySelector<HTMLElement>(selector)?.focus();
  }
}

function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (region) region.textContent = message;
}

async function refresh(manual = false): Promise<void> {
  if (!state || state.loading) return;
  const s = state;
  s.loading = true;
  render();
  try {
    const [board, stop] = await Promise.all([loadBoard(s.atco), s.stop ? s.stop : getStopInfo(s.atco)]);
    if (state !== s) return; // Navigated away while loading.
    s.board = board;
    s.stop = stop;
    s.error = null;
    cacheSet(snapshotKey(s.atco), board, SNAPSHOT_MAX_AGE_MS);
    if (manual) announce('Departures updated');
  } catch (err) {
    if (state !== s) return;
    console.error(err);
    s.error = navigator.onLine === false ? "You're offline" : "Couldn't reach bustimes.org";
    announce(s.board ? `${s.error}. Showing earlier times.` : s.error);
  } finally {
    if (state === s) {
      s.loading = false;
      render();
    }
  }
}

function tick(): void {
  if (!state || document.visibilityState !== 'visible') return;
  const age = state.board ? Date.now() - state.board.fetchedAt : Infinity;
  if (age >= REFRESH_MS || (state.error && !state.loading)) void refresh();
  else render(); // Keep the countdowns current between fetches.
}

function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target || !state) return;
  const atco = state.atco;
  switch (target.dataset.action) {
    case 'refresh':
      void refresh(true);
      break;
    case 'favourite': {
      if (getFavourite(atco)) {
        removeFavourite(atco);
        announce('Removed from saved stops');
      } else {
        saveFavourite({ atco, name: stopTitle(state), routes: getRouteFilter(atco) });
        announce('Saved');
      }
      render();
      break;
    }
    case 'route': {
      const route = target.dataset.route ?? '';
      const current = getRouteFilter(atco);
      const next = !route ? [] : current.includes(route) ? current.filter((r) => r !== route) : [...current, route];
      setRouteFilter(atco, next);
      render();
      break;
    }
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') tick();
}

function onOnline(): void {
  void refresh();
}

export function showBoard(container: HTMLElement, atco: string): () => void {
  root = container;
  const snapshot = cacheGetStale<Board>(snapshotKey(atco));
  const fresh = snapshot && Date.now() - snapshot.fetchedAt < SNAPSHOT_MAX_AGE_MS ? snapshot : null;
  state = {
    atco,
    stop: cacheGetStale<State['stop']>(`stop:${atco}`) ?? null,
    board: fresh,
    loading: false,
    error: null,
  };
  document.title = `${stopTitle(state)} · Next Bus`;
  render();
  void refresh().then(() => {
    if (state?.atco === atco) document.title = `${stopTitle(state)} · Next Bus`;
  });

  root.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  timer = window.setInterval(tick, TICK_MS);

  return () => {
    state = null;
    window.clearInterval(timer);
    root.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

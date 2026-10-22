import { fetchStop, stopPageUrl, type Stop } from './api';
import { loadBoard, type Board, type Departure } from './departures';
import { countdown, departureTime, escapeHtml, punctuality, stopsAwayText } from './format';
import {
  cacheGet,
  cacheGetStale,
  cacheSet,
  getFavourite,
  getFavourites,
  getRouteFilter,
  removeFavourite,
  saveFavourite,
  setLastStop,
  setRouteFilter,
} from './store';
import { formatClock } from './time';

const REFRESH_MS = 30_000;
const TICK_MS = 10_000;
/** A saved board older than this is too old to show while loading. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60_000;

type StopInfo = Pick<Stop, 'common_name' | 'long_name' | 'indicator'>;

interface State {
  /** Board key: one ATCO code, or several joined by commas. */
  atco: string;
  atcos: string[];
  stops: Record<string, StopInfo>;
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

async function getStopInfo(atco: string): Promise<StopInfo | null> {
  const key = `stop:${atco}`;
  const cached = cacheGet<StopInfo>(key) ?? null;
  if (cached) return cached;
  const stop = await fetchStop(atco);
  if (!stop) return null;
  const info = { common_name: stop.common_name, long_name: stop.long_name, indicator: stop.indicator };
  cacheSet(key, info, 7 * 24 * 60 * 60_000);
  return info;
}

function isCombined(s: State): boolean {
  return s.atcos.length > 1;
}

function stopName(s: State, atco: string): string {
  return s.stops[atco]?.common_name ?? 'Bus stop';
}

function stopTitle(s: State): string {
  return (
    getFavourite(s.atco)?.name ??
    (isCombined(s) ? s.atcos.map((a) => stopName(s, a)).join(' + ') : stopName(s, s.atco))
  );
}

function stopSubtitle(s: State): string {
  if (isCombined(s)) {
    return Object.keys(s.stops).length ? `Buses from ${s.atcos.map((a) => stopName(s, a)).join(' and ')}` : '';
  }
  const stop = s.stops[s.atco];
  if (!stop) return '';
  // Skip the full name when the title already says it.
  const parts = [stopTitle(s).startsWith(stop.long_name) ? null : stop.long_name];
  if (stop.indicator && !stop.long_name.includes(stop.indicator)) parts.push(stop.indicator);
  return parts.filter(Boolean).join(' · ');
}

/** On a combined board, which stop the bus leaves from. */
function fromLine(d: Departure, s: State, withArrival: boolean): string {
  if (!isCombined(s)) return '';
  const arrival =
    withArrival && d.arrives !== null ? `<span class="bit">arrives ${formatClock(d.arrives)}</span>` : '';
  return `<div class="from"><span class="bit">From ${escapeHtml(stopName(s, d.stop))}</span>${arrival}</div>`;
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
  return bits.map((b) => `<span class="bit">${b}</span>`).join('');
}

function timesLine(d: Departure, s: State): string {
  const sched = formatClock(d.scheduled);
  const parts = [`Due ${sched}`];
  if (d.expected !== null && formatClock(d.expected) !== sched) {
    parts.push(`<strong>Expected ${formatClock(d.expected)}</strong>`);
  }
  // Comparing stops only makes sense with when each bus gets you there.
  if (isCombined(s) && d.arrives !== null) parts.push(`Arrives ${formatClock(d.arrives)}`);
  return parts.join(' · ');
}

function renderHero(d: Departure, s: State, now: number): string {
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
      ${fromLine(d, s, false)}
      <div class="hero-meta">${metaLine(d)}</div>
      <div class="hero-times">${timesLine(d, s)}</div>
    </article>`;
}

function renderRow(d: Departure, s: State, now: number): string {
  const c = countdown(d, now);
  const clock = formatClock(departureTime(d));
  return `
    <li class="row" aria-label="${escapeHtml(d.line)} to ${escapeHtml(d.destination)}, ${escapeHtml(c.label)}">
      <span class="route-badge small">${escapeHtml(d.line)}</span>
      <div class="row-main">
        <div class="row-dest">${escapeHtml(d.destination)}</div>
        ${fromLine(d, s, true)}
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

function pickerOpen(): boolean {
  return root.contains(document.activeElement) && document.activeElement instanceof HTMLSelectElement;
}

// Wait for focus to settle so a closing picker no longer counts as open.
function renderSoon(): void {
  setTimeout(render);
}

function render(): void {
  if (!state) return;
  // Redrawing would close the phone's picker mid-choice; catch up on blur.
  if (pickerOpen()) return;
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
    body = `${renderHero(next, s, now)}${
      rest.length ? `<h2 class="list-title">Later</h2><ol class="list">${rest.map((d) => renderRow(d, s, now)).join('')}</ol>` : ''
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

  // The stop name doubles as a dropdown for switching between saved stops.
  // A native select gives the phone's own picker and works with screen readers.
  const options = [...getFavourites()];
  if (!favourite) options.unshift({ atco: s.atco, name: stopTitle(s) });
  const picker = `
    <label class="picker">
      <span class="visually-hidden">Stop</span>
      <select data-action="switch">
        ${options
          .map(
            (f) =>
              `<option value="${escapeHtml(f.atco)}"${f.atco === s.atco ? ' selected' : ''}>${escapeHtml(f.name)}</option>`,
          )
          .join('')}
      </select>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </label>`;

  // Re-rendering replaces the buttons, so put keyboard focus back after.
  const focused = root.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset
    : null;

  root.innerHTML = `
    <section class="board">
      <h1 class="visually-hidden">${escapeHtml(stopTitle(s))}</h1>
      <div class="stop-head">
        <div class="stop-names">
          ${picker}
          <p class="stop-sub">${escapeHtml(stopSubtitle(s))}</p>
        </div>
        <button class="save" data-action="favourite" aria-pressed="${Boolean(favourite)}"
          aria-label="Save stop" title="Saved stops appear as tabs and on the Stops page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>
          <span aria-hidden="true">${favourite ? 'Saved' : 'Save'}</span>
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
        Times from <a href="${stopPageUrl(s.atcos[0])}" target="_blank" rel="noopener">bustimes.org</a>,
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
    const missing = s.atcos.filter((a) => !s.stops[a]);
    const [board, infos] = await Promise.all([loadBoard(s.atcos), Promise.all(missing.map(getStopInfo))]);
    if (state !== s) return; // Navigated away while loading.
    s.board = board;
    missing.forEach((a, i) => {
      const info = infos[i];
      if (info) s.stops[a] = info;
    });
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
        saveFavourite({ atco, name: stopTitle(state) });
        announce('Saved. It now appears in your saved stops.');
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

function onChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  if (select.dataset.action !== 'switch' || !state || select.value === state.atco) return;
  location.hash = `#/stop/${encodeURIComponent(select.value)}`;
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') tick();
}

function onOnline(): void {
  void refresh();
}

export function showBoard(container: HTMLElement, atco: string): () => void {
  root = container;
  const atcos = atco.split(',').filter(Boolean);
  setLastStop(atco);
  const snapshot = cacheGetStale<Board>(snapshotKey(atco));
  const fresh = snapshot && Date.now() - snapshot.fetchedAt < SNAPSHOT_MAX_AGE_MS ? snapshot : null;
  state = {
    atco,
    atcos,
    stops: Object.fromEntries(
      atcos.flatMap((a) => {
        const info = cacheGetStale<StopInfo>(`stop:${a}`);
        return info ? [[a, info]] : [];
      }),
    ),
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
  root.addEventListener('change', onChange);
  root.addEventListener('focusout', renderSoon);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  timer = window.setInterval(tick, TICK_MS);

  return () => {
    state = null;
    window.clearInterval(timer);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('focusout', renderSoon);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

import { fetchStop, stopPageUrl, type Stop } from './api';
import { HORIZON_MS, loadBoard, sortLines, type Board, type Departure } from './departures';
import { countdown, departureTime, escapeHtml, punctuality, stopsAwayText } from './format';
import {
  cacheGet,
  cacheGetStale,
  cacheSet,
  getFavourite,
  defaultRoutes,
  getFavourites,
  isBuiltIn,
  removeFavourite,
  saveFavourite,
  setLastStop,
} from './store';
import {
  ALERT_MINUTES,
  follow,
  followedTime,
  getFollowed,
  isFollowing,
  notificationsBlocked,
  onFollowChange,
  unfollow,
  type Followed,
} from './follow';
import { spotter, spotterRank, tapBus } from './spotter';
import { formatClock, minutesUntil } from './time';
import { loadWeather, type Weather } from './weather';
import { weatherIcon } from './weather-icons';

const REFRESH_MS = 30_000;
const TICK_MS = 10_000;
/** A saved board older than this is too old to show while loading. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60_000;

type StopInfo = Pick<Stop, 'common_name' | 'long_name' | 'indicator' | 'location'>;

interface State {
  /** Board key: one ATCO code, or several joined by commas. */
  atco: string;
  atcos: string[];
  stops: Record<string, StopInfo>;
  /** Routes shown; starts at the stop's default each time it's opened. */
  routes: string[];
  board: Board | null;
  weather: Weather | null;
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
  // Older versions cached stops without a location, which weather needs.
  if (cached?.location) return cached;
  const stop = await fetchStop(atco);
  if (!stop) return null;
  const info = {
    common_name: stop.common_name,
    long_name: stop.long_name,
    indicator: stop.indicator,
    location: stop.location,
  };
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
  // Saved stops go by the name they were saved as (bustimes.org calls
  // Limerick TUS "Mayorstone Upper", for one), so don't contradict it.
  if (!stop || getFavourite(s.atco)) return '';
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

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>';
const BUS =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="10" width="40" height="40" rx="8" fill="#ffd23f"/><rect x="17" y="15" width="30" height="15" rx="3" fill="#0f6b4f"/><circle cx="21" cy="42" r="3.5" fill="#0f6b4f"/><circle cx="43" cy="42" r="3.5" fill="#0f6b4f"/><rect x="16" y="50" width="8" height="6" rx="2" fill="#333"/><rect x="40" y="50" width="8" height="6" rx="2" fill="#333"/></svg>';

function bellButton(d: Departure): string {
  const on = isFollowing(d, getFollowed());
  return `<button class="bell" data-action="follow" data-trip="${d.tripId}" data-stop="${escapeHtml(d.stop)}"
    aria-pressed="${on}" aria-label="${on ? 'Stop following' : 'Notify me'} ${ALERT_MINUTES} minutes before this ${escapeHtml(d.line)}">${BELL}</button>`;
}

function renderSpotter(f: Followed): string {
  const data = spotter();
  if (!data.unlocked) return '';
  const counts = Object.values(data.seen);
  const total = counts.reduce((a, b) => a + b, 0);
  const thisBus = f.vehicleName
    ? `This bus: <strong>${escapeHtml(f.vehicleName)}</strong>, caught ${data.seen[f.vehicleName] ?? 0}×`
    : "This bus isn't live-tracked, so it can't be logged";
  return `
    <div class="spotter">
      <div class="spotter-head">🔭 <strong>Bus Spotter</strong><span class="spotter-rank">${spotterRank(total)}</span></div>
      <p>${thisBus}</p>
      <p class="muted">${counts.length} different ${counts.length === 1 ? 'bus' : 'buses'} caught, ${total} in total. Catch a live bus with an alert to log it.</p>
    </div>`;
}

function renderFollow(s: State, now: number): string {
  const f = getFollowed();
  if (!f) return '';
  const minutes = minutesUntil(followedTime(f), now);
  // The bus drives along the road over its last half hour.
  const progress = Math.max(0, Math.min(1, 1 - minutes / 30));
  const due = f.expected !== null ? `expected ${formatClock(f.expected)}` : `due ${formatClock(f.scheduled)}`;
  const status = f.alerted
    ? '🔔 Alert sent. Head to the stop!'
    : `🔔 Alert at ${ALERT_MINUTES} min${notificationsBlocked() ? ' (in the app only: notifications are off)' : ''}`;
  return `
    <section class="follow${f.alerted ? ' alerted' : ''}" aria-label="Following the ${escapeHtml(f.line)} to ${escapeHtml(f.destination)}">
      <div class="follow-head">
        <span class="route-badge small">${escapeHtml(f.line)}</span>
        <div class="follow-title">
          <strong>Following</strong> to ${escapeHtml(f.destination)}
          <span>from ${escapeHtml(f.stopName)} · ${due}</span>
        </div>
        <button class="follow-stop" data-action="unfollow">Stop</button>
      </div>
      <div class="follow-body">
        <span class="follow-count"><strong>${minutes === 0 ? 'Due' : minutes}</strong>${minutes === 0 ? '' : ' min'}</span>
        <span class="follow-status">${status}</span>
      </div>
      <div class="road" aria-hidden="true">
        <span class="road-line"></span>
        <button class="road-bus" data-action="honk" tabindex="-1" style="left: calc(${progress.toFixed(3)} * (100% - 76px))">${BUS}</button>
        <span class="road-stop">🚏</span>
      </div>
      ${f.stopsAway !== null ? `<p class="follow-away">${stopsAwayText(f.stopsAway)}</p>` : ''}
      ${f.board !== s.atco ? `<p><a href="#/stop/${encodeURIComponent(f.board)}">Go to ${escapeHtml(f.stopName)}</a></p>` : ''}
      <p class="follow-note">Keep Next Bus open: phones pause web apps in the background.</p>
      ${renderSpotter(f)}
    </section>`;
}

function renderHero(d: Departure, s: State, now: number): string {
  const c = countdown(d, now);
  return `
    <article class="hero" aria-label="Next bus: ${escapeHtml(d.line)} to ${escapeHtml(d.destination)}, ${escapeHtml(c.label)}">
      <div class="hero-route">
        <span class="route-badge">${escapeHtml(d.line)}</span>
        <span class="hero-dest">${escapeHtml(d.destination)}</span>
        ${bellButton(d)}
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
      ${bellButton(d)}
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

function renderWeather(w: Weather): string {
  const rain = w.rainChance === null ? '' : `<span class="bit"><strong>${w.rainChance}%</strong> chance of rain</span>`;
  return `
    <p class="weather">
      ${weatherIcon(w.kind, w.isDay)}
      <span class="weather-text">
        <span class="bit"><strong>${Math.round(w.temperature)}°</strong> ${escapeHtml(w.label)}</span>${rain}
      </span>
    </p>`;
}

// The header (with the stop dropdown) is only redrawn when it changes, so
// the regular countdown updates never disturb the phone's picker.
let lastHead = '';

function renderHead(s: State): string {
  const favourite = getFavourite(s.atco);
  // The stop name doubles as a dropdown for switching between saved stops.
  // A native select gives the phone's own picker and works with screen readers.
  const options = [...getFavourites()];
  if (!favourite) options.unshift({ atco: s.atco, name: stopTitle(s) });
  return `
    <h1 class="visually-hidden">${escapeHtml(stopTitle(s))}</h1>
    <div class="stop-head">
      <div class="stop-names">
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
        </label>
        <p class="stop-sub">${escapeHtml(stopSubtitle(s))}</p>
      </div>
      ${
        // Built-in stops are always in the dropdown, so there's nothing to toggle.
        isBuiltIn(s.atco)
          ? ''
          : `<button class="save" data-action="favourite" aria-pressed="${Boolean(favourite)}"
        aria-label="Save stop" title="Saved stops appear in this dropdown and on the Stops page">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>
        <span aria-hidden="true">${favourite ? 'Saved' : 'Save'}</span>
      </button>`
      }
    </div>`;
}

function renderBody(s: State, now: number): string {
  const filter = s.routes;
  const upcoming = (s.board?.departures ?? []).filter((d) => departureTime(d) >= now - 60_000);
  const visible = upcoming.filter((d) => filter.length === 0 || filter.includes(d.line));

  let departures: string;
  if (!s.board) {
    departures = s.error
      ? `<div class="empty"><p>Couldn't load departures.</p><button class="button" data-action="refresh">Try again</button></div>`
      : `<div class="skeleton" aria-hidden="true"><div></div><div></div><div></div></div>`;
  } else if (visible.length === 0) {
    const which = filter.length ? `${filter.join(', ')} ` : '';
    const hours = Math.round((s.board.horizonMs ?? HORIZON_MS) / 3_600_000);
    departures = `<div class="empty"><p>No ${escapeHtml(which)}buses in the next ${hours} hours.</p></div>`;
  } else {
    const [next, ...rest] = visible;
    departures = `${renderHero(next, s, now)}${
      rest.length ? `<h2 class="list-title">Later</h2><ol class="list">${rest.map((d) => renderRow(d, s, now)).join('')}</ol>` : ''
    }`;
  }

  // One button per route with a bus leaving soon, plus any already chosen.
  const lines = sortLines([...upcoming.map((d) => d.line), ...filter]);
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

  return `
    ${renderFollow(s, now)}
    ${chips}
    <div class="status">
      <span class="status-text">${renderStatus(s, now)}</span>
      <button class="refresh" data-action="refresh" aria-label="Refresh now" ${s.loading ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>
      </button>
    </div>
    ${s.weather ? renderWeather(s.weather) : ''}
    ${departures}
    <p class="credit">
      Times from <a href="${stopPageUrl(s.atcos[0])}" target="_blank" rel="noopener">bustimes.org</a>,
      using public transport open data.
      Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.
    </p>`;
}

function render(): void {
  if (!state) return;
  const s = state;

  let head = root.querySelector<HTMLElement>('[data-part="head"]');
  let body = root.querySelector<HTMLElement>('[data-part="body"]');
  if (!head || !body) {
    root.innerHTML = '<section class="board"><div data-part="head"></div><div data-part="body"></div></section>';
    head = root.querySelector<HTMLElement>('[data-part="head"]')!;
    body = root.querySelector<HTMLElement>('[data-part="body"]')!;
    lastHead = '';
  }

  // Redrawing replaces buttons, so put keyboard focus back after.
  const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : null;

  const headHtml = renderHead(s);
  if (headHtml !== lastHead) {
    head.innerHTML = headHtml;
    lastHead = headHtml;
  }
  body.innerHTML = renderBody(s, Date.now());

  if (focused?.action && !root.contains(document.activeElement)) {
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
    // Stops saved by older versions lack the location the weather needs.
    const missing = s.atcos.filter((a) => !s.stops[a]?.location);
    const [board, infos] = await Promise.all([loadBoard(s.atcos, s.routes), Promise.all(missing.map(getStopInfo))]);
    if (state !== s) return; // Navigated away while loading.
    s.board = board;
    missing.forEach((a, i) => {
      const info = infos[i];
      if (info) s.stops[a] = info;
    });
    s.error = null;
    cacheSet(snapshotKey(s.atco), board, SNAPSHOT_MAX_AGE_MS);
    void refreshWeather(s);
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

/** Weather is a nice extra: if it fails, the board simply goes without. */
async function refreshWeather(s: State): Promise<void> {
  const location = s.stops[s.atcos[0]]?.location;
  if (!location) return;
  try {
    const weather = await loadWeather(location);
    if (state !== s) return;
    s.weather = weather;
    render();
  } catch {
    // Leave out the weather line.
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
      const saved = getFavourite(atco);
      if (saved) {
        // One tap on "Saved" shouldn't silently drop a stop from the dropdown.
        if (!window.confirm(`Remove ${saved.name} from your stops?`)) break;
        removeFavourite(atco);
        announce('Removed from saved stops');
      } else {
        saveFavourite({ atco, name: stopTitle(state) });
        announce('Saved. It now appears in your saved stops.');
      }
      render();
      break;
    }
    case 'follow': {
      const d = state.board?.departures.find(
        (x) => String(x.tripId) === target.dataset.trip && x.stop === target.dataset.stop,
      );
      if (!d) break;
      if (isFollowing(d, getFollowed())) {
        unfollow();
        announce('Stopped following');
      } else {
        void follow(d, atco, stopTitle(state));
        announce(`Following the ${d.line}. You'll get an alert ${ALERT_MINUTES} minutes before it arrives.`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      break;
    }
    case 'unfollow':
      unfollow();
      announce('Stopped following');
      break;
    case 'honk':
      honk(target);
      break;
    case 'route': {
      const route = target.dataset.route ?? '';
      const current = state.routes;
      state.routes = !route ? [] : current.includes(route) ? current.filter((r) => r !== route) : [...current, route];
      render();
      // A quiet route may need the board to look further ahead.
      void refresh();
      break;
    }
  }
}

function onChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  if (select.dataset.action !== 'switch' || !state || select.value === state.atco) return;
  select.blur();
  location.hash = `#/stop/${encodeURIComponent(select.value)}`;
}

/** The secret: tap the bus five times quickly. After that, it honks. */
function honk(bus: HTMLElement): void {
  if (tapBus()) {
    announce('Bus Spotter unlocked!');
    confetti();
    render();
    return;
  }
  if (!spotter().unlocked) return;
  bus.classList.remove('honking');
  void bus.offsetWidth; // Restart the animation.
  bus.classList.add('honking');
  const bubble = document.createElement('span');
  bubble.className = 'beep';
  bubble.textContent = 'Beep beep!';
  bus.append(bubble);
  setTimeout(() => bubble.remove(), 1200);
}

function confetti(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colours = ['#ffd23f', '#37c093', '#2f80d1', '#ff7a59', '#b072ff'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colours[i % colours.length];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    document.body.append(piece);
    setTimeout(() => piece.remove(), 2200);
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
  root.innerHTML = '';
  const atcos = atco.split(',').filter(Boolean);
  setLastStop(atco);
  const snapshot = cacheGetStale<Board>(snapshotKey(atco));
  const fresh = snapshot && Date.now() - snapshot.fetchedAt < SNAPSHOT_MAX_AGE_MS ? snapshot : null;
  state = {
    atco,
    atcos,
    routes: defaultRoutes(atco),
    stops: Object.fromEntries(
      atcos.flatMap((a) => {
        const info = cacheGetStale<StopInfo>(`stop:${a}`);
        return info ? [[a, info]] : [];
      }),
    ),
    board: fresh,
    weather: null,
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
  const stopWatchingFollow = onFollowChange(render);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  timer = window.setInterval(tick, TICK_MS);

  return () => {
    state = null;
    window.clearInterval(timer);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    stopWatchingFollow();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

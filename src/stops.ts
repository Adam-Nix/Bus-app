import { fetchStop, fetchStopByNaptan, fetchStopsInBox, type NearbyStop } from './api';
import { distanceMetres, distanceText, escapeHtml, parseStopInput } from './format';
import { installSection, promptInstall } from './pwa';
import { defaultRoutes, getFavourites, getLastStop, isBuiltIn, removeFavourite } from './store';

// About 900 m north/south and east/west at British and Irish latitudes.
const BOX_LAT = 0.008;
const BOX_LON = 0.013;
const MAX_NEARBY = 25;

type Nearby =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; stops: (NearbyStop & { distance: number })[] };

let root: HTMLElement;
let nearby: Nearby = { kind: 'idle' };
let lookupError = '';
let filterText = '';
let active = false;

function routesText(routes: string[]): string {
  return routes.length ? `Showing ${escapeHtml(routes.join(', '))}` : 'All routes';
}

function renderSaved(): string {
  const favourites = getFavourites();
  return `<ul class="stop-list">${favourites
    .map(
      (f) => `
      <li>
        <a class="stop-link" href="#/stop/${encodeURIComponent(f.atco)}">
          <span class="stop-link-name">${escapeHtml(f.name)}</span>
          <span class="stop-link-meta">${routesText(defaultRoutes(f.atco))}</span>
        </a>
        ${
          isBuiltIn(f.atco)
            ? ''
            : `<button class="icon-button" data-action="remove" data-atco="${escapeHtml(f.atco)}"
          aria-label="Remove ${escapeHtml(f.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>`
        }
      </li>`,
    )
    .join('')}</ul>`;
}

function renderNearby(): string {
  switch (nearby.kind) {
    case 'idle':
      return '';
    case 'locating':
      return '<p class="muted" role="status">Finding stops near you…</p>';
    case 'error':
      return `<p class="warn" role="alert">${escapeHtml(nearby.message)}</p>`;
    case 'done': {
      const query = filterText.trim().toLowerCase();
      const stops = nearby.stops.filter(
        (s) =>
          !query ||
          s.name.toLowerCase().includes(query) ||
          s.services.some((line) => line.toLowerCase() === query),
      );
      if (nearby.stops.length === 0) return '<p class="muted">No stops found within about 1 km.</p>';
      return `
        <label class="field">
          <span class="visually-hidden">Filter nearby stops</span>
          <input type="search" id="nearby-filter" placeholder="Filter by name or route" value="${escapeHtml(filterText)}" autocomplete="off">
        </label>
        <ul class="stop-list">${
          stops.length
            ? stops
                .map(
                  (s) => `
          <li>
            <a class="stop-link" href="#/stop/${encodeURIComponent(s.atco_code)}">
              <span class="stop-link-name">${escapeHtml(s.name)}</span>
              <span class="stop-link-meta">${escapeHtml(distanceText(s.distance))}${
                s.services.length ? ` · ${escapeHtml(s.services.join(', '))}` : ''
              }</span>
            </a>
          </li>`,
                )
                .join('')
            : '<li class="muted">No matching stops.</li>'
        }</ul>`;
    }
  }
}

function render(): void {
  // Installed apps have no browser back button, so offer one here.
  const last = getLastStop();
  root.innerHTML = `
    <section class="stops">
      <a class="back" href="${last ? `#/stop/${encodeURIComponent(last)}` : '#/'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        Back to departures
      </a>
      <h1>Stops</h1>

      <h2>Saved</h2>
      ${renderSaved()}

      <h2>Near me</h2>
      <button class="button" data-action="locate" ${nearby.kind === 'locating' ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>
        Use my location
      </button>
      <div id="nearby">${renderNearby()}</div>

      <h2>Stop code</h2>
      <form class="lookup" data-form="lookup">
        <label class="field">
          <span class="field-label">Code from the stop sign, or a bustimes.org stop link</span>
          <input name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false"
            placeholder="e.g. 8400B6370801">
        </label>
        <button class="button" type="submit">Open stop</button>
        ${lookupError ? `<p class="warn" role="alert">${escapeHtml(lookupError)}</p>` : ''}
      </form>

      ${installSection()}
    </section>`;
}

function locate(): void {
  if (!('geolocation' in navigator)) {
    nearby = { kind: 'error', message: "This browser can't share your location." };
    render();
    return;
  }
  nearby = { kind: 'locating' };
  render();
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const here: [number, number] = [position.coords.longitude, position.coords.latitude];
      try {
        const stops = await fetchStopsInBox(
          here[0] - BOX_LON,
          here[1] - BOX_LAT,
          here[0] + BOX_LON,
          here[1] + BOX_LAT,
        );
        nearby = {
          kind: 'done',
          stops: stops
            .map((s) => ({ ...s, distance: distanceMetres(here, s.location) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, MAX_NEARBY),
        };
      } catch {
        nearby = { kind: 'error', message: "Couldn't load nearby stops from bustimes.org." };
      }
      if (active) render();
    },
    (error) => {
      nearby = {
        kind: 'error',
        message:
          error.code === error.PERMISSION_DENIED
            ? 'Location access is turned off. You can allow it in your browser settings.'
            : "Couldn't get your location. Try again in a moment.",
      };
      if (active) render();
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
  );
}

async function lookup(form: HTMLFormElement): Promise<void> {
  const raw = String(new FormData(form).get('code') ?? '');
  const code = parseStopInput(raw);
  if (!code) {
    lookupError = "That doesn't look like a stop code.";
    render();
    return;
  }
  const button = form.querySelector('button');
  if (button) button.disabled = true;
  try {
    const stop = (await fetchStop(code)) ?? (await fetchStopByNaptan(code));
    if (stop) {
      lookupError = '';
      location.hash = `#/stop/${encodeURIComponent(stop.atco_code)}`;
      return;
    }
    lookupError = `No stop found with code ${code}.`;
  } catch {
    lookupError = "Couldn't reach bustimes.org. Check your connection.";
  }
  if (active) render();
}

function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  switch (target.dataset.action) {
    case 'locate':
      locate();
      break;
    case 'remove':
      removeFavourite(target.dataset.atco ?? '');
      render();
      break;
    case 'install':
      void promptInstall().then(() => active && render());
      break;
  }
}

function onSubmit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement;
  if (form.dataset.form !== 'lookup') return;
  event.preventDefault();
  void lookup(form);
}

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.id !== 'nearby-filter') return;
  filterText = input.value;
  // Only redraw the list so the input keeps focus and cursor position.
  const container = root.querySelector('#nearby .stop-list');
  const fresh = document.createElement('div');
  fresh.innerHTML = renderNearby();
  const list = fresh.querySelector('.stop-list');
  if (container && list) container.replaceWith(list);
}

export function showStops(container: HTMLElement): () => void {
  root = container;
  active = true;
  lookupError = '';
  document.title = 'Stops · Next Bus';
  render();
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('input', onInput);
  return () => {
    active = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('input', onInput);
  };
}

// Everything here lives in the viewer's browser only. Storage can be
// unavailable (private browsing, blocked site data), so every access is
// wrapped and the app keeps working with in-memory fallbacks.

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
  memory.delete(key);
}

function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- Saved stops ---------------------------------------------------------

export interface SavedStop {
  /** ATCO code, or several joined by commas for a combined board. */
  atco: string;
  name: string;
}

const TUS_MOYLISH_STOP = '8400B6370801';
// The 302 is a loop. It passes this stop a minute before TUS...
const MAYORSTONE_UPPER_TO_TUS = '8400B6068701';
// ...then goes round Caherdavin and passes this one on its way into town,
// so it's the same bus, later.
const MAYORSTONE_UPPER_TO_TOWN = '8400B6069401';
const TUS_MOYLISH = `${TUS_MOYLISH_STOP},${MAYORSTONE_UPPER_TO_TOWN}`;
const COLBERT_STATION_DEPARTURES = '8400B635041';

const MAYORSTONE_STOPS: readonly SavedStop[] = [
  { atco: MAYORSTONE_UPPER_TO_TOWN, name: 'Mayorstone Upper (to town)' },
  { atco: MAYORSTONE_UPPER_TO_TUS, name: 'Mayorstone Upper (to TUS)' },
];

/** In dropdown order; the first is where the app opens. */
export const DEFAULT_FAVOURITES: readonly SavedStop[] = [
  { atco: TUS_MOYLISH, name: 'TUS Moylish' },
  ...MAYORSTONE_STOPS,
  { atco: COLBERT_STATION_DEPARTURES, name: 'Colbert Station' },
];

const DEFAULT_ROUTES: Record<string, string[]> = {
  [TUS_MOYLISH]: ['302'],
  [MAYORSTONE_UPPER_TO_TOWN]: ['302'],
  [MAYORSTONE_UPPER_TO_TUS]: ['302'],
  [COLBERT_STATION_DEPARTURES]: ['55'],
};

const CURRENT_DEFAULTS_VERSION = 3;

const FAVOURITES_KEY = 'favourites';
const DEFAULTS_VERSION_KEY = 'defaultsVersion';
const LAST_STOP_KEY = 'lastStop';

/** Saved stops as stored; version 1 also kept the route filter here. */
type StoredStop = SavedStop & { routes?: string[] };

function readStoredFavourites(): StoredStop[] | null {
  return readJson<StoredStop[]>(FAVOURITES_KEY);
}

export function getFavourites(): SavedStop[] {
  const stored = readStoredFavourites();
  return (stored ?? DEFAULT_FAVOURITES).map(({ atco, name }) => ({ atco, name }));
}

function setFavourites(favourites: SavedStop[]): void {
  write(FAVOURITES_KEY, JSON.stringify(favourites));
}

export function getFavourite(atco: string): SavedStop | undefined {
  return getFavourites().find((f) => f.atco === atco);
}

export function saveFavourite(stop: SavedStop): void {
  const favourites = getFavourites();
  const index = favourites.findIndex((f) => f.atco === stop.atco);
  if (index === -1) favourites.push(stop);
  else favourites[index] = stop;
  setFavourites(favourites);
}

export function removeFavourite(atco: string): void {
  setFavourites(getFavourites().filter((f) => f.atco !== atco));
}

/**
 * One-off upgrades for people who saved stops on an older version: moves
 * route filters out of the saved-stop list and adds stops that became
 * defaults later, without bringing back ones they removed.
 */
export function migrateFavourites(): void {
  const version = Number(read(DEFAULTS_VERSION_KEY) ?? 1);
  if (version >= CURRENT_DEFAULTS_VERSION) return;
  const stored = readStoredFavourites();
  if (stored) {
    let favourites = stored;
    if (version < 2) {
      // TUS Moylish became a combined board with Mayorstone Upper, and
      // Colbert Station was added.
      favourites = favourites.map((f) => (f.atco === TUS_MOYLISH_STOP ? { ...f, atco: TUS_MOYLISH } : f));
      for (const f of favourites) {
        if (f.routes && read(ROUTES_PREFIX + f.atco) === null) setRouteFilter(f.atco, f.routes);
      }
      if (!favourites.some((f) => f.atco === COLBERT_STATION_DEPARTURES)) {
        favourites.push({ atco: COLBERT_STATION_DEPARTURES, name: 'Colbert Station' });
      }
    }
    if (version < 3) {
      // Both Mayorstone Upper stops were added, right after TUS Moylish.
      const missing = MAYORSTONE_STOPS.filter((m) => !favourites.some((f) => f.atco === m.atco));
      const tus = favourites.findIndex((f) => f.atco === TUS_MOYLISH);
      favourites.splice(tus + 1, 0, ...missing);
    }
    setFavourites(favourites.map(({ atco, name }) => ({ atco, name })));
  }
  if (getLastStop() === TUS_MOYLISH_STOP) setLastStop(TUS_MOYLISH);
  write(DEFAULTS_VERSION_KEY, String(CURRENT_DEFAULTS_VERSION));
}

/** The last stop viewed, for the Stops page's back link. */
export function getLastStop(): string | null {
  return read(LAST_STOP_KEY);
}

export function setLastStop(atco: string): void {
  write(LAST_STOP_KEY, atco);
}

// --- Route filters -------------------------------------------------------

// Kept separately from saved stops so saving or removing a stop never
// changes which routes it shows.
const ROUTES_PREFIX = 'routes:';

/** Route numbers to show at a stop; empty means every route. */
export function getRouteFilter(atco: string): string[] {
  return readJson<string[]>(ROUTES_PREFIX + atco) ?? DEFAULT_ROUTES[atco] ?? [];
}

export function setRouteFilter(atco: string, routes: string[]): void {
  write(ROUTES_PREFIX + atco, JSON.stringify(routes));
}

// --- Expiring cache ------------------------------------------------------

const CACHE_PREFIX = 'cache:';

interface CacheEntry<T> {
  expires: number;
  value: T;
}

export function cacheGet<T>(key: string, now = Date.now()): T | undefined {
  const entry = readJson<CacheEntry<T>>(CACHE_PREFIX + key);
  if (!entry || entry.expires <= now) return undefined;
  return entry.value;
}

/** Like cacheGet, but also returns expired entries (for offline fallback). */
export function cacheGetStale<T>(key: string): T | undefined {
  return readJson<CacheEntry<T>>(CACHE_PREFIX + key)?.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  write(CACHE_PREFIX + key, JSON.stringify({ expires: now + ttlMs, value }));
}

/** Drops cache entries that expired more than `graceMs` ago. */
export function pruneCache(graceMs: number, now = Date.now()): void {
  let keys: string[];
  try {
    keys = Object.keys(localStorage);
  } catch {
    return;
  }
  for (const key of keys) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    const entry = readJson<CacheEntry<unknown>>(key);
    if (!entry || entry.expires + graceMs <= now) remove(key);
  }
}

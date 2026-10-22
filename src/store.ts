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

// The 302 is a loop from the city out past the college and back. It's caught
// into the city at Limerick IT (on the Cratloe Road; bustimes.org calls it
// Mayorstone Upper), and back from Harvey's Quay to Mayorstone Upper, the
// stop across the road.
const LIMERICK_IT = '8400B6069401';
const HARVEYS_QUAY = '8400B610001';
const MAYORSTONE_UPPER = '8400B6068701';
const COLBERT_STATION_DEPARTURES = '8400B635041';

/** In dropdown order; the first is where the app opens. */
export const DEFAULT_FAVOURITES: readonly SavedStop[] = [
  { atco: LIMERICK_IT, name: 'Limerick IT' },
  { atco: HARVEYS_QUAY, name: "City (Harvey's Quay)" },
  { atco: MAYORSTONE_UPPER, name: 'Mayorstone Upper' },
  { atco: COLBERT_STATION_DEPARTURES, name: 'Colbert Station' },
];

const DEFAULT_ROUTES: Record<string, string[]> = {
  [LIMERICK_IT]: ['302'],
  [HARVEYS_QUAY]: ['302'],
  [MAYORSTONE_UPPER]: ['302'],
  [COLBERT_STATION_DEPARTURES]: ['55'],
};

// Boards earlier versions saved by default that are no longer used.
const RETIRED_DEFAULTS = new Set(['8400B6370801', '8400B6370801,8400B6069401']);

const CURRENT_DEFAULTS_VERSION = 5;

const FAVOURITES_KEY = 'favourites';
const DEFAULTS_VERSION_KEY = 'defaultsVersion';
const LAST_STOP_KEY = 'lastStop';

function readStoredFavourites(): SavedStop[] | null {
  return readJson<SavedStop[]>(FAVOURITES_KEY);
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
 * One-off upgrade for people who saved stops on an older version: the
 * built-in stops are replaced with the current ones, any stops they saved
 * themselves are kept, and every built-in stop is put back if missing.
 */
export function migrateFavourites(): void {
  const version = Number(read(DEFAULTS_VERSION_KEY) ?? 1);
  if (version >= CURRENT_DEFAULTS_VERSION) return;
  const stored = readStoredFavourites();
  if (stored) {
    let favourites = stored.map(({ atco, name }) => ({ atco, name }));
    if (version < 4) {
      // The built-in stops changed; drop the old ones and re-add below.
      favourites = favourites.filter(
        (f) => !RETIRED_DEFAULTS.has(f.atco) && !DEFAULT_FAVOURITES.some((d) => d.atco === f.atco),
      );
    }
    // Version 4 could leave Colbert Station out, and it's easy to remove a
    // stop by accident, so restore any missing built-in stop in its place.
    DEFAULT_FAVOURITES.forEach((d, i) => {
      if (!favourites.some((f) => f.atco === d.atco)) {
        favourites.splice(Math.min(i, favourites.length), 0, { atco: d.atco, name: d.name });
      }
    });
    setFavourites(favourites);
  }
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

/**
 * Routes a stop shows when it's opened; empty means every route. Changes on
 * the board last until the stop is left, so it always reopens on these.
 */
export function defaultRoutes(atco: string): string[] {
  return DEFAULT_ROUTES[atco] ?? [];
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

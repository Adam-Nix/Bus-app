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

/**
 * Built into the app: always in the dropdown, in this order, and can't be
 * removed. The first is where the app opens.
 */
export const BUILT_IN_STOPS: readonly SavedStop[] = [
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

// Stops earlier versions saved automatically and that are no longer used.
const RETIRED_STOPS = new Set(['8400B6370801', '8400B6370801,8400B6069401']);

// Holds only the stops people saved themselves. Older versions also stored
// the built-in stops here; those entries are skipped when reading.
const FAVOURITES_KEY = 'favourites';
const LAST_STOP_KEY = 'lastStop';

export function isBuiltIn(atco: string): boolean {
  return BUILT_IN_STOPS.some((b) => b.atco === atco);
}

function getOwnStops(): SavedStop[] {
  return (readJson<SavedStop[]>(FAVOURITES_KEY) ?? [])
    .filter((f) => !isBuiltIn(f.atco) && !RETIRED_STOPS.has(f.atco))
    .map(({ atco, name }) => ({ atco, name }));
}

/** Built-in stops first, then any the user saved. */
export function getFavourites(): SavedStop[] {
  return [...BUILT_IN_STOPS.map((b) => ({ ...b })), ...getOwnStops()];
}

export function getFavourite(atco: string): SavedStop | undefined {
  return getFavourites().find((f) => f.atco === atco);
}

export function saveFavourite(stop: SavedStop): void {
  if (isBuiltIn(stop.atco)) return;
  const own = getOwnStops().filter((f) => f.atco !== stop.atco);
  write(FAVOURITES_KEY, JSON.stringify([...own, stop]));
}

/** Removes a stop the user saved; built-in stops stay. */
export function removeFavourite(atco: string): void {
  write(FAVOURITES_KEY, JSON.stringify(getOwnStops().filter((f) => f.atco !== atco)));
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

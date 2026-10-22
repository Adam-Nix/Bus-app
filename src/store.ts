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
  atco: string;
  name: string;
  /** Route numbers to show; empty means every route. */
  routes: string[];
}

const FAVOURITES_KEY = 'favourites';

export const DEFAULT_FAVOURITES: SavedStop[] = [
  { atco: '8400B6370801', name: 'TUS Moylish', routes: ['302'] },
];

export function getFavourites(): SavedStop[] {
  return readJson<SavedStop[]>(FAVOURITES_KEY) ?? DEFAULT_FAVOURITES;
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

// Route filters for stops that aren't saved, so toggling a chip on a stop
// you're just browsing still sticks for the session.
const browsingRoutes = new Map<string, string[]>();

export function getRouteFilter(atco: string): string[] {
  return getFavourite(atco)?.routes ?? browsingRoutes.get(atco) ?? [];
}

export function setRouteFilter(atco: string, routes: string[]): void {
  const favourite = getFavourite(atco);
  if (favourite) saveFavourite({ ...favourite, routes });
  else browsingRoutes.set(atco, routes);
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

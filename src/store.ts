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

// --- Small settings ------------------------------------------------------

export function readSetting<T>(key: string): T | null {
  return readJson<T>(key);
}

/** Stores a value, or removes it when given null. */
export function writeSetting(key: string, value: unknown): void {
  if (value === null) remove(key);
  else write(key, JSON.stringify(value));
}

// --- Saved stops ---------------------------------------------------------

export interface SavedStop {
  /** ATCO code, or several joined by commas for a combined board. */
  atco: string;
  name: string;
}

const FAVOURITES_KEY = 'favourites';
const LAST_STOP_KEY = 'lastStop';

/** The stops the user saved, in the order they saved them. */
export function getFavourites(): SavedStop[] {
  return (readJson<SavedStop[]>(FAVOURITES_KEY) ?? []).map(({ atco, name }) => ({ atco, name }));
}

export function getFavourite(atco: string): SavedStop | undefined {
  return getFavourites().find((f) => f.atco === atco);
}

export function saveFavourite(stop: SavedStop): void {
  const others = getFavourites().filter((f) => f.atco !== stop.atco);
  write(FAVOURITES_KEY, JSON.stringify([...others, stop]));
}

export function removeFavourite(atco: string): void {
  write(FAVOURITES_KEY, JSON.stringify(getFavourites().filter((f) => f.atco !== atco)));
}

/** The last stop viewed, for the Stops page's back link. */
export function getLastStop(): string | null {
  return read(LAST_STOP_KEY);
}

export function setLastStop(atco: string): void {
  write(LAST_STOP_KEY, atco);
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

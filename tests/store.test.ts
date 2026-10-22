import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAVOURITES,
  getFavourite,
  getFavourites,
  getLastStop,
  getRouteFilter,
  migrateFavourites,
  removeFavourite,
  saveFavourite,
  setRouteFilter,
} from '../src/store';

const TUS_STOP = '8400B6370801';
const TUS = '8400B6370801,8400B6069401';
const COLBERT = '8400B635041';
const TO_TOWN = '8400B6069401';
const TO_TUS = '8400B6068701';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});

describe('saved stops', () => {
  it('starts with TUS Moylish, both Mayorstone Upper stops and Colbert Station', () => {
    expect(getFavourites().map((f) => f.atco)).toEqual([TUS, TO_TOWN, TO_TUS, COLBERT]);
    expect(getRouteFilter(TUS)).toEqual(['302']);
    expect(getRouteFilter(TO_TOWN)).toEqual(['302']);
    expect(getRouteFilter(TO_TUS)).toEqual(['302']);
    expect(getRouteFilter(COLBERT)).toEqual(['55']);
  });

  it('keeps the route filter when a stop is removed and saved again', () => {
    setRouteFilter(TUS, ['302', '735']);
    removeFavourite(TUS);
    expect(getFavourite(TUS)).toBeUndefined();
    expect(getRouteFilter(TUS)).toEqual(['302', '735']);
    saveFavourite({ atco: TUS, name: 'TUS Moylish' });
    expect(getRouteFilter(TUS)).toEqual(['302', '735']);
  });

  it('remembers route filters on stops that are not saved', () => {
    setRouteFilter('8400B6068801', ['302']);
    expect(getRouteFilter('8400B6068801')).toEqual(['302']);
  });

  it('never changes the built-in defaults', () => {
    saveFavourite({ atco: 'X', name: 'Somewhere' });
    expect(DEFAULT_FAVOURITES.map((f) => f.atco)).toEqual([TUS, TO_TOWN, TO_TUS, COLBERT]);
  });
});

describe('migrateFavourites', () => {
  it('upgrades the first version: combined TUS board, new stops added once', () => {
    storage = fakeStorage({
      favourites: JSON.stringify([{ atco: TUS_STOP, name: 'TUS Moylish', routes: ['302'] }]),
      lastStop: TUS_STOP,
    });
    vi.stubGlobal('localStorage', storage);

    migrateFavourites();
    expect(getFavourites().map((f) => f.atco)).toEqual([TUS, TO_TOWN, TO_TUS, COLBERT]);
    expect(getRouteFilter(TUS)).toEqual(['302']);
    expect(getLastStop()).toBe(TUS);

    // Removing it afterwards sticks; the upgrade only runs once.
    removeFavourite(COLBERT);
    migrateFavourites();
    expect(getFavourites().map((f) => f.atco)).toEqual([TUS, TO_TOWN, TO_TUS]);
  });

  it('adds the Mayorstone Upper stops after TUS for the second version', () => {
    storage = fakeStorage({
      defaultsVersion: '2',
      favourites: JSON.stringify([
        { atco: TUS, name: 'TUS Moylish' },
        { atco: COLBERT, name: 'Colbert Station' },
        { atco: 'X', name: 'Elsewhere' },
      ]),
    });
    vi.stubGlobal('localStorage', storage);
    migrateFavourites();
    expect(getFavourites().map((f) => f.name)).toEqual([
      'TUS Moylish',
      'Mayorstone Upper (to town)',
      'Mayorstone Upper (to TUS)',
      'Colbert Station',
      'Elsewhere',
    ]);
  });

  it('leaves new installs on the defaults', () => {
    migrateFavourites();
    expect(storage.data.has('favourites')).toBe(false);
    expect(getFavourites()).toHaveLength(4);
  });
});

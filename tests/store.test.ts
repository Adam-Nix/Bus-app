import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAVOURITES,
  defaultRoutes,
  getFavourite,
  getFavourites,
  migrateFavourites,
  removeFavourite,
  saveFavourite,
} from '../src/store';

const LIMERICK_IT = '8400B6069401';
const CITY = '8400B610001';
const MAYORSTONE = '8400B6068701';
const COLBERT = '8400B635041';
const DEFAULTS = [LIMERICK_IT, CITY, MAYORSTONE, COLBERT];

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
function useStorage(initial: Record<string, string> = {}) {
  storage = fakeStorage(initial);
  vi.stubGlobal('localStorage', storage);
}
beforeEach(() => useStorage());

const atcos = () => getFavourites().map((f) => f.atco);

describe('saved stops', () => {
  it('starts with Limerick IT, the city, Mayorstone Upper and Colbert Station', () => {
    expect(getFavourites().map((f) => f.name)).toEqual([
      'Limerick IT',
      "City (Harvey's Quay)",
      'Mayorstone Upper',
      'Colbert Station',
    ]);
    expect(defaultRoutes(LIMERICK_IT)).toEqual(['302']);
    expect(defaultRoutes(CITY)).toEqual(['302']);
    expect(defaultRoutes(MAYORSTONE)).toEqual(['302']);
    expect(defaultRoutes(COLBERT)).toEqual(['55']);
  });

  it('removes and saves stops again', () => {
    removeFavourite(LIMERICK_IT);
    expect(getFavourite(LIMERICK_IT)).toBeUndefined();
    saveFavourite({ atco: LIMERICK_IT, name: 'Limerick IT' });
    expect(atcos()).toEqual([CITY, MAYORSTONE, COLBERT, LIMERICK_IT]);
  });

  it('shows every route at stops without a default', () => {
    expect(defaultRoutes('8400B6068801')).toEqual([]);
  });

  it('never changes the built-in defaults', () => {
    saveFavourite({ atco: 'X', name: 'Somewhere' });
    expect(DEFAULT_FAVOURITES.map((f) => f.atco)).toEqual(DEFAULTS);
  });
});

describe('migrateFavourites', () => {
  it('upgrades the first version, keeping stops the user added', () => {
    useStorage({
      favourites: JSON.stringify([
        { atco: '8400B6370801', name: 'TUS Moylish', routes: ['302'] },
        { atco: 'X', name: 'Elsewhere', routes: ['7'] },
      ]),
    });
    migrateFavourites();
    expect(atcos()).toEqual([...DEFAULTS, 'X']);
  });

  it('replaces the combined TUS board and both Mayorstone entries from version 3', () => {
    useStorage({
      defaultsVersion: '3',
      favourites: JSON.stringify([
        { atco: '8400B6370801,8400B6069401', name: 'TUS Moylish' },
        { atco: LIMERICK_IT, name: 'Mayorstone Upper (to town)' },
        { atco: MAYORSTONE, name: 'Mayorstone Upper (to TUS)' },
        { atco: COLBERT, name: 'Colbert Station' },
      ]),
    });
    migrateFavourites();
    expect(getFavourites()).toEqual(DEFAULT_FAVOURITES);
  });

  it('does not bring back Colbert Station if it was removed', () => {
    useStorage({
      defaultsVersion: '2',
      favourites: JSON.stringify([{ atco: '8400B6370801,8400B6069401', name: 'TUS Moylish' }]),
    });
    migrateFavourites();
    expect(atcos()).toEqual([LIMERICK_IT, CITY, MAYORSTONE]);
  });

  it('runs only once', () => {
    useStorage({ favourites: JSON.stringify([{ atco: '8400B6370801', name: 'TUS Moylish' }]) });
    migrateFavourites();
    removeFavourite(CITY);
    migrateFavourites();
    expect(atcos()).toEqual([LIMERICK_IT, MAYORSTONE, COLBERT]);
  });

  it('leaves new installs on the defaults', () => {
    migrateFavourites();
    expect(storage.data.has('favourites')).toBe(false);
    expect(atcos()).toEqual(DEFAULTS);
  });
});

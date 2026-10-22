import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_STOPS,
  defaultRoutes,
  getFavourite,
  getFavourites,
  isBuiltIn,
  removeFavourite,
  saveFavourite,
} from '../src/store';

const LIMERICK_IT = '8400B6069401';
const CITY = '8400B610001';
const MAYORSTONE = '8400B6068701';
const COLBERT = '8400B635041';
const BUILT_IN = [LIMERICK_IT, CITY, MAYORSTONE, COLBERT];

function useStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}
beforeEach(() => useStorage());

const atcos = () => getFavourites().map((f) => f.atco);

describe('built-in stops', () => {
  it('are Limerick IT, the city, Mayorstone Upper and Colbert Station', () => {
    expect(getFavourites().map((f) => f.name)).toEqual([
      'Limerick IT',
      "City (Harvey's Quay)",
      'Mayorstone Upper',
      'Colbert Station',
    ]);
    expect(BUILT_IN.every(isBuiltIn)).toBe(true);
  });

  it('open on the 302, or the 55 at Colbert Station', () => {
    expect(defaultRoutes(LIMERICK_IT)).toEqual(['302']);
    expect(defaultRoutes(CITY)).toEqual(['302']);
    expect(defaultRoutes(MAYORSTONE)).toEqual(['302']);
    expect(defaultRoutes(COLBERT)).toEqual(['55']);
    expect(defaultRoutes('8400B6068801')).toEqual([]);
  });

  it("can't be removed", () => {
    removeFavourite(COLBERT);
    expect(atcos()).toEqual(BUILT_IN);
    expect(getFavourite(COLBERT)?.name).toBe('Colbert Station');
  });

  it('are always there, whatever an older version stored', () => {
    useStorage({
      favourites: JSON.stringify([
        { atco: '8400B6370801,8400B6069401', name: 'TUS Moylish' },
        { atco: '8400B6370801', name: 'TUS Moylish', routes: ['302'] },
        { atco: LIMERICK_IT, name: 'Mayorstone Upper (to town)' },
        { atco: 'X', name: 'Elsewhere' },
      ]),
    });
    expect(getFavourites()).toEqual([...BUILT_IN_STOPS, { atco: 'X', name: 'Elsewhere' }]);
  });
});

describe('stops the user saves', () => {
  it('come after the built-in stops and can be removed', () => {
    saveFavourite({ atco: 'X', name: 'Elsewhere' });
    saveFavourite({ atco: 'Y', name: 'Somewhere' });
    expect(atcos()).toEqual([...BUILT_IN, 'X', 'Y']);
    removeFavourite('X');
    expect(atcos()).toEqual([...BUILT_IN, 'Y']);
  });

  it('never duplicate a built-in stop', () => {
    saveFavourite({ atco: COLBERT, name: 'Colbert again' });
    expect(atcos()).toEqual(BUILT_IN);
  });
});

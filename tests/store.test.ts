import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFavourite, getFavourites, removeFavourite, saveFavourite } from '../src/store';

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

describe('saved stops', () => {
  it('start empty', () => {
    expect(getFavourites()).toEqual([]);
  });

  it('keep the order they were saved in and can be removed', () => {
    saveFavourite({ atco: 'X', name: 'Elsewhere' });
    saveFavourite({ atco: 'Y', name: 'Somewhere' });
    expect(atcos()).toEqual(['X', 'Y']);
    expect(getFavourite('Y')?.name).toBe('Somewhere');
    removeFavourite('X');
    expect(atcos()).toEqual(['Y']);
  });

  it('never duplicate a stop', () => {
    saveFavourite({ atco: 'X', name: 'Elsewhere' });
    saveFavourite({ atco: 'X', name: 'Elsewhere again' });
    expect(getFavourites()).toEqual([{ atco: 'X', name: 'Elsewhere again' }]);
  });

  it('ignore extra fields stored by older versions', () => {
    useStorage({ favourites: JSON.stringify([{ atco: 'X', name: 'Elsewhere', routes: ['10'] }]) });
    expect(getFavourites()).toEqual([{ atco: 'X', name: 'Elsewhere' }]);
  });
});

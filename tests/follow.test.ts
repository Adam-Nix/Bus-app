import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Departure } from '../src/departures';
import { alertDue, alertText, isFollowing, updateFollowed, type Followed } from '../src/follow';
import { recordSpot, spotter, spotterRank, tapBus } from '../src/spotter';

const now = Date.parse('2026-11-25T13:00:00Z');
const MIN = 60_000;

const followed = (overrides: Partial<Followed> = {}): Followed => ({
  tripId: 1,
  stop: 'S',
  board: 'S',
  stopName: 'Limerick TUS',
  line: '302',
  destination: 'City Centre',
  scheduled: now + 20 * MIN,
  expected: null,
  stopsAway: null,
  vehicleName: null,
  alerted: false,
  ...overrides,
});

const departure = (overrides: Partial<Departure> = {}): Departure => ({
  tripId: 1,
  stop: 'S',
  line: '302',
  destination: 'City Centre',
  scheduled: now + 20 * MIN,
  expected: null,
  delay: null,
  stopsAway: null,
  vehicleName: null,
  arrives: null,
  ...overrides,
});

describe('following a bus', () => {
  it('matches the same trip at the same stop only', () => {
    expect(isFollowing(departure(), followed())).toBe(true);
    expect(isFollowing(departure({ stop: 'T' }), followed())).toBe(false);
    expect(isFollowing(departure({ tripId: 2 }), followed())).toBe(false);
    expect(isFollowing(departure(), null)).toBe(false);
  });

  it('alerts once, at 10 minutes, using the live time when there is one', () => {
    expect(alertDue(followed({ scheduled: now + 15 * MIN }), now)).toBe(false);
    expect(alertDue(followed({ scheduled: now + 10 * MIN + 30_000 }), now)).toBe(true);
    expect(alertDue(followed({ scheduled: now + 5 * MIN, expected: now + 14 * MIN }), now)).toBe(false);
    expect(alertDue(followed({ scheduled: now + 5 * MIN, alerted: true }), now)).toBe(false);
  });

  it('picks up live times and stops away', () => {
    const next = updateFollowed(followed(), [departure({ expected: now + 9 * MIN, stopsAway: 3, vehicleName: 'EWD180' })], now);
    expect(next).toMatchObject({ expected: now + 9 * MIN, stopsAway: 3, vehicleName: 'EWD180' });
  });

  it('stops following once the bus has gone', () => {
    expect(updateFollowed(followed({ scheduled: now - 2 * MIN }), [], now)).toBeNull();
    // Not listed yet but still to come: keep it.
    expect(updateFollowed(followed(), [], now)).not.toBeNull();
  });

  it('writes a friendly notification', () => {
    expect(alertText(followed({ scheduled: now + 10 * MIN, stopsAway: 4 }), now)).toEqual({
      title: '🚌 Your 302 is 10 min away',
      body: 'To City Centre from Limerick TUS, due 13:10 · 4 stops away. Time to head to the stop!',
    });
    expect(alertText(followed({ scheduled: now + 30_000 }), now).title).toBe('🚌 Your 302 is due now!');
  });
});

describe('the bus spotter', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });

  it('unlocks after five quick taps', () => {
    expect([0, 100, 200, 300].map((t) => tapBus(now + t))).toEqual([false, false, false, false]);
    expect(tapBus(now + 400)).toBe(true);
    expect(spotter().unlocked).toBe(true);
  });

  it('needs the taps close together', () => {
    [0, 1000, 2000, 3000, 4000, 5000].forEach((t) => expect(tapBus(now + t)).toBe(false));
  });

  it('counts buses caught and gives a rank', () => {
    recordSpot('EWD180');
    recordSpot('EWD180');
    recordSpot('EWD120');
    expect(spotter().seen).toEqual({ EWD180: 2, EWD120: 1 });
    expect(spotterRank(0)).toBe('New Spotter');
    expect(spotterRank(3)).toBe('Rookie Spotter');
    expect(spotterRank(5)).toBe('Regular');
    expect(spotterRank(30)).toBe('Legend of the 302');
  });
});

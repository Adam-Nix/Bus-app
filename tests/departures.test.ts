import { describe, expect, it } from 'vitest';
import type { TripSummary, Vehicle } from '../src/api';
import { buildDepartures, findStopVisit, sortLines, type ScheduledTrip } from '../src/departures';
import { serviceTimeToEpoch } from '../src/time';

const STOP = '8400B6370801';
const DATE = '2026-10-22';
const at = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return serviceTimeToEpoch(DATE, h * 3600 + m * 60);
};

function trip(id: number, line = '302', headsign = 'City Centre'): TripSummary {
  return { id, start: '15:40:00', end: '16:05:00', headsign, service: { id: 5332, line_name: line } };
}

function scheduled(id: number, clock: string, before = ['A', 'B', 'C', 'D'], line?: string): ScheduledTrip {
  const [h, m] = clock.split(':').map(Number);
  return { trip: trip(id, line), date: DATE, visit: { seconds: h * 3600 + m * 60, before } };
}

function vehicle(tripId: number, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: tripId * 10,
    trip_id: tripId,
    date: DATE,
    datetime: new Date(at('15:50')).toISOString(),
    delay: 0,
    coordinates: [-8.65, 52.67],
    progress: { prev_stop: 'B', next_stop: 'C', progress: 0.5 },
    vehicle: { name: 'EWD120 - 241-L-2269' },
    ...overrides,
  };
}

describe('findStopVisit', () => {
  const stopTime = (atco: string, dep: string | null, extra = {}) => ({
    stop: { atco_code: atco, name: atco },
    aimed_arrival_time: null,
    aimed_departure_time: dep,
    ...extra,
  });

  it('returns the departure time and the stops before it', () => {
    const visit = findStopVisit(
      { times: [stopTime('A', '15:40'), stopTime('B', '15:44'), stopTime(STOP, '15:49'), stopTime('Z', '16:00')] },
      STOP,
    );
    expect(visit).toEqual({ seconds: 15 * 3600 + 49 * 60, before: ['A', 'B'] });
  });

  it('falls back to the arrival time', () => {
    const visit = findStopVisit(
      { times: [stopTime('A', '15:40'), stopTime(STOP, null, { aimed_arrival_time: '15:50' })] },
      STOP,
    );
    expect(visit?.seconds).toBe(15 * 3600 + 50 * 60);
  });

  it('skips set-down-only visits and trips that never call', () => {
    expect(findStopVisit({ times: [stopTime('A', '15:40'), stopTime(STOP, '15:49', { pick_up: false })] }, STOP)).toBeNull();
    expect(findStopVisit({ times: [stopTime('A', '15:40')] }, STOP)).toBeNull();
    expect(findStopVisit({ times: null }, STOP)).toBeNull();
  });
});

describe('buildDepartures', () => {
  const now = at('15:51');

  it('shows untracked buses at their timetabled time', () => {
    const [d] = buildDepartures(STOP, [scheduled(1, '16:09')], [], now);
    expect(d).toMatchObject({ tripId: 1, line: '302', expected: null, delay: null, stopsAway: null });
    expect(d.scheduled).toBe(at('16:09'));
  });

  it('adds the live delay of a late bus', () => {
    const [d] = buildDepartures(STOP, [scheduled(1, '15:49')], [vehicle(1, { delay: 240 })], now);
    expect(d.expected).toBe(at('15:53'));
    expect(d.delay).toBe(240);
    expect(d.stopsAway).toBe(3);
    expect(d.vehicleName).toBe('EWD120 - 241-L-2269');
  });

  it('tags the stop and works out when the bus reaches the end of its route', () => {
    const [untracked] = buildDepartures(STOP, [scheduled(1, '16:00')], [], now);
    expect(untracked.stop).toBe(STOP);
    expect(untracked.arrives).toBe(at('16:05'));
    const [late] = buildDepartures(STOP, [scheduled(1, '15:55')], [vehicle(1, { delay: 180 })], now);
    expect(late.arrives).toBe(at('16:08'));
  });

  it('never predicts an early bus before its timetabled time', () => {
    const [d] = buildDepartures(STOP, [scheduled(1, '16:09')], [vehicle(1, { delay: -635 })], now);
    expect(d.expected).toBe(at('16:09'));
    expect(d.delay).toBe(-635);
  });

  it('shows a tracked bus that is behind schedule but not yet here as due', () => {
    const [d] = buildDepartures(STOP, [scheduled(1, '15:40')], [vehicle(1, { delay: 0 })], now);
    expect(d.expected).toBe(now);
  });

  it('drops buses that have already passed the stop', () => {
    const passedHere = vehicle(1, { progress: { prev_stop: STOP, next_stop: 'Z', progress: 0.1 } });
    const beyond = vehicle(2, { progress: { prev_stop: 'Z', next_stop: 'Y', progress: 0.1 } });
    expect(buildDepartures(STOP, [scheduled(1, '15:55'), scheduled(2, '15:58')], [passedHere, beyond], now)).toEqual([]);
  });

  it('drops untracked buses once their time has gone', () => {
    expect(buildDepartures(STOP, [scheduled(1, '15:45')], [], now)).toEqual([]);
  });

  it('ignores stale positions and vehicles on another day', () => {
    const stale = vehicle(1, { datetime: new Date(now - 20 * 60_000).toISOString(), delay: 600 });
    const yesterday = vehicle(2, { date: '2026-10-21', delay: 600 });
    const result = buildDepartures(STOP, [scheduled(1, '16:00'), scheduled(2, '16:20')], [stale, yesterday], now);
    expect(result.map((d) => d.expected)).toEqual([null, null]);
  });

  it('leaves out departures beyond the horizon', () => {
    expect(buildDepartures(STOP, [scheduled(1, '20:00')], [], now)).toEqual([]);
  });

  it('sorts by expected time', () => {
    const result = buildDepartures(
      STOP,
      [scheduled(1, '15:55'), scheduled(2, '16:00'), scheduled(3, '16:10', undefined, '735')],
      [vehicle(1, { delay: 600 })],
      now,
    );
    expect(result.map((d) => d.tripId)).toEqual([2, 1, 3]);
  });

  it('drops a bus that has left the stop where its route starts', () => {
    const gone = vehicle(1, { delay: -300, progress: { prev_stop: 'C', next_stop: 'D', progress: 0.5 } });
    expect(buildDepartures(STOP, [scheduled(1, '15:40', [])], [gone], now)).toEqual([]);
  });

  it('keeps a bus waiting at the stop where its route starts', () => {
    const atTerminus = vehicle(1, { progress: { prev_stop: STOP, next_stop: 'A', progress: 0 } });
    const [d] = buildDepartures(STOP, [scheduled(1, '15:55', [])], [atTerminus], now);
    expect(d.tripId).toBe(1);
    expect(d.stopsAway).toBeNull();
  });
});

describe('sortLines', () => {
  it('sorts route names numerically and removes duplicates', () => {
    expect(sortLines(['735', '302A', '10', '302', 'X1', '2', '302'])).toEqual(['2', '10', '302', '302A', '735', 'X1']);
  });
});

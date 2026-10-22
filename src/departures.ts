import {
  fetchServicesAtStop,
  fetchTrip,
  fetchTrips,
  fetchVehicles,
  type Service,
  type TripDetail,
  type TripSummary,
  type Vehicle,
} from './api';
import { cacheGet, cacheSet } from './store';
import { addDays, localDate, parseClock, serviceTimeToEpoch } from './time';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How far ahead to look for departures. */
export const HORIZON_MS = 3 * HOUR;
/** Positions older than this are treated as lost tracking. */
const STALE_VEHICLE_MS = 10 * MINUTE;
/** Untracked buses drop off the board this long after their scheduled time. */
const SCHEDULED_GRACE_MS = MINUTE;
/** Parallel trip lookups, kept low to be gentle on bustimes.org. */
const TRIP_CONCURRENCY = 4;

/** When a trip calls at the stop, and which stops it calls at beforehand. */
export interface StopVisit {
  /** Seconds after the start of the service day. */
  seconds: number;
  /** ATCO codes of earlier stops on the trip, in order. */
  before: string[];
}

export interface Departure {
  tripId: number;
  /** ATCO code of the stop it leaves from (boards can cover several). */
  stop: string;
  line: string;
  destination: string;
  scheduled: number;
  /** Expected time from live tracking, or null if the bus isn't tracked. */
  expected: number | null;
  /** Seconds late (negative = running early); null if not tracked. */
  delay: number | null;
  /** Stops still to go before this one; null if unknown. */
  stopsAway: number | null;
  vehicleName: string | null;
  /** When it reaches the end of its route, including any delay. */
  arrives: number | null;
}

export interface Board {
  departures: Departure[];
  /** Every route that serves the stops, for the filter chips. */
  lines: string[];
  fetchedAt: number;
  /** False when the timetable loaded but live positions didn't. */
  liveOk: boolean;
}

/** Finds the first point on a trip where passengers can board at `atco`. */
export function findStopVisit(trip: Pick<TripDetail, 'times'>, atco: string): StopVisit | null {
  const times = trip.times ?? [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (t.stop.atco_code !== atco || t.pick_up === false) continue;
    const seconds = parseClock(t.aimed_departure_time ?? t.aimed_arrival_time);
    if (seconds === null) continue;
    return { seconds, before: times.slice(0, i).map((x) => x.stop.atco_code) };
  }
  return null;
}

export interface ScheduledTrip {
  trip: TripSummary;
  date: string;
  visit: StopVisit;
}

/** Merges timetable visits with live vehicle positions into a sorted board. */
export function buildDepartures(
  atco: string,
  scheduled: ScheduledTrip[],
  vehicles: Vehicle[],
  now: number,
  horizonMs = HORIZON_MS,
): Departure[] {
  const byTrip = new Map<number, Vehicle>();
  for (const v of vehicles) {
    if (v.trip_id == null) continue;
    if (now - Date.parse(v.datetime) > STALE_VEHICLE_MS) continue;
    byTrip.set(v.trip_id, v);
  }

  const departures: Departure[] = [];
  for (const { trip, date, visit } of scheduled) {
    const scheduledAt = serviceTimeToEpoch(date, visit.seconds);
    const vehicle = byTrip.get(trip.id);
    // Only trust a vehicle running today's instance of this trip.
    const live = vehicle && (!vehicle.date || vehicle.date === date) ? vehicle : undefined;

    let stopsAway: number | null = null;
    if (live?.progress && visit.before.length > 0) {
      const prev = live.progress.prev_stop;
      const prevIndex = visit.before.lastIndexOf(prev);
      // The bus has already left this stop, or is somewhere past it.
      if (prev === atco || prevIndex === -1) continue;
      stopsAway = visit.before.length - prevIndex;
    }

    const delay = live ? (live.delay ?? 0) : null;
    // Early buses normally wait at timing points, so (like bustimes.org)
    // never predict a departure before the timetable; the UI flags it.
    let expected = delay === null ? null : scheduledAt + Math.max(0, delay) * 1000;
    if (expected !== null && expected < now) {
      // Tracked and not yet past the stop, so it's due now, not gone.
      expected = now;
    }

    const end = parseClock(trip.end);
    const arrives =
      end === null ? null : serviceTimeToEpoch(date, end) + Math.max(0, delay ?? 0) * 1000;

    const when = expected ?? scheduledAt;
    if (!live && when < now - SCHEDULED_GRACE_MS) continue;
    if (when > now + horizonMs) continue;

    departures.push({
      tripId: trip.id,
      stop: atco,
      line: trip.service.line_name,
      destination: trip.headsign,
      scheduled: scheduledAt,
      expected,
      delay,
      stopsAway,
      vehicleName: live?.vehicle?.name ?? null,
      arrives,
    });
  }

  return departures.sort(byDepartureTime);
}

function byDepartureTime(a: Departure, b: Departure): number {
  return (a.expected ?? a.scheduled) - (b.expected ?? b.scheduled) || a.scheduled - b.scheduled;
}

/** Sorts route names the way people expect: 2, 10, 302, 302A, X1. */
export function sortLines(lines: Iterable<string>): string[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return [...new Set(lines)].sort(collator.compare);
}

// --- Loading -------------------------------------------------------------

async function getServices(atco: string): Promise<Service[]> {
  const key = `services:${atco}`;
  const cached = cacheGet<Service[]>(key);
  if (cached) return cached;
  const services = await fetchServicesAtStop(atco);
  cacheSet(key, services, 24 * HOUR);
  return services;
}

async function getTrips(serviceId: number, date: string): Promise<TripSummary[]> {
  const key = `trips:${serviceId}:${date}`;
  const cached = cacheGet<TripSummary[]>(key);
  if (cached) return cached;
  const trips = (await fetchTrips(serviceId, date)).map(({ id, start, end, headsign, service }) => ({
    id,
    start,
    end,
    headsign,
    service: { id: service.id, line_name: service.line_name },
  }));
  cacheSet(key, trips, 12 * HOUR);
  return trips;
}

/** Cached per trip; `null` records that the trip doesn't board here. */
async function getVisit(tripId: number, atco: string): Promise<StopVisit | null> {
  const key = `visit:${tripId}:${atco}`;
  const cached = cacheGet<StopVisit | null>(key);
  if (cached !== undefined) return cached;
  const visit = findStopVisit(await fetchTrip(tripId), atco);
  cacheSet(key, visit, 7 * 24 * HOUR);
  return visit;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Service dates whose trips could still be running now. */
function activeServiceDates(now: number): string[] {
  const today = localDate(now);
  // Late-night trips belong to the previous day's timetable (e.g. "24:30").
  const sinceMidnight = now - serviceTimeToEpoch(today, 0);
  return sinceMidnight < 4 * HOUR ? [addDays(today, -1), today] : [today];
}

/** Loads departures for one or more nearby stops as a single board. */
export async function loadBoard(atcos: string[], now = Date.now()): Promise<Board> {
  const perStop = await Promise.all(atcos.map((atco) => getServices(atco)));
  const services = [...new Map(perStop.flat().map((s) => [s.id, s])).values()];
  const dates = activeServiceDates(now);

  const tripLists = await Promise.all(
    services.flatMap((service) =>
      dates.map(async (date) => (await getTrips(service.id, date)).map((trip) => ({ trip, date }))),
    ),
  );

  // Trips that start before the horizon and haven't finished yet.
  const candidates = tripLists.flat().filter(({ trip, date }) => {
    const start = parseClock(trip.start);
    const end = parseClock(trip.end) ?? start;
    if (start === null || end === null) return false;
    return (
      serviceTimeToEpoch(date, start) <= now + HORIZON_MS &&
      serviceTimeToEpoch(date, end) >= now - 5 * MINUTE
    );
  });

  const lookups = atcos.flatMap((atco) => candidates.map((c) => ({ atco, c })));
  const visits = await mapLimit(lookups, TRIP_CONCURRENCY, ({ atco, c }) => getVisit(c.trip.id, atco));
  const scheduled = new Map<string, ScheduledTrip[]>(atcos.map((atco) => [atco, []]));
  lookups.forEach(({ atco, c }, i) => {
    const visit = visits[i];
    if (visit) scheduled.get(atco)!.push({ ...c, visit });
  });

  let vehicles: Vehicle[] = [];
  let liveOk = true;
  if (services.length > 0) {
    try {
      vehicles = await fetchVehicles(services.map((s) => s.id));
    } catch {
      liveOk = false;
    }
  }

  const departures = atcos
    .flatMap((atco) => buildDepartures(atco, scheduled.get(atco)!, vehicles, now))
    .sort(byDepartureTime);

  return {
    departures,
    lines: sortLines(services.map((s) => s.line_name)),
    fetchedAt: now,
    liveOk,
  };
}

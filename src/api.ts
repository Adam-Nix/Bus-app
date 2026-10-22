// Thin client for the parts of bustimes.org that allow cross-origin requests
// (the /api/ endpoints and the map's stops.json / vehicles.json feeds).

export const BUSTIMES = 'https://bustimes.org';

const TIMEOUT_MS = 10_000;

export interface Stop {
  atco_code: string;
  naptan_code: string | null;
  common_name: string;
  name: string;
  long_name: string;
  indicator: string | null;
  location: [number, number]; // [lon, lat]
  line_names: string[];
  active: boolean;
}

export interface Service {
  id: number;
  line_name: string;
  description: string;
  slug: string;
}

export interface TripSummary {
  id: number;
  start: string;
  end: string;
  headsign: string;
  service: { id: number; line_name: string };
}

export interface StopTime {
  stop: { atco_code: string; name: string };
  aimed_arrival_time: string | null;
  aimed_departure_time: string | null;
  pick_up?: boolean;
  set_down?: boolean;
}

export interface TripDetail extends TripSummary {
  times: StopTime[] | null;
}

export interface Vehicle {
  id: number;
  trip_id?: number | null;
  datetime: string;
  /** Service date of the trip the vehicle is running. */
  date?: string;
  destination?: string;
  delay?: number | null; // seconds; positive means late
  coordinates: [number, number];
  progress?: {
    prev_stop: string;
    next_stop: string;
    progress: number;
  } | null;
  service?: { line_name: string } | null;
  vehicle?: { name?: string } | null;
}

export interface NearbyStop {
  atco_code: string;
  name: string;
  indicator: string | null;
  services: string[];
  location: [number, number]; // [lon, lat]
  bearing: number | null;
}

interface Page<T> {
  next: string | null;
  results: T[];
}

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`bustimes.org returned ${status} for ${url}`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new HttpError(response.status, url);
  return response.json() as Promise<T>;
}

async function getAllPages<T>(url: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | null = url;
  // A stop or service never has more than a few pages; the cap guards
  // against looping forever on a misbehaving cursor.
  for (let page = 0; next && page < 10; page++) {
    const data: Page<T> = await getJson<Page<T>>(next);
    results.push(...data.results);
    next = data.next;
  }
  return results;
}

export async function fetchStop(atco: string): Promise<Stop | null> {
  const page = await getJson<Page<Stop>>(
    `${BUSTIMES}/api/stops/?atco_code__iexact=${encodeURIComponent(atco)}`,
  );
  return page.results[0] ?? null;
}

export async function fetchStopByNaptan(code: string): Promise<Stop | null> {
  const page = await getJson<Page<Stop>>(
    `${BUSTIMES}/api/stops/?naptan_code__iexact=${encodeURIComponent(code)}`,
  );
  return page.results[0] ?? null;
}

export async function fetchServicesAtStop(atco: string): Promise<Service[]> {
  const services = await getAllPages<Service>(
    `${BUSTIMES}/api/services/?stops=${encodeURIComponent(atco)}&limit=100`,
  );
  // The API can list a service once per matching route variant.
  return [...new Map(services.map((s) => [s.id, s])).values()];
}

export function fetchTrips(serviceId: number, date: string): Promise<TripSummary[]> {
  return getAllPages<TripSummary>(
    `${BUSTIMES}/api/trips/?service=${serviceId}&date=${date}&limit=500`,
  );
}

export function fetchTrip(tripId: number): Promise<TripDetail> {
  return getJson<TripDetail>(`${BUSTIMES}/api/trips/${tripId}/`);
}

export function fetchVehicles(serviceIds: number[]): Promise<Vehicle[]> {
  return getJson<Vehicle[]>(`${BUSTIMES}/vehicles.json?service=${serviceIds.join(',')}`);
}

interface StopFeatureCollection {
  features: {
    geometry: { coordinates: [number, number] };
    properties: {
      name: string;
      indicator: string | null;
      bearing: number | null;
      url: string;
      services?: string[];
    };
  }[];
}

export async function fetchStopsInBox(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): Promise<NearbyStop[]> {
  const data = await getJson<StopFeatureCollection>(
    `${BUSTIMES}/stops.json?xmin=${minLon}&ymin=${minLat}&xmax=${maxLon}&ymax=${maxLat}`,
  );
  return data.features.map((f) => ({
    atco_code: f.properties.url.split('/').pop() ?? '',
    name: f.properties.name,
    indicator: f.properties.indicator,
    services: f.properties.services ?? [],
    location: f.geometry.coordinates,
    bearing: f.properties.bearing,
  }));
}

export function stopPageUrl(atco: string): string {
  return `${BUSTIMES}/stops/${encodeURIComponent(atco)}`;
}

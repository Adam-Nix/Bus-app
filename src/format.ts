import type { Departure } from './departures';
import { formatClock, minutesUntil } from './time';

/** Escapes text for safe interpolation into HTML. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function departureTime(d: Departure): number {
  return d.expected ?? d.scheduled;
}

/** The big countdown: "Due", "4 min", or a clock time an hour or more out. */
export function countdown(d: Departure, now: number): { value: string; unit: string; label: string } {
  const minutes = minutesUntil(departureTime(d), now);
  if (minutes === 0) return { value: 'Due', unit: '', label: 'due now' };
  if (minutes < 60) {
    return { value: String(minutes), unit: 'min', label: `in ${minutes} minute${minutes === 1 ? '' : 's'}` };
  }
  const clock = formatClock(departureTime(d));
  return { value: clock, unit: '', label: `at ${clock}` };
}

/** "3 min late", "On time", "Running early", or null if not tracked. */
export function punctuality(d: Departure): string | null {
  if (d.delay === null) return null;
  const minutes = Math.round(d.delay / 60);
  if (minutes >= 2) return `${minutes} min late`;
  if (minutes <= -2) return 'Running early';
  return 'On time';
}

export function stopsAwayText(stops: number | null): string | null {
  if (stops === null) return null;
  return stops === 1 ? '1 stop away' : `${stops} stops away`;
}

/** Great-circle distance in metres between two [lon, lat] points. */
export function distanceMetres(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function distanceText(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Pulls a stop code out of a bustimes.org link or raw text. */
export function parseStopInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromUrl = text.match(/\/stops\/([A-Za-z0-9-]+)/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9-]{4,20}$/.test(text) ? text : null;
}

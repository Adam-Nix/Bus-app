// Timetables are published in local clock time. Great Britain and Ireland
// share the same UTC offsets all year, so one zone covers every stop.
export const TIME_ZONE = 'Europe/Dublin';

const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  timeZoneName: 'longOffset',
});

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const clockSecondsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** UTC offset of the local zone at the given instant, in milliseconds. */
function offsetAt(epochMs: number): number {
  const part = offsetFormatter.formatToParts(epochMs).find((p) => p.type === 'timeZoneName');
  const match = part?.value.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0; // "GMT" with no suffix means +00:00
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

/** Local calendar date (YYYY-MM-DD) at the given instant. */
export function localDate(epochMs: number): string {
  return dateFormatter.format(epochMs);
}

/** The calendar date `days` after `date` (both YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Parses a timetable time ("HH:MM" or "HH:MM:SS") into seconds after the
 * start of the service day. Hours may exceed 23 for trips after midnight.
 */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

/** Epoch milliseconds for `seconds` after local midnight on service `date`. */
export function serviceTimeToEpoch(date: string, seconds: number): number {
  const [y, m, d] = date.split('-').map(Number);
  const wallClock = Date.UTC(y, m - 1, d) + seconds * 1000;
  // Guess with the offset at the wall-clock time, then correct once in case
  // the guess landed on the other side of a daylight saving change.
  let epoch = wallClock - offsetAt(wallClock);
  epoch = wallClock - offsetAt(epoch);
  return epoch;
}

/** "15:49" in local time. */
export function formatClock(epochMs: number): string {
  return clockFormatter.format(epochMs);
}

/** "15:49:07" in local time. */
export function formatClockSeconds(epochMs: number): string {
  return clockSecondsFormatter.format(epochMs);
}

/** Whole minutes from `now` until `epochMs`, rounded down, never negative. */
export function minutesUntil(epochMs: number, now: number): number {
  return Math.max(0, Math.floor((epochMs - now) / 60_000));
}

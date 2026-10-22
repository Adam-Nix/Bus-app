import { describe, expect, it } from 'vitest';
import type { Departure } from '../src/departures';
import { countdown, distanceMetres, distanceText, escapeHtml, parseStopInput, punctuality, stopsAwayText } from '../src/format';

const now = Date.parse('2026-10-22T14:51:00Z');
const dep = (overrides: Partial<Departure>): Departure => ({
  tripId: 1,
  line: '302',
  destination: 'City Centre',
  scheduled: now,
  expected: null,
  delay: null,
  stopsAway: null,
  vehicleName: null,
  ...overrides,
});

describe('countdown', () => {
  it('says Due under a minute', () => {
    expect(countdown(dep({ scheduled: now + 30_000 }), now).value).toBe('Due');
  });

  it('counts minutes using the expected time when tracked', () => {
    expect(countdown(dep({ scheduled: now + 60_000, expected: now + 5 * 60_000 }), now)).toMatchObject({
      value: '5',
      unit: 'min',
    });
  });

  it('switches to a clock time an hour or more out', () => {
    expect(countdown(dep({ scheduled: now + 75 * 60_000 }), now).value).toBe('17:06');
  });
});

describe('labels', () => {
  it('describes punctuality', () => {
    expect(punctuality(dep({}))).toBeNull();
    expect(punctuality(dep({ delay: 30 }))).toBe('On time');
    expect(punctuality(dep({ delay: 240 }))).toBe('4 min late');
    expect(punctuality(dep({ delay: -635 }))).toBe('Running early');
  });

  it('describes stops away', () => {
    expect(stopsAwayText(null)).toBeNull();
    expect(stopsAwayText(1)).toBe('1 stop away');
    expect(stopsAwayText(4)).toBe('4 stops away');
  });

  it('formats distances', () => {
    expect(distanceText(123)).toBe('120 m');
    expect(distanceText(1530)).toBe('1.5 km');
    expect(Math.round(distanceMetres([-8.64914, 52.67419], [-8.653517, 52.675823]))).toBeGreaterThan(300);
  });

  it('escapes HTML', () => {
    expect(escapeHtml('<b>"Tom & Jerry\'s"</b>')).toBe('&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;');
  });
});

describe('parseStopInput', () => {
  it('accepts raw codes and bustimes.org links', () => {
    expect(parseStopInput(' 8400B6370801 ')).toBe('8400B6370801');
    expect(parseStopInput('https://bustimes.org/stops/8400B6370801')).toBe('8400B6370801');
    expect(parseStopInput('https://bustimes.org/stops/8400B6370801/departures?date=x')).toBe('8400B6370801');
  });

  it('rejects junk', () => {
    expect(parseStopInput('')).toBeNull();
    expect(parseStopInput('not a stop code!')).toBeNull();
  });
});

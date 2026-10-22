import { describe, expect, it } from 'vitest';
import { addDays, formatClock, localDate, minutesUntil, parseClock, serviceTimeToEpoch } from '../src/time';

describe('parseClock', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseClock('07:20')).toBe(7 * 3600 + 20 * 60);
    expect(parseClock('23:52:30')).toBe(23 * 3600 + 52 * 60 + 30);
  });

  it('allows hours past midnight on the service day', () => {
    expect(parseClock('24:15')).toBe(24 * 3600 + 15 * 60);
  });

  it('rejects missing or malformed values', () => {
    expect(parseClock(null)).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock('soon')).toBeNull();
  });
});

describe('serviceTimeToEpoch', () => {
  it('uses Irish Summer Time in summer', () => {
    expect(new Date(serviceTimeToEpoch('2026-07-01', parseClock('16:09')!)).toISOString()).toBe(
      '2026-07-01T15:09:00.000Z',
    );
  });

  it('uses GMT in winter', () => {
    expect(new Date(serviceTimeToEpoch('2026-12-01', parseClock('16:09')!)).toISOString()).toBe(
      '2026-12-01T16:09:00.000Z',
    );
  });

  it('rolls times past 24:00 into the next calendar day', () => {
    expect(new Date(serviceTimeToEpoch('2026-12-01', parseClock('24:30')!)).toISOString()).toBe(
      '2026-12-02T00:30:00.000Z',
    );
  });

  it('handles the day the clocks go back', () => {
    // Clocks went back at 02:00 IST on 25 October 2026.
    expect(new Date(serviceTimeToEpoch('2026-10-25', parseClock('00:30')!)).toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    );
    expect(new Date(serviceTimeToEpoch('2026-10-25', parseClock('12:00')!)).toISOString()).toBe(
      '2026-10-25T12:00:00.000Z',
    );
  });
});

describe('dates and formatting', () => {
  it('gives the local date, not the UTC date', () => {
    // 23:30 UTC in summer is already the next day in Ireland.
    expect(localDate(Date.parse('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formats local clock times', () => {
    expect(formatClock(Date.parse('2026-07-01T15:09:00Z'))).toBe('16:09');
  });

  it('counts whole minutes and never goes negative', () => {
    const now = Date.parse('2026-07-01T15:00:00Z');
    expect(minutesUntil(now + 4 * 60_000 + 59_000, now)).toBe(4);
    expect(minutesUntil(now - 60_000, now)).toBe(0);
  });
});

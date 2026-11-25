// The secret Bus Spotter: tap the little bus on the "Following" card five
// times to unlock it. Every live bus you catch with an alert is logged by its
// fleet number, so you can collect them.
import { readSetting, writeSetting } from './store';

const KEY = 'spotter';
const TAPS_TO_UNLOCK = 5;
const TAP_WINDOW_MS = 3000;

interface SpotterData {
  unlocked: boolean;
  /** Times each bus (fleet number and registration) has been caught. */
  seen: Record<string, number>;
}

function load(): SpotterData {
  return readSetting<SpotterData>(KEY) ?? { unlocked: false, seen: {} };
}

export function spotter(): SpotterData {
  return load();
}

export function recordSpot(vehicleName: string): void {
  const data = load();
  data.seen[vehicleName] = (data.seen[vehicleName] ?? 0) + 1;
  writeSetting(KEY, data);
}

export function spotterRank(total: number): string {
  if (total >= 30) return 'Legend of the 302';
  if (total >= 15) return 'Bus Nerd';
  if (total >= 5) return 'Regular';
  if (total >= 1) return 'Rookie Spotter';
  return 'New Spotter';
}

let taps: number[] = [];

/** Counts a tap on the bus; returns true when this tap unlocks the spotter. */
export function tapBus(now = Date.now()): boolean {
  const data = load();
  if (data.unlocked) return false;
  taps = [...taps.filter((t) => now - t < TAP_WINDOW_MS), now];
  if (taps.length < TAPS_TO_UNLOCK) return false;
  taps = [];
  writeSetting(KEY, { ...data, unlocked: true });
  return true;
}

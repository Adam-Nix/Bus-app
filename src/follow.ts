// Following one bus: keeps an eye on it and sends a notification when it's
// ALERT_MINUTES from the stop. This runs in the page, so it only works while
// the app is open (or briefly in the background); a fully closed web app
// can't run anything without a push server.
import { loadBoard, type Departure } from './departures';
import { readSetting, writeSetting } from './store';
import { formatClock, minutesUntil } from './time';

export const ALERT_MINUTES = 10;
const CHECK_MS = 30_000;
const KEY = 'followed';

export interface Followed {
  tripId: number;
  /** ATCO code of the stop the bus is caught at. */
  stop: string;
  /** Board to open when the card or notification is tapped. */
  board: string;
  stopName: string;
  line: string;
  destination: string;
  scheduled: number;
  expected: number | null;
  stopsAway: number | null;
  vehicleName: string | null;
  alerted: boolean;
}

export function followedTime(f: Followed): number {
  return f.expected ?? f.scheduled;
}

export function isFollowing(d: Departure, f: Followed | null): boolean {
  return f !== null && f.tripId === d.tripId && f.stop === d.stop;
}

export function alertDue(f: Followed, now: number): boolean {
  return !f.alerted && minutesUntil(followedTime(f), now) <= ALERT_MINUTES;
}

/**
 * Updates a followed bus from fresh departures. Returns null once it has
 * gone: it's no longer listed and its time has passed.
 */
export function updateFollowed(f: Followed, departures: Departure[], now: number): Followed | null {
  const d = departures.find((x) => isFollowing(x, f));
  if (!d) return followedTime(f) < now - 60_000 ? null : f;
  return { ...f, expected: d.expected, stopsAway: d.stopsAway, vehicleName: d.vehicleName ?? f.vehicleName };
}

// --- State ---------------------------------------------------------------

let followed: Followed | null = readSetting<Followed>(KEY);
const listeners = new Set<() => void>();
let alertListener: ((f: Followed) => void) | null = null;

export function getFollowed(): Followed | null {
  return followed;
}

function set(next: Followed | null): void {
  followed = next;
  writeSetting(KEY, next);
  listeners.forEach((l) => l());
}

export function onFollowChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called when the alert fires, e.g. to count the bus in the spotter. */
export function onAlert(listener: (f: Followed) => void): void {
  alertListener = listener;
}

export async function follow(d: Departure, board: string, stopName: string): Promise<void> {
  // Ask while we still have the tap, which browsers require.
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // Older Safari only supports the callback form; the in-app alert still works.
    }
  }
  set({
    tripId: d.tripId,
    stop: d.stop,
    board,
    stopName,
    line: d.line,
    destination: d.destination,
    scheduled: d.scheduled,
    expected: d.expected,
    stopsAway: d.stopsAway,
    vehicleName: d.vehicleName,
    alerted: false,
  });
  void check();
}

export function unfollow(): void {
  set(null);
}

export function notificationsBlocked(): boolean {
  return !('Notification' in window) || Notification.permission === 'denied';
}

// --- Watching ------------------------------------------------------------

let checking = false;

async function check(): Promise<void> {
  const f = followed;
  if (!f || checking) return;
  checking = true;
  try {
    const board = await loadBoard([f.stop], [f.line]);
    if (followed !== f) return; // Changed while loading.
    const now = Date.now();
    const next = updateFollowed(f, board.departures, now);
    if (next && alertDue(next, now)) {
      next.alerted = true;
      await notify(next, now);
      alertListener?.(next);
    }
    set(next);
  } catch {
    // Try again on the next check.
  } finally {
    checking = false;
  }
}

export function startFollowWatcher(): void {
  setInterval(() => void check(), CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  void check();
}

export function alertText(f: Followed, now: number): { title: string; body: string } {
  const minutes = minutesUntil(followedTime(f), now);
  const title = minutes <= 1 ? `🚌 Your ${f.line} is due now!` : `🚌 Your ${f.line} is ${minutes} min away`;
  const when = f.expected !== null ? `expected ${formatClock(f.expected)}` : `due ${formatClock(f.scheduled)}`;
  const away = f.stopsAway === null ? '' : ` · ${f.stopsAway} ${f.stopsAway === 1 ? 'stop' : 'stops'} away`;
  return { title, body: `To ${f.destination} from ${f.stopName}, ${when}${away}. Time to head to the stop!` };
}

async function notify(f: Followed, now: number): Promise<void> {
  navigator.vibrate?.([250, 120, 250, 120, 400]);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const { title, body } = alertText(f, now);
  const base = new URL(import.meta.env.BASE_URL, location.origin).href;
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    icon: `${base}pwa-192.png`,
    badge: `${base}badge-96.png`,
    tag: 'next-bus-follow',
    renotify: true,
    requireInteraction: true,
    vibrate: [250, 120, 250, 120, 400],
    data: { url: `${base}#/stop/${encodeURIComponent(f.board)}` },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // The in-app alert still shows.
  }
}


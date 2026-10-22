import type { WeatherKind } from './weather';

// Small line icons in the app's style; colours come from CSS classes so
// they follow light and dark mode.
const SUN = '<g class="wx-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>';
const MOON = '<path class="wx-moon" d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>';
const SMALL_SUN = '<g class="wx-sun"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M1.5 8H3M3.4 3.4l1 1M12.6 3.4l-1 1"/></g>';
const SMALL_MOON = '<path class="wx-moon" d="M12 9.5A4.5 4.5 0 0 1 6.5 4a4.5 4.5 0 1 0 5.5 5.5z"/>';
const CLOUD = '<path class="wx-cloud" d="M7 18h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7 9.5 4.25 4.25 0 0 0 7 18z"/>';
const RAIN_CLOUD = '<path class="wx-cloud" d="M7 14h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7 5.5 4.25 4.25 0 0 0 7 14z"/>';
const DRIZZLE = '<path class="wx-rain" d="M9 17.5v1M13 17.5v1M17 17.5v1"/>';
const RAIN = '<path class="wx-rain" d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>';
const SNOW = '<g class="wx-snow"><path d="M9 18h.01M13 18h.01M17 18h.01M11 21h.01M15 21h.01"/></g>';
const BOLT = '<path class="wx-bolt" d="M13 14l-3 4h3l-2 4"/>';
const FOG = '<path class="wx-cloud" d="M4 9h16M6 13h12M4 17h16"/>';

const SHAPES: Record<WeatherKind, (isDay: boolean) => string> = {
  clear: (isDay) => (isDay ? SUN : MOON),
  partly: (isDay) => `${isDay ? SMALL_SUN : SMALL_MOON}${CLOUD}`,
  cloud: () => CLOUD,
  fog: () => FOG,
  drizzle: () => `${RAIN_CLOUD}${DRIZZLE}`,
  rain: () => `${RAIN_CLOUD}${RAIN}`,
  snow: () => `${RAIN_CLOUD}${SNOW}`,
  thunder: () => `${RAIN_CLOUD}${BOLT}`,
};

export function weatherIcon(kind: WeatherKind, isDay: boolean): string {
  return `<svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true">${SHAPES[kind](isDay)}</svg>`;
}

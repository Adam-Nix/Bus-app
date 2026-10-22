// Current conditions and chance of rain from Open-Meteo (open-meteo.com):
// free, no key, and it allows cross-origin requests from a static site.
import { cacheGet, cacheGetStale, cacheSet } from './store';

const TIMEOUT_MS = 10_000;
const CACHE_MS = 15 * 60_000;

export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

export interface Weather {
  temperature: number;
  kind: WeatherKind;
  label: string;
  isDay: boolean;
  /** Chance of rain this hour, in percent. */
  rainChance: number | null;
}

/** Maps a WMO weather code to an icon kind and a short description. */
export function describeWeather(code: number): { kind: WeatherKind; label: string } {
  if (code === 0) return { kind: 'clear', label: 'Clear' };
  if (code === 1) return { kind: 'partly', label: 'Mostly clear' };
  if (code === 2) return { kind: 'partly', label: 'Partly cloudy' };
  if (code === 3) return { kind: 'cloud', label: 'Cloudy' };
  if (code === 45 || code === 48) return { kind: 'fog', label: 'Fog' };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', label: 'Drizzle' };
  if (code === 61 || code === 80) return { kind: 'rain', label: code === 80 ? 'Light showers' : 'Light rain' };
  if ((code >= 63 && code <= 67) || code === 81 || code === 82) {
    return { kind: 'rain', label: code >= 80 ? 'Showers' : 'Rain' };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'snow', label: 'Snow' };
  if (code >= 95) return { kind: 'thunder', label: 'Thunderstorms' };
  return { kind: 'cloud', label: 'Cloudy' };
}

interface ForecastResponse {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  hourly?: { precipitation_probability?: (number | null)[] };
}

export function parseForecast(data: ForecastResponse): Weather {
  const { kind, label } = describeWeather(data.current.weather_code);
  return {
    temperature: data.current.temperature_2m,
    kind,
    label,
    isDay: data.current.is_day === 1,
    rainChance: data.hourly?.precipitation_probability?.[0] ?? null,
  };
}

/** Weather near a [lon, lat] point; cached for 15 minutes, stale if offline. */
export async function loadWeather([lon, lat]: [number, number]): Promise<Weather> {
  // About 1 km precision is plenty for weather and shares the cache between
  // nearby stops.
  const key = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cacheGet<Weather>(key);
  if (cached) return cached;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      '&current=temperature_2m,weather_code,is_day&hourly=precipitation_probability&forecast_hours=1' +
      '&timezone=Europe%2FDublin';
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const weather = parseForecast(await response.json());
    cacheSet(key, weather, CACHE_MS);
    return weather;
  } catch (err) {
    const stale = cacheGetStale<Weather>(key);
    if (stale) return stale;
    throw err;
  }
}

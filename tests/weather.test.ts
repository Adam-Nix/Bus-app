import { describe, expect, it } from 'vitest';
import { describeWeather, parseForecast } from '../src/weather';

describe('describeWeather', () => {
  it('maps WMO codes to icons and labels', () => {
    expect(describeWeather(0)).toEqual({ kind: 'clear', label: 'Clear' });
    expect(describeWeather(2)).toEqual({ kind: 'partly', label: 'Partly cloudy' });
    expect(describeWeather(3)).toEqual({ kind: 'cloud', label: 'Cloudy' });
    expect(describeWeather(45).kind).toBe('fog');
    expect(describeWeather(53).kind).toBe('drizzle');
    expect(describeWeather(61)).toEqual({ kind: 'rain', label: 'Light rain' });
    expect(describeWeather(65)).toEqual({ kind: 'rain', label: 'Rain' });
    expect(describeWeather(81)).toEqual({ kind: 'rain', label: 'Showers' });
    expect(describeWeather(73).kind).toBe('snow');
    expect(describeWeather(95).kind).toBe('thunder');
  });
});

describe('parseForecast', () => {
  it('reads an Open-Meteo response', () => {
    const weather = parseForecast({
      current: { temperature_2m: 10.5, weather_code: 61, is_day: 1 },
      hourly: { precipitation_probability: [79] },
    });
    expect(weather).toEqual({ temperature: 10.5, kind: 'rain', label: 'Light rain', isDay: true, rainChance: 79 });
  });

  it('copes with no rain chance', () => {
    const weather = parseForecast({ current: { temperature_2m: 3, weather_code: 0, is_day: 0 } });
    expect(weather.rainChance).toBeNull();
    expect(weather.isDay).toBe(false);
  });
});

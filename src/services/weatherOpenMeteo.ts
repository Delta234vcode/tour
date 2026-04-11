export type WeatherDay = {
  date: string;
  city: string;
  tMin: number | null;
  tMax: number | null;
  code: number | null;
  precipProb: number | null;
  source: 'forecast' | 'archive' | 'unavailable';
};

const WMO = new Map<number, string>([
  [0, 'Ясно'],
  [1, 'Майже ясно'],
  [2, 'Хмарно'],
  [3, 'Похмуро'],
  [45, 'Туман'],
  [48, 'Туман'],
  [51, 'Морось'],
  [61, 'Дощ'],
  [80, 'Зливи'],
  [95, 'Гроза'],
]);

export function wmoLabel(code: number | null): string {
  if (code == null) return '—';
  return WMO.get(code) ?? `Код ${code}`;
}

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function geocodeCity(name: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const q = encodeURIComponent(name.trim());
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] };
  const r = j.results?.[0];
  if (!r) return null;
  const label = r.country ? `${r.name}, ${r.country}` : r.name;
  return { lat: r.latitude, lon: r.longitude, label };
}

async function fetchForecastDay(
  lat: number,
  lon: number,
  date: string,
  cityLabel: string
): Promise<WeatherDay> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  const res = await fetch(url.toString());
  if (!res.ok) {
    return { date, city: cityLabel, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  const j = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      weathercode?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const d = j.daily;
  if (!d?.time?.length) {
    return { date, city: cityLabel, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  const i = d.time.indexOf(date);
  if (i < 0) {
    return { date, city: cityLabel, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  return {
    date,
    city: cityLabel,
    tMax: d.temperature_2m_max?.[i] ?? null,
    tMin: d.temperature_2m_min?.[i] ?? null,
    code: d.weathercode?.[i] ?? null,
    precipProb: d.precipitation_probability_max?.[i] ?? null,
    source: 'forecast',
  };
}

async function fetchArchiveDay(
  lat: number,
  lon: number,
  date: string,
  cityLabel: string
): Promise<WeatherDay> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode,precipitation_sum');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  const res = await fetch(url.toString());
  if (!res.ok) {
    return { date, city: cityLabel, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  const j = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      weathercode?: number[];
    };
  };
  const d = j.daily;
  if (!d?.time?.length) {
    return { date, city: cityLabel, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  const i = d.time.indexOf(date);
  if (i < 0) {
    return { date, city: cityLabel, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  return {
    date,
    city: cityLabel,
    tMax: d.temperature_2m_max?.[i] ?? null,
    tMin: d.temperature_2m_min?.[i] ?? null,
    code: d.weathercode?.[i] ?? null,
    precipProb: null,
    source: 'archive',
  };
}

/**
 * Прогноз Open-Meteo: майбутнє/сьогодні до +15 днів — forecast; минуле — archive.
 * Дати поза вікном — рядок unavailable.
 */
export async function fetchWeatherForCityDate(
  cityName: string,
  dateIso: string
): Promise<WeatherDay> {
  const geo = await geocodeCity(cityName);
  if (!geo) {
    return { date: dateIso, city: cityName, tMin: null, tMax: null, code: null, precipProb: null, source: 'unavailable' };
  }
  const today = isoToday();
  const maxForecast = addDays(today, 15);
  if (dateIso >= today && dateIso <= maxForecast) {
    return fetchForecastDay(geo.lat, geo.lon, dateIso, geo.label);
  }
  if (dateIso < today) {
    return fetchArchiveDay(geo.lat, geo.lon, dateIso, geo.label);
  }
  return {
    date: dateIso,
    city: geo.label,
    tMin: null,
    tMax: null,
    code: null,
    precipProb: null,
    source: 'unavailable',
  };
}

export async function fetchWeatherMatrix(
  cities: string[],
  datesIso: string[]
): Promise<WeatherDay[]> {
  const c = [...new Set(cities.map((x) => x.trim()).filter(Boolean))];
  const d = [...new Set(datesIso)].sort();
  if (!c.length || !d.length) return [];
  const out: WeatherDay[] = [];
  for (const city of c) {
    for (const date of d) {
      out.push(await fetchWeatherForCityDate(city, date));
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return out;
}

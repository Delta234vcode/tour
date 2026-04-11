export type WeatherDay = {
  date: string;
  city: string;
  tMin: number | null;
  tMax: number | null;
  code: number | null;
  precipProb: number | null;
  /** typical_past — архів за той самий день/місяць у минулому році (немає реального прогнозу на далеке майбутнє) */
  source: 'forecast' | 'archive' | 'typical_past' | 'unavailable';
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

/**
 * Для майбутніх дат поза прогнозом: дата в архіві з тим самим місяцем/днем у недавньому році (< сьогодні).
 * Open-Meteo forecast лише ~16 днів; для туру через місяці показуємо кліматичний орієнтир з ERA5.
 */
function buildProxyPastIsoForFutureTourDate(dateIso: string): string {
  const parts = dateIso.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateIso;
  const [, tm, td] = parts;
  const today = isoToday();
  const todayY = parseInt(today.slice(0, 4), 10);

  const tryYear = (py: number, day: number): string | null => {
    const d = new Date(py, tm - 1, day);
    if (d.getFullYear() !== py || d.getMonth() !== tm - 1 || d.getDate() !== day) return null;
    const cand = `${py}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return cand < today ? cand : null;
  };

  for (let py = todayY - 1; py >= todayY - 12; py--) {
    const ok = tryYear(py, td);
    if (ok) return ok;
  }
  if (tm === 2 && td === 29) {
    for (let py = todayY - 1; py >= todayY - 12; py--) {
      const ok = tryYear(py, 28);
      if (ok) return ok;
    }
  }
  return `${todayY - 1}-${String(tm).padStart(2, '0')}-${String(Math.min(td, 28)).padStart(2, '0')}`;
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
 * Прогноз Open-Meteo: сьогодні…+15 днів — forecast; минуле — archive.
 * Далеке майбутнє — архів за той самий календарний день у минулому році (`typical_past`).
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
  /** Майбутнє далі ніж ~16 днів — реального прогнозу немає; беремо архів як орієнтир. */
  const proxyIso = buildProxyPastIsoForFutureTourDate(dateIso);
  const arch = await fetchArchiveDay(geo.lat, geo.lon, proxyIso, geo.label);
  if (arch.tMin == null && arch.tMax == null && arch.code == null) {
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
  return {
    date: dateIso,
    city: arch.city,
    tMin: arch.tMin,
    tMax: arch.tMax,
    code: arch.code,
    precipProb: null,
    source: 'typical_past',
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

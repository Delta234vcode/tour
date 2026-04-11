/**
 * Витягує дати з вільного тексту: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD.
 */
export function parseTourDatesFromText(raw: string): string[] {
  const s = (raw || '').trim();
  if (!s) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const pushIso = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  };

  const reDMY = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = reDMY.exec(s)) !== null) {
    pushIso(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
  }

  const reISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = reISO.exec(s)) !== null) {
    pushIso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  }

  out.sort();
  return out;
}

const UK_MONTHS: Record<string, number> = {
  січень: 1,
  лютий: 2,
  березень: 3,
  квітень: 4,
  травень: 5,
  червень: 6,
  липень: 7,
  серпень: 8,
  вересень: 9,
  жовтень: 10,
  листопад: 11,
  грудень: 12,
};

const EN_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function daysInMonth(y: number, month1: number): number {
  return new Date(y, month1, 0).getDate();
}

/** Кілька дат усередині місяця (щоб не робити десятки запитів до Open-Meteo). */
function sampleMonthToIso(y: number, month1: number, maxPerMonth: number): string[] {
  const dim = daysInMonth(y, month1);
  const out: string[] = [];
  const steps = Math.min(maxPerMonth, dim);
  if (steps <= 0) return out;
  for (let i = 0; i < steps; i++) {
    const d = Math.max(1, Math.round(1 + (i * (dim - 1)) / Math.max(1, steps - 1 || 1)));
    const iso = `${y}-${String(month1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    out.push(iso);
  }
  return [...new Set(out)].sort();
}

/**
 * Дати для погоди: явні дати + місяць/рік («вересень 2026», september 2026) + YYYY-MM (весь місяць, вибірка).
 * Обмеження загалом — щоб матриця міст×дати не роздулась.
 */
export function parsePeriodDatesForWeather(raw: string, maxDates = 20): string[] {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return [];

  const seen = new Set<string>();
  const add = (iso: string) => {
    if (seen.size >= maxDates) return;
    seen.add(iso);
  };

  for (const d of parseTourDatesFromText(raw)) {
    add(d);
  }

  const low = s.replace(/\s+/g, ' ');

  const ukKeys = Object.keys(UK_MONTHS).sort((a, b) => b.length - a.length);
  /** Без \\b: у JS межа «слова» не працює для кирилиці. */
  const reUk = new RegExp(`(${ukKeys.join('|')})\\s*(?:року)?\\s*(20\\d{2})`, 'gi');
  let mm: RegExpExecArray | null;
  while ((mm = reUk.exec(low)) !== null) {
    const mo = UK_MONTHS[mm[1].toLowerCase()];
    const y = parseInt(mm[2], 10);
    if (mo && y) {
      for (const iso of sampleMonthToIso(y, mo, 5)) {
        add(iso);
        if (seen.size >= maxDates) break;
      }
    }
  }

  const enKeys = Object.keys(EN_MONTHS).sort((a, b) => b.length - a.length);
  const reEn = new RegExp(`\\b(${enKeys.join('|')})\\.?\\s*(20\\d{2})\\b`, 'gi');
  while ((mm = reEn.exec(low)) !== null) {
    const mo = EN_MONTHS[mm[1].toLowerCase()];
    const y = parseInt(mm[2], 10);
    if (mo && y) {
      for (const iso of sampleMonthToIso(y, mo, 5)) {
        add(iso);
        if (seen.size >= maxDates) break;
      }
    }
  }

  const reYm = /\b(20\d{2})-(\d{2})\b(?!-\d{2})/g;
  while ((mm = reYm.exec(raw)) !== null) {
    const y = parseInt(mm[1], 10);
    const mo = parseInt(mm[2], 10);
    if (mo >= 1 && mo <= 12) {
      for (const iso of sampleMonthToIso(y, mo, 5)) {
        add(iso);
        if (seen.size >= maxDates) break;
      }
    }
  }

  return [...seen].sort();
}

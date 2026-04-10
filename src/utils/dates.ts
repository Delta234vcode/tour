/**
 * Поточна календарна дата в **локальному** часі браузера (YYYY-MM-DD).
 * Для порівняння з ISO-датами концертів без часу — не використовуйте UTC (`toISOString().slice(0,10)`).
 */
export function isoDateLocalToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Календарні повні місяці від `fromDay` до `toDay` (дати без часу), потім залишок у днях. */
export function calendarMonthsAndDaysBetween(
  fromDay: Date,
  toDay: Date
): { months: number; days: number } {
  const start = new Date(fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate());
  const end = new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate());
  if (end < start) return { months: 0, days: 0 };
  let months = 0;
  let cur = new Date(start);
  for (;;) {
    const next = new Date(cur);
    next.setMonth(next.getMonth() + 1);
    if (next <= end) {
      months++;
      cur = next;
    } else break;
  }
  const days = Math.round((end.getTime() - cur.getTime()) / 86400000);
  return { months, days: Math.max(0, days) };
}

export function ukMonthsPhrase(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} місяць`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} місяці`;
  return `${n} місяців`;
}

export function ukDaysPhrase(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} дні`;
  return `${n} днів`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Минулі концерти: скільки календарних місяців і днів пройшло від дати концерту до сьогодні. */
export function formatTimeSinceConcert(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const concert = new Date(iso + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (concert.getTime() > today.getTime()) return null;
  const { months, days } = calendarMonthsAndDaysBetween(concert, today);
  if (months === 0 && days === 0) return 'сьогодні';
  const parts: string[] = [];
  if (months > 0) parts.push(ukMonthsPhrase(months));
  if (days > 0) parts.push(ukDaysPhrase(days));
  return parts.join(', ');
}

/** Майбутні концерти: скільки повних місяців і днів залишилось від сьогодні до дати. */
export function formatTimeUntilConcert(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const concert = new Date(iso + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (concert.getTime() < today.getTime()) return null;
  const { months, days } = calendarMonthsAndDaysBetween(today, concert);
  if (months === 0 && days === 0) return 'сьогодні';
  const parts: string[] = [];
  if (months > 0) parts.push(ukMonthsPhrase(months));
  if (days > 0) parts.push(ukDaysPhrase(days));
  return parts.join(', ');
}

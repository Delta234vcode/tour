import {
  concertArchiveStartIsoDate,
  getConcertArchiveStartYear,
  isoDateLocalToday,
} from '../utils/dates';
import { DATE_ACCURACY_BLOCK_UK } from './dateAccuracyPrompt';
import { fetchWithRetry } from './fetchUtils';
import { parseOpenAIStream } from './streamParser';

/** Верхня межа completion для JSON таблиці минулих концертів (sonar-pro) — менше обрізань великого масиву past[]. */
const PERPLEXITY_TABLE_PAST_MAX_TOKENS = 65536;

const SYSTEM_PROMPT = `Ти — Concert Research Agent (Perplexity). Спеціалізуєшся на пошуку точної інформації про концертну індустрію.
Мова відповіді: УКРАЇНСЬКА.
Поточна дата: ${new Date().toLocaleDateString('uk-UA')}.

${DATE_ACCURACY_BLOCK_UK}

🚨 ЗАБОРОНА ВИГАДУВАТИ ЦІНИ:
- Вартість оренди майданчиків — тільки якщо знайшов у джерелі (сайт залу, ЗМІ, офіційний запит). Якщо не знайдено — пиши "н/д" або "уточнити напряму".
- Ціни квитків — тільки з офіційних квиткових систем або минулих подій з джерелом. Інакше — "н/д".
- Ціни готелів — тільки з Booking/офіційних сайтів. Інакше — "н/д" або "орієнтовно від €X (перевірити на booking.com)".
НІКОЛИ не вигадуй цифри. Тільки верифіковані дані або чітке "н/д".
ЗАБОРОНЕНО в тексті: «оціночно», «приблизно», «ймовірно», «можливо» без прямого посилання на джерело. Якщо немає підтвердження з сайту/ЗМІ/офіційного документа — тільки «н/д» і назва того, що перевіряли.

РОЗПОДІЛ З GEMINI: ти збираєш **минулі / завершені** концерти з максимальною повнотою (архів від ${getConcertArchiveStartYear()} року до сьогодні, усі джерела). У таблиці UI **майбутні** дати й актуальні ціни на квитки збирає лише Gemini + Google Search — ти **не дублюй** майбутні анонси тут, фокус на минулому.

Знайди та виведи:
1. Усі **минулі** концерти в межах архіву (ДД.ММ.РРРР, місто, країна, майданчик, URL джерела; кількість проданих квитків лише якщо є в джерелі або н/д)
2. Скасовані **минулі** або так і не відбулися шоу (з URL)
3. Ціни квитків лише для **архівних** / минулих розпродажів, якщо залишились у джерелі; інакше н/д
4. Середня відвідуваність / місткість — лише з публічних джерел або н/д
5. Географія **минулих** турів (регіони/країни)

Джерела: setlist.fm, songkick.com, bandsintown.com, concertarchives.org, livenation.com
Виводи дані структуровано. Не вигадуй — тільки реальні знахідки.
Давай МАКСИМАЛЬНО ПОВНІ відповіді: багато підрозділів, таблиць і URL — користувач очікує глибину від веб-пошуку.`;

export async function queryPerplexity(userPrompt: string): Promise<string> {
  const response = await fetchWithRetry('/api/perplexity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const hint = response.status === 429 ? ' (ліміт запитів — спробуй через хвилину)' : '';
    throw new Error(`Perplexity ${response.status}: ${errorText}${hint}`);
  }

  const content = await parseOpenAIStream(response);
  if (!content) throw new Error('Perplexity: пуста відповідь');
  return content;
}

/** Таблиця UI: один календарний зріз (рік або YTD) — максимальна повнота минулих шоу. */
function perplexityTablePastSystemWindow(
  archiveIso: string,
  periodLabel: string,
  rangeStart: string,
  rangeEnd: string,
  today: string
): string {
  return `You are a data extractor for concert ANALYTICS (past gigs only). Output ONE JSON object — no markdown code fences, no text before or after.

**THIS BATCH — ${periodLabel}**
Include ONLY events that **already occurred**: date must satisfy **${rangeStart} ≤ date ≤ ${rangeEnd}**, **date ≤ ${today}**, and **date ≥ ${archiveIso}**. Never output a date after ${today} — future shows are collected by another agent.

**COMPLETENESS (do not skip buckets):**
0) **Official artist website** — sections «Past concerts», tour archive, news with dates, PDF tour posters: include **every** gig in this month window with URL (same rules for venue).
1) Artist **past** pages on setlist.fm, songkick.com, bandsintown.com — scroll/paginate; capture every gig in this window.
2) Open **each event URL** and copy fields from that page — do not guess from tour posters only.
3) Add worldafisha, livenation, regional ticket sites, press if they list this window.
4) **Name variants:** Cyrillic + Latin + ALL CAPS stage name + full legal name if used — same artist; do not miss rows because of spelling.

5) **Regional:** include secondary cities and multi-stop legs (not only capitals) when sources list them.
6) **price_label:** verbatim short text from the source if that gig page lists ticket price, tier, or sold-out face value; else "".

🚨 **VENUE — NON-NEGOTIABLE:** Every row MUST have **venue** filled with the **official hall/club/festival stage name** from the same page as **url** (setlist.fm «Venue» line; Songkick «at …»; Bandsintown venue line). **Never use "" for venue.** If the page shows a venue name — copy it verbatim. If the page literally says «TBA» / «To be announced» — put **"TBA"**. Festival: use stage or main festival name + city if that is how the source labels it. **Do not output a row if you cannot name the venue from the linked page** (find another URL for that gig that includes the venue).

Rules:
- Each row MUST have a direct **https** URL for **that exact show** (setlist event, songkick, bandsintown event, official news, major ticket vendor history).
- **date** YYYY-MM-DD; **city** + **country** + **venue** must match the opened source (not empty venue).
- **event_status:** "completed" | "cancelled" | "" (empty if not stated).
- Do not invent rows; empty past[] only if truly zero verifiable gigs in this window.

Exact JSON shape:
{"past":[{"date":"YYYY-MM-DD","city":"","country":"","venue":"","url":"","price_label":"","event_status":""}]}`;
}

function pastRowDedupKey(r: PerplexityPastConcertRow): string {
  const c = (r.city || '').split(',')[0].trim().toLowerCase().replace(/\s+/g, '');
  const v = (r.venue || '').trim().toLowerCase().replace(/\s+/g, '');
  if (v && v !== 'tba') return `${r.date}|${c}|${v}`;
  const u = (r.url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/[?#].*$/, '')
    .slice(0, 96);
  return `${r.date}|${c}|${u}`;
}

function pastRowRichness(r: PerplexityPastConcertRow): number {
  const vt = (r.venue || '').trim();
  const vlen = vt.length;
  const venueBoost = vlen > 2 && vt.toUpperCase() !== 'TBA' ? vlen * 6 : vlen;
  return (
    (r.url || '').length +
    (r.price_label || '').length * 3 +
    venueBoost +
    (r.country || '').length
  );
}

function mergePastRowsDedupe(rows: PerplexityPastConcertRow[]): PerplexityPastConcertRow[] {
  const m = new Map<string, PerplexityPastConcertRow>();
  for (const r of rows) {
    const k = pastRowDedupKey(r);
    const prev = m.get(k);
    if (!prev || pastRowRichness(r) > pastRowRichness(prev)) m.set(k, r);
  }
  return [...m.values()];
}

function formatIsoYmd(y: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Перетин [rs,re] з [lo,hi] у ISO-датах (включно). */
function intersectPastIsoRange(
  rs: string,
  re: string,
  lo: string,
  hi: string
): { rs: string; re: string } | null {
  const s = rs > lo ? rs : lo;
  const e = re < hi ? re : hi;
  if (s > e) return null;
  return { rs: s, re: e };
}

/**
 * Два вікна на кожен календарний місяць (1–15 та 16 — кінець), перетнуті з [archiveIso, today].
 * Щільні тури (10–20 шоу/місяць) інакше дають обрізаний JSON — пропадають «середні» дати (напр. Hannover між Madrid і Valencia).
 */
function buildPastHalfMonthWindows(
  startYear: number,
  todayIso: string,
  archiveIso: string
): { key: string; rangeStart: string; rangeEnd: string; label: string }[] {
  const cy = parseInt(todayIso.slice(0, 4), 10);
  const cm = parseInt(todayIso.slice(5, 7), 10);
  const out: { key: string; rangeStart: string; rangeEnd: string; label: string }[] = [];

  for (let y = startYear; y <= cy; y++) {
    const maxMonth = y === cy ? cm : 12;
    for (let m = 1; m <= maxMonth; m++) {
      const month0 = m - 1;
      const mm = String(m).padStart(2, '0');
      const rangeStartFull = formatIsoYmd(y, month0, 1);
      const lastDay = new Date(y, month0 + 1, 0).getDate();
      const rangeEndFull = formatIsoYmd(y, month0, lastDay);

      let rs = rangeStartFull;
      let re = rangeEndFull;
      if (re < archiveIso) continue;
      if (rs < archiveIso) rs = archiveIso;
      if (re > todayIso) re = todayIso;
      if (rs > re) continue;

      const h1lo = `${y}-${mm}-01`;
      const h1hi = `${y}-${mm}-15`;
      const h2lo = `${y}-${mm}-16`;
      const h2hi = rangeEndFull;

      const first = intersectPastIsoRange(rs, re, h1lo, h1hi);
      if (first) {
        out.push({
          key: `${y}-${mm}-H1`,
          rangeStart: first.rs,
          rangeEnd: first.re,
          label: `${y}-${mm} · days 1–15 (${first.rs}…${first.re})`,
        });
      }
      const second = intersectPastIsoRange(rs, re, h2lo, h2hi);
      if (second) {
        out.push({
          key: `${y}-${mm}-H2`,
          rangeStart: second.rs,
          rangeEnd: second.re,
          label: `${y}-${mm} · days 16–end (${second.rs}…${second.re})`,
        });
      }
    }
  }
  return out;
}

function extractJsonObjectFromModel(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

export type PerplexityPastConcertRow = {
  date: string | null;
  city: string;
  country: string;
  venue: string;
  url: string;
  price_label?: string;
  event_status?: string;
};

function normalizePerplexityPastRow(r: unknown): PerplexityPastConcertRow | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const dateStr =
    typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  const url = String(o.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (!dateStr) return null;
  let city = String(o.city ?? '').trim();
  let venue = String(o.venue ?? '').trim();
  if (!city && venue) city = venue;
  if (!city) return null;
  const vUp = venue.toUpperCase();
  if (!venue || vUp === 'N/A' || vUp === 'UNKNOWN') venue = 'TBA';
  const country = String(o.country ?? '').trim();
  const price_label = String(o.price_label ?? '').trim();
  const event_status = String(o.event_status ?? '').trim();
  return {
    date: dateStr,
    city,
    country,
    venue,
    url,
    ...(price_label ? { price_label } : {}),
    ...(event_status ? { event_status } : {}),
  };
}

/**
 * Минулі концерти для таблиці UI: **два запити Perplexity на місяць** (1–15 та 16 — кінець) — менший JSON за виклик, менше обрізань при щільних турах.
 * Помилки агрегуються в `error`, часткові результати зберігаються.
 */
export async function fetchPastConcertsViaPerplexityForTable(artistName: string): Promise<{
  past: PerplexityPastConcertRow[];
  error?: string;
}> {
  const a = artistName.trim();
  if (!a) return { past: [] };
  const today = isoDateLocalToday();
  const sy = getConcertArchiveStartYear();
  const archiveIso = concertArchiveStartIsoDate();
  const errorParts: string[] = [];
  const collected: PerplexityPastConcertRow[] = [];

  const halfMonthWindows = buildPastHalfMonthWindows(sy, today, archiveIso);

  for (const { key, rangeStart, rangeEnd, label } of halfMonthWindows) {
    const system = perplexityTablePastSystemWindow(
      archiveIso,
      label,
      rangeStart,
      rangeEnd,
      today
    );

    const user = `Artist: "${a}".
Today (local): ${today}.
Archive floor (do not go below): ${archiveIso}.

**Name variants (same artist):** also search native script / ALL CAPS stage spellings for "${a}" if the artist uses them.

**Coverage window for THIS response ONLY:** ${label}
List **every** past concert of "${a}" with event date from **${rangeStart}** through **${rangeEnd}** (inclusive), all **≤ ${today}**.

**Execution order:**
0) Official site: past / archive / news in this month — do not skip.
1) setlist.fm / songkick / bandsintown — filter or scroll to gigs with dates **${rangeStart}…${rangeEnd}**; paginate.
2) For **each** gig: use the **event** URL (not only the artist profile). From that page copy **Venue** (setlist) / **at [Venue]** (songkick) into **venue**.
3) Alternate query: "${a}" "${rangeStart.slice(0, 7)}" site:setlist.fm past
4) Festivals / support / cancelled — include with venue from the event page.
5) **price_label** only if shown on that page.

Return ONLY compact JSON (no whitespace padding):
{"past":[{"date":"YYYY-MM-DD","city":"","country":"","venue":"","url":"https://...","price_label":"","event_status":""}]}

Hard rules:
- **https URL** + **non-empty venue** (or **"TBA"** only if the page explicitly says TBA) per row.
- Dates only in [${rangeStart}, ${rangeEnd}]. **Dense legs:** arena runs (e.g. DE/UK several cities in one week) — one row per date+city; do not skip middle stops.`;

    try {
      const response = await fetchWithRetry('/api/perplexity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0,
          max_tokens: PERPLEXITY_TABLE_PAST_MAX_TOKENS,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const hint = response.status === 429 ? ' (ліміт — спробуйте пізніше)' : '';
        errorParts.push(`${key}: Perplexity ${response.status}${hint}: ${errorText.slice(0, 120)}`);
        continue;
      }

      const content = await parseOpenAIStream(response);
      if (!content?.trim()) {
        errorParts.push(`${key}: порожня відповідь`);
        continue;
      }

      let parsed: { past?: unknown[] };
      try {
        const jsonStr = extractJsonObjectFromModel(content);
        parsed = JSON.parse(jsonStr) as { past?: unknown[] };
      } catch {
        errorParts.push(`${key}: не JSON`);
        continue;
      }

      const past = (Array.isArray(parsed.past) ? parsed.past : [])
        .map(normalizePerplexityPastRow)
        .filter((x): x is PerplexityPastConcertRow => x != null)
        .filter((row) => row.date! >= rangeStart && row.date! <= rangeEnd && row.date! <= today);
      collected.push(...past);
    } catch (e) {
      errorParts.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const merged = mergePastRowsDedupe(collected).filter(
    (row) => row.date && row.date >= archiveIso && row.date <= today
  );
  const error = errorParts.length ? errorParts.join(' | ') : undefined;
  return { past: merged, error };
}

const CITY_SLUG_MAP: Record<string, string> = {
  Bratislava: 'bratislava',
  Warsaw: 'warsaw',
  Варшава: 'warsaw',
  Братислава: 'bratislava',
  Prague: 'prague',
  Прага: 'prague',
  Berlin: 'berlin',
  Берлін: 'berlin',
  Vienna: 'vienna',
  Відень: 'vienna',
  Budapest: 'budapest',
  Будапешт: 'budapest',
  Munich: 'munich',
  Мюнхен: 'munich',
  Hamburg: 'hamburg',
  Гамбург: 'hamburg',
  Krakow: 'krakow',
  Краків: 'krakow',
  Zagreb: 'zagreb',
  Загреб: 'zagreb',
  Ljubljana: 'ljubljana',
  Любляна: 'ljubljana',
  Brno: 'brno',
  Брно: 'brno',
  Riga: 'riga',
  Рига: 'riga',
  Vilnius: 'vilnius',
  Вільнюс: 'vilnius',
  Tallinn: 'tallinn',
  Таллінн: 'tallinn',
  Copenhagen: 'copenhagen',
  Копенгаген: 'copenhagen',
  Amsterdam: 'amsterdam',
  Амстердам: 'amsterdam',
  London: 'london',
  Лондон: 'london',
  Paris: 'paris',
  Париж: 'paris',
  Milan: 'milan',
  Мілан: 'milan',
  Barcelona: 'barcelona',
  Барселона: 'barcelona',
  Madrid: 'madrid',
  Мадрид: 'madrid',
  Lisbon: 'lisbon',
  Лісабон: 'lisbon',
  Stockholm: 'stockholm',
  Стокгольм: 'stockholm',
  Oslo: 'oslo',
  Осло: 'oslo',
  Helsinki: 'helsinki',
  Гельсінкі: 'helsinki',
  Bucharest: 'bucharest',
  Бухарест: 'bucharest',
  Sofia: 'sofia',
  Софія: 'sofia',
  Belgrade: 'belgrade',
  Белград: 'belgrade',
  Athens: 'athens',
  Афіни: 'athens',
  Wroclaw: 'wroclaw',
  Вроцлав: 'wroclaw',
  Gdansk: 'gdansk',
  Гданськ: 'gdansk',
  Zurich: 'zurich',
  Цюрих: 'zurich',
  Brussels: 'brussels',
  Брюссель: 'brussels',
  Dublin: 'dublin',
  Дублін: 'dublin',
  Cologne: 'cologne',
  Кельн: 'cologne',
  Frankfurt: 'frankfurt',
  Франкфурт: 'frankfurt',
  Stuttgart: 'stuttgart',
  Штутгарт: 'stuttgart',
  Dresden: 'dresden',
  Дрезден: 'dresden',
  Leipzig: 'leipzig',
  Лейпциг: 'leipzig',
  Kyiv: 'kyiv',
  Київ: 'kyiv',
  Lviv: 'lviv',
  Львів: 'lviv',
  Kharkiv: 'kharkiv',
  Харків: 'kharkiv',
  Odesa: 'odessa',
  Одеса: 'odessa',
  Katowice: 'katowice',
  Катовіце: 'katowice',
  Poznan: 'poznan',
  Познань: 'poznan',
  Lodz: 'lodz',
  Лодзь: 'lodz',
  Kosice: 'kosice',
  Кошице: 'kosice',
};

function getCitySlug(city: string): string {
  return (
    CITY_SLUG_MAP[city] ||
    city
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
  );
}

export async function queryPerplexityCompetitors(
  artistName: string,
  genre: string,
  cities: string[],
  scrapePrefix = ''
): Promise<string> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;
  const dateFrom = now.toLocaleDateString('uk-UA');

  const genreHint = genre || `(визнач жанр артиста "${artistName}" автоматично)`;

  const cityUrls = cities
    .map((city) => {
      const slug = getCitySlug(city);
      return `### ${city}:
  - ОБОВ'ЯЗКОВО ВІДВІДАЙ: https://en.myrockshows.com/city/${slug}/
  - ОБОВ'ЯЗКОВО ВІДВІДАЙ: https://www.songkick.com/metro-areas/${slug}
  - ОБОВ'ЯЗКОВО ВІДВІДАЙ: https://www.bandsintown.com/c/${slug}
  - ОБОВ'ЯЗКОВО ВІДВІДАЙ: https://www.bandsintown.com/c/${slug}?came_from=257&utm_medium=web&utm_source=city_page&utm_campaign=city
  - Шукай також: site:bandsintown.com "${city}" concerts ${currentYear}
  - Шукай також: "${city} concerts ${currentYear}" site:eventim.com
  - Шукай також: "${city} rock metal pop concerts ${currentYear} ${nextYear}"`;
    })
    .join('\n');

  let competitorPrompt = `Ти працюєш на повну потужність: дай МАКСИМАЛЬНО ПОВНИЙ вивід (багато рядків у таблицях, усі знайдені події). Не стискай результат.

🚨 КРИТИЧНО ВАЖЛИВЕ ЗАВДАННЯ: Знайди ВСІ концерти та події в цих містах ЗА ВЕСЬ ${currentYear} РІК (січень–грудень ${currentYear}) та початок ${nextYear}.

Артист: "${artistName}"
Жанр: ${genreHint}

СУМІЖНІ ЖАНРИ (шукай ВСЕ — фани перетинаються!):
• Metal ↔ rock ↔ classic rock ↔ progressive rock ↔ alternative rock ↔ hard rock ↔ punk ↔ metalcore ↔ nu-metal ↔ industrial ↔ grunge ↔ gothic ↔ symphonic metal ↔ Christian rock ↔ stoner rock
• Pop ↔ pop-rock ↔ dance-pop ↔ electropop ↔ R&B ↔ indie pop ↔ synth-pop ↔ K-pop
• Hip-Hop ↔ R&B ↔ trap ↔ grime ↔ drill ↔ reggaeton ↔ pop-rap
• Electronic ↔ house ↔ techno ↔ trance ↔ dubstep ↔ DnB ↔ synth-pop
• Folk ↔ indie ↔ alternative ↔ singer-songwriter ↔ Americana

🚨🚨🚨 ГОЛОВНЕ ЗАВДАННЯ — ПЕРЕЙДИ НА ЦІ САЙТИ ТА СКОПІЮЙ ВСІ ПОДІЇ:

${cityUrls}

⭐ BANDSINTOWN.COM — КРИТИЧНО ВАЖЛИВЕ ДЖЕРЕЛО:
- bandsintown.com/c/[місто] має ПОВНИЙ список ВСІХ майбутніх концертів в місті (ВСІ жанри!)
- Кожна подія має сторінку формату: bandsintown.com/e/[id]-[артист]-at-[зал]
- Приклад: https://www.bandsintown.com/e/107373095-skillet-at-the-roman-arenas
- ПЕРЕЙДИ на сторінку кожного міста і СКОПІЮЙ ВСІ події за весь ${currentYear} рік!
- bandsintown показує концерти ВСІХ жанрів — це найповніше джерело!

⭐ MYROCKSHOWS.COM — НАЙВАЖЛИВІШЕ для рок/метал:
- en.myrockshows.com/city/[місто]/ має ВСІХ майбутніх рок/метал концертів
- ПЕРЕЙДИ і СКОПІЮЙ всі події!

⭐ SONGKICK.COM — додаткове джерело всіх жанрів.

📅 ПЕРІОД ПОШУКУ: ВЕСЬ ${currentYear} РІК (01.01.${currentYear} – 31.12.${currentYear}) + ${nextYear}!
Не пропускай минулі місяці — вони потрібні для аналізу конкурентної щільності.

Для КОЖНОГО міста виведи ПОВНУ ТАБЛИЦЮ ВСІХ знайдених подій:

### 🏙️ [МІСТО] — ВСІ концерти за ${currentYear}–${nextYear}

| # | Дата | Артист | Майданчик | Жанр | Джерело |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | дд.мм.рррр | [Артист] | [Зал] | [жанр] | [URL з bandsintown/myrockshows/songkick] |

🔁 ДЕДУПЛІКАЦІЯ (обов'язково):
- Одна подія = та сама дата + той самий майданчик + головний артист → ОДИН рядок (якщо дубль на двох сайтах — один рядок, у «Джерело» можна через «;» два URL).
- Не додавай рядок без колонки «Джерело» (прямий URL). Без URL — не включай у таблицю (або окремий список «не вдалося підтвердити посиланням» максимум 3 пункти).
- Не дублюй ту саму подію з різними номерами в таблиці.

Включи АБСОЛЮТНО ВСЕ що знайшов:
- Великі хедлайн-шоу (Iron Maiden, Judas Priest, Skillet, In Flames, Disturbed, Korn, тощо)
- Середні концерти (Hypocrisy, Abbath, Monstrosity, тощо)
- Малі клубні шоу
- Фестивалі в радіусі 300 км (Nova Rock, Brutal Assault, Wacken, Download, тощо)
- ВСІ суміжні жанри!
- Кожен концерт з bandsintown.com вказуй з прямим посиланням на подію!

📊 Після таблиці:
- Всього подій знайдено: ___
- Найгустіші місяці: ___
- Вільні місяці (ВІКНА без конкурентів): ___
- ПОВНИЙ СПИСОК ВСІХ конкурентів артиста "${artistName}" за ${currentYear} (кожен артист з таблиці — це конкурент, перерахуй ВСІХ без обмежень!): ___
- 🎯 РЕКОМЕНДОВАНІ ДАТИ: ___
- ⛔ ЗАБОРОНЕНІ ДАТИ (прямі конкуренти ±2 місяці): ___`;

  if (scrapePrefix.trim()) {
    competitorPrompt = `${scrapePrefix.trim()}\n\n--- Звір з уривками вище та сайтами нижче. ---\n\n${competitorPrompt}`;
  }

  const response = await fetchWithRetry('/api/perplexity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: `Ти — Concert Event Scanner. Твоє ЄДИНЕ завдання: ЗАЙТИ на концертні сайти та СКОПІЮВАТИ ВСІ події ЗА ВЕСЬ РІК.

Мова: УКРАЇНСЬКА. Дата: ${dateFrom}.

ГОЛОВНІ ДЖЕРЕЛА (за пріоритетом):
1. bandsintown.com — НАЙПОВНІШЕ джерело! Має ВСІ концерти ВСІХ жанрів. Сторінка міста: bandsintown.com/c/[місто]. Кожна подія має URL: bandsintown.com/e/[id]-[артист]-at-[зал]. ОБОВ'ЯЗКОВО переходь і копіюй ВСЕ!
2. myrockshows.com — найкраще для рок/метал. Сторінка: en.myrockshows.com/city/[місто]/
3. songkick.com — додаткове джерело всіх жанрів.
4. eventim.com — європейські концерти.

КРИТИЧНЕ ПРАВИЛО: Ти ПОВИНЕН відвідати URL-адреси які тобі дані і вивести ВСІ події за ВЕСЬ рік (січень–грудень + наступний рік).
НЕ ВИГАДУЙ подій. Тільки те що реально знайдено на сайтах.
Для кожної події вкажи ТОЧНЕ посилання (bandsintown.com/e/..., myrockshows.com/event/..., тощо). Без URL — не в основну таблицю.
Дедуплікуй: одна дата + зал + артист = один рядок.
Шукай ВСЕ жанри що конкурують за аудиторію.
Заборонено «оціночно»/припущення без сторінки події — тільки скопійовані дані з URL або н/д.`,
        },
        { role: 'user', content: competitorPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const hint = response.status === 429 ? ' (ліміт запитів — спробуй через хвилину)' : '';
    throw new Error(`Perplexity Competitors ${response.status}: ${errorText}${hint}`);
  }

  const content = await parseOpenAIStream(response);
  if (!content) throw new Error('Perplexity Competitors: пуста відповідь');
  return content;
}

export async function queryPerplexityCities(artistName: string, cities: string[]): Promise<string> {
  const prompt = `Для артиста "${artistName}" підготуй ПРЕМІУМ досьє по КОЖНОМУ місту: ${cities.join(', ')}.
Обсяг великий, структуровано (заголовки, таблиці, списки). ЗАБОРОНЕНО «оціночно», «приблизно», «ймовірно» без URL. Кожне твердження — URL джерела в тому ж рядку або н/д.

Перед таблицями по містах — блок ПРО АРТИСТА (один раз):
| Показник | Значення | URL |
| Останні підтверджені концерти/анонси (до 10 рядків) | дата, місто, зал | |
| Офіційний сайт / квитки | | |

Для КОЖНОГО міста:

1) ТОП-5 МАЙДАНЧИКІВ під жанр артиста
- Таблиця: назва | тип | місткість (лише з офіційної сторінки залу/Wikipedia арени) | адреса | чому підходить | URL
- Оренда / технічний райдер публічно — якщо є; інакше н/д

2) ЛОГІСТИКА ТУРУ
- Аеропорти, типовий час до центру/залу, нюанси (кордон, нічні курсування)
- Залізниця/автобан хаби для стикування маршруту з іншими містами зі списку

3) ГОТЕЛІ ДЛЯ КОМАНДИ (3–5 варіантів біля залу)
- Клас, дистанція, ціни тільки з Booking/офіційних сайтів або н/д

4) РИНОК КВИТКІВ
- Типові діапазони для подібних залів у місті — лише з квиткових сайтів / останніх аналогічних шоу з URL
- Ключові локальні/регіональні продавці квитків

5) МУЗИЧНИЙ КОНТЕКСТ МІСТА
- Факти про концертний ринок лише з названих звітів/ЗМІ/офстат з URL або н/д
- 2–3 недавні тури інших артистів того ж жанру — таблиця: артист | дата | зал | URL квиткового/оголошення або не включати рядок

6) ШВИДКІ ВИСНОВКИ ДЛЯ БУКІНГУ
- 3 bullet: чому букати / обережність / що перевірити додатково`;

  const response = await fetchWithRetry('/api/perplexity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const hint = response.status === 429 ? ' (ліміт запитів — спробуй через хвилину)' : '';
    throw new Error(`Perplexity ${response.status}: ${errorText}${hint}`);
  }

  const citiesContent = await parseOpenAIStream(response);
  if (!citiesContent) throw new Error('Perplexity: пуста відповідь');
  return citiesContent;
}

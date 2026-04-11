import {
  concertArchiveStartIsoDate,
  getConcertArchiveStartYear,
  isoDateLocalToday,
} from '../utils/dates';
import { DATE_ACCURACY_BLOCK_UK } from './dateAccuracyPrompt';
import { fetchWithRetry } from './fetchUtils';
import { parseOpenAIStream } from './streamParser';

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
1) Artist **past** pages on setlist.fm, songkick.com, bandsintown.com — scroll/paginate; capture every gig in this window.
2) **Quarterly sweep** inside this window: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec — run explicit searches per quarter so no month range is missed.
3) Add official tour history, worldafisha, livenation, ticket archive or press pages if they document gigs in this window.
4) **price_label:** verbatim short text from the source if that gig page lists ticket price, tier, or sold-out face value; else "".

Rules:
- Each row MUST have a direct **https** URL for **that exact show** (setlist event, songkick, bandsintown event, official news, major ticket vendor history).
- **date** YYYY-MM-DD; **city**, **country**, **venue** consistent with the URL.
- **event_status:** "completed" | "cancelled" | "" (empty if not stated).
- Do not invent rows; empty past[] only if truly zero verifiable gigs in this window after the quarterly sweep.

Exact JSON shape:
{"past":[{"date":"YYYY-MM-DD","city":"","country":"","venue":"","url":"","price_label":"","event_status":""}]}`;
}

function pastRowDedupKey(r: PerplexityPastConcertRow): string {
  const c = (r.city || '').split(',')[0].trim().toLowerCase().replace(/\s+/g, '');
  const v = (r.venue || '').toLowerCase().replace(/\s+/g, '');
  return `${r.date}|${c}|${v}`;
}

function pastRowRichness(r: PerplexityPastConcertRow): number {
  return (
    (r.url || '').length +
    (r.price_label || '').length * 3 +
    (r.venue || '').length +
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
  const city = String(o.city ?? '').trim();
  if (!city) return null;
  const country = String(o.country ?? '').trim();
  const venue = String(o.venue ?? '').trim();
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
 * Минулі концерти для таблиці UI: **окремий запит Perplexity на кожен рік** (2024 → … → поточний рік до сьогодні), щоб не обрізати JSON і не пропускати дати.
 * Помилки року агрегуються в `error`, часткові результати зберігаються.
 */
export async function fetchPastConcertsViaPerplexityForTable(artistName: string): Promise<{
  past: PerplexityPastConcertRow[];
  error?: string;
}> {
  const a = artistName.trim();
  if (!a) return { past: [] };
  const today = isoDateLocalToday();
  const cy = parseInt(today.slice(0, 4), 10);
  const sy = getConcertArchiveStartYear();
  const archiveIso = concertArchiveStartIsoDate();
  const errorParts: string[] = [];
  const collected: PerplexityPastConcertRow[] = [];

  for (let y = sy; y <= cy; y++) {
    const rangeStart = `${y}-01-01`;
    const rangeEnd = y < cy ? `${y}-12-31` : today;
    const periodLabel =
      y < cy
        ? `full calendar year ${y} (${rangeStart}…${rangeEnd})`
        : `year ${y} from ${rangeStart} through TODAY (${today})`;

    const system = perplexityTablePastSystemWindow(
      archiveIso,
      periodLabel,
      rangeStart,
      rangeEnd,
      today
    );

    const user = `Artist: "${a}".
Today (local): ${today}.
Archive floor (do not go below): ${archiveIso}.

**Coverage window for THIS response:** ${periodLabel}
You must list **every** past concert of "${a}" with event date from **${rangeStart}** through **${rangeEnd}** (inclusive), all dates still **≤ ${today}**.

**Execution order (mandatory):**
1) Open artist past listings: setlist.fm, songkick.com, bandsintown.com — capture **all** shows falling in this window (pagination).
2) **Quarterly** explicit searches for "${a}" in ${y}: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec (setlist OR songkick OR bandsintown OR official).
3) Festivals, support slots, multi-city residencies — one row per distinct date+venue+URL.
4) **price_label:** if the linked page states ticket price, range, or currency — copy it briefly; else "".

Return ONLY:
{"past":[{"date":"YYYY-MM-DD","city":"","country":"","venue":"","url":"https://...","price_label":"","event_status":""}]}

Hard rules:
- **https URL per row** for that specific gig; skip rows without URL.
- **No date > ${today}** and no date < ${archiveIso} in this batch (except you may ignore out-of-window rows rather than listing them).
- Maximize row count for this window.`;

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
          max_tokens: 8192,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const hint = response.status === 429 ? ' (ліміт — спробуйте пізніше)' : '';
        errorParts.push(`${y}: Perplexity ${response.status}${hint}: ${errorText.slice(0, 120)}`);
        continue;
      }

      const content = await parseOpenAIStream(response);
      if (!content?.trim()) {
        errorParts.push(`${y}: порожня відповідь`);
        continue;
      }

      let parsed: { past?: unknown[] };
      try {
        const jsonStr = extractJsonObjectFromModel(content);
        parsed = JSON.parse(jsonStr) as { past?: unknown[] };
      } catch {
        errorParts.push(`${y}: не JSON`);
        continue;
      }

      const past = (Array.isArray(parsed.past) ? parsed.past : [])
        .map(normalizePerplexityPastRow)
        .filter((x): x is PerplexityPastConcertRow => x != null)
        .filter((row) => row.date! >= rangeStart && row.date! <= rangeEnd && row.date! <= today);
      collected.push(...past);
    } catch (e) {
      errorParts.push(`${y}: ${e instanceof Error ? e.message : String(e)}`);
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

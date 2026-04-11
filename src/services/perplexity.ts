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

РОЗПОДІЛ З GEMINI: ти збираєш **минулі / завершені** концерти з максимальною повнотою (архів від ~${getConcertArchiveStartYear()} року до сьогодні, усі джерела). Майбутні анонси й свіжі ціни на квитки в пріоритеті у Gemini + Google Search (паралельний канал) — твій основний обсяг — минуле.

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

/** Окремий режим для таблиці концертів у UI (не чернетка чату): лише JSON минулих шоу. */
function perplexityTablePastSystem(archiveStartYear: number, archiveStartIso: string): string {
  return `You are a data extractor for a concert table in a web app. Output ONE JSON object only — no markdown code fences, no explanation before or after.

**MANDATORY workflow:** cover **each calendar year from ${archiveStartYear} through the year of "today"** in **two half-year blocks (H1 = Jan–Jun, H2 = Jul–Dec)** — plus one broad pass over full past listings on setlist/songkick/bandsintown (pagination) before year-scoped searches. **past[] must list every verifiable completed gig** in range; empty array **only** if after that full pass you still have **zero** gigs with a direct URL.

Rules:
- **past concerts only** (already happened; date ≤ today from user message). Future dates go to the other pipeline, not here.
- Each row MUST have a real **https** URL for that specific gig (setlist.fm, songkick, bandsintown, worldafisha, official site, reputable press).
- **date** must be YYYY-MM-DD; row only when date, venue, and URL are supported by the source.
- Cover from **${archiveStartIso}** through "today".

Exact shape:
{"past":[{"date":"YYYY-MM-DD","city":"","country":"","venue":"","url":"","price_label":"","event_status":""}]}
- price_label: short text if the linked page states a price/tier; else ""
- event_status: "completed" or "cancelled" when clearly stated; else ""
If nothing verified after exhaustive half-year-by-year search: {"past":[]}`;
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
 * Минулі концерти для таблиці UI (парсинг JSON з відповіді Perplexity).
 * Не кидати виключення — помилка в полі error для підказки в інтерфейсі.
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
  const years = [];
  for (let y = sy; y <= cy; y++) years.push(y);
  const yearHalfOutline = years
    .map(
      (y) =>
        `Year ${y}: search H1 (Jan–Jun ${y}) then H2 (Jul–Dec ${y}) for "${a}" on setlist.fm / songkick / bandsintown / worldafisha.`
    )
    .join('\n');

  const user = `Artist: "${a}".
Today (local, past only): ${today}.
Archive from ${archiveIso} through ${today}.

**Mandatory coverage:**
1) Broad pass: full past event lists on setlist.fm / songkick / bandsintown for "${a}" (all pages you can reach).
2) Then half-year blocks:
${yearHalfOutline}

Return ONLY this JSON (no markdown):
{"past":[{"date":"YYYY-MM-DD","city":"","country":"","venue":"","url":"https://...","price_label":"","event_status":""}]}

Requirements:
- Include **every** past show from ${archiveIso} through ${today} you can verify — **direct https URL per row**.
- Maximize row count. Skip rows without a URL.
- No future dates.`;

  try {
    const response = await fetchWithRetry('/api/perplexity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: perplexityTablePastSystem(sy, archiveIso) },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const hint = response.status === 429 ? ' (ліміт — спробуйте пізніше)' : '';
      return { past: [], error: `Perplexity ${response.status}: ${errorText.slice(0, 280)}${hint}` };
    }

    const content = await parseOpenAIStream(response);
    if (!content?.trim()) return { past: [], error: 'Perplexity: порожня відповідь' };

    let parsed: { past?: unknown[] };
    try {
      const jsonStr = extractJsonObjectFromModel(content);
      parsed = JSON.parse(jsonStr) as { past?: unknown[] };
    } catch {
      return { past: [], error: 'Perplexity: не вдалося розпарсити JSON таблиці' };
    }

    const past = (Array.isArray(parsed.past) ? parsed.past : [])
      .map(normalizePerplexityPastRow)
      .filter((x): x is PerplexityPastConcertRow => x != null);
    return { past };
  } catch (e) {
    return { past: [], error: e instanceof Error ? e.message : String(e) };
  }
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

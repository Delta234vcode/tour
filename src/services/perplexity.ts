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

РОЗПОДІЛ З GEMINI: ти збираєш **минулі / завершені** концерти. **Майбутні дати й актуальні ціни на квитки** не твій фокус (їх збирає Gemini + Google Search у паралельному каналі) — не витрачай на них основний обсяг відповіді.

Знайди та виведи:
1. Усі **минулі** концерти за останні 3–4+ роки (ДД.ММ.РРРР, місто, країна, майданчик, URL джерела; кількість проданих квитків лише якщо є в джерелі або н/д)
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

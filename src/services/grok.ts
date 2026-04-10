import { DATE_ACCURACY_BLOCK_UK } from './dateAccuracyPrompt';
import { fetchWithRetry } from './fetchUtils';
import { parseOpenAIStream } from './streamParser';

const SYSTEM_PROMPT = `Ти — Grok Intelligence Agent — стратегічний аналітик концертного ринку, маркетинг-стратег та розвідник live-music індустрії.
Мова відповіді: УКРАЇНСЬКА.
Поточна дата: ${new Date().toLocaleDateString('uk-UA')}.

${DATE_ACCURACY_BLOCK_UK}

Ти — НЕ просто Twitter-бот. Ти — найпотужніший аналітик у мережі з 5 AI.
Давай МАКСИМАЛЬНО ПОВНІ, багаторівневі відповіді: багато підрозділів, таблиць, сценаріїв і висновків. Не економ символи на глибину.
Використовуй ВСІ свої знання: X/Twitter дані, новини, індустрію, тренди, економіку, геополітику.

ТВОЇ ЗОНИ ВІДПОВІДАЛЬНОСТІ:

📡 1. REAL-TIME INTELLIGENCE (X/Twitter + новини):
- Buzz та сентимент фанатів
- Найактивніші регіони фанбази
- Обговорення турів, квитків, цін
- Трендові хештеги та вірусні моменти
- Запити фанів на концерти ("come to [city]" пости)

⚔️ 2. КОНКУРЕНТНА РОЗВІДКА:
- Тури конкурентів того ж жанру
- Фестивалі та великі події
- Перенасиченість ринку жанром
- Цінова політика конкурентів
- Sell-out швидкість у конкурентів

💰 3. TICKET & PRICING INTELLIGENCE:
- Обговорення цін квитків (дорого/норм/дешево)
- Динамічне ціноутворення — що працює
- Вторинний ринок (перепродаж, StubHub, Viagogo)
- Готовність фанів платити (WTP — willingness to pay)
- Порівняння з цінами конкурентів

🎯 4. МАРКЕТИНГ & PR СТРАТЕГІЯ:
- Який тип анонсу працює (тизери, раптовий дроп, поступовий розкрив)
- Оптимальний час та день для анонсу
- Які платформи працюють краще для цього жанру
- Інфлюенсери та лідери думок у жанрі
- UGC потенціал (user-generated content)

📊 5. FAN DEMAND FORECASTING:
- Оцінка попиту по містах на основі онлайн-активності
- Петиції, запити, тренди
- Порівняння з іншими артистами цього рівня
- Прогноз sell-out швидкості

⚠️ 6. RISK INTELLIGENCE:
- Геополітичні ризики в регіоні
- Контроверсії навколо артиста
- Бойкоти, скандали, PR-кризи
- Безпекова ситуація в містах
- Валютні та економічні ризики
- Сезонні ризики (погода, свята, канікули)

🏢 7. INDUSTRY INTELLIGENCE:
- Ключові промоутери в регіоні та їхня репутація
- Тренди live-music індустрії
- Нові формати подій (VIP, meet & greet, livestream)
- Спонсорський потенціал

Виводи СТРУКТУРОВАНО з конкретними даними та рекомендаціями.
Числа та відсотки — лише з названого поста/новини/звіту (коротко що саме пораховано); інакше «н/д».
ЗАБОРОНЕНО: «оціночно», «приблизно», «ймовірно» без посилання на конкретний пост або статтю.
НЕ ВИГАДУЙ конкурентів, дат турів, цін, sell-out. Кожен факт — джерело (посилання, дата публікації) або «н/д».`;

const GROK_MODELS = [
  'grok-4-1-fast-non-reasoning',
  'grok-4-fast-non-reasoning',
  'grok-4-0709',
  'grok-3-mini',
  'grok-3',
];

function parseGrokError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    const msg = j.error?.message || j.message || body;
    return `Grok ${status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  } catch {
    return `Grok ${status}: ${body.slice(0, 300)}`;
  }
}

async function callGrokApi(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 4096
): Promise<string> {
  let lastRes: Response | null = null;
  let lastBody = '';

  for (const model of GROK_MODELS) {
    const response = await fetchWithRetry('/api/grok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.35, max_tokens: maxTokens }),
    });
    lastRes = response;

    if (response.ok) {
      const content = await parseOpenAIStream(response);
      if (content) return content;
      lastBody = 'Grok: пуста відповідь';
    } else {
      lastBody = await response.text();
    }
    if (response.status !== 400 && response.status !== 404) break;
  }

  const hint = lastRes?.status === 429 ? ' (ліміт — спробуй через хвилину)' : '';
  throw new Error(parseGrokError(lastRes!.status, lastBody) + hint);
}

export async function queryGrok(userPrompt: string): Promise<string> {
  return callGrokApi(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    4096
  );
}

export async function queryGrokCities(
  artistName: string,
  cities: string[],
  scrapePrefix = ''
): Promise<string> {
  const currentYear = new Date().getFullYear();
  let cityPrompt = `Преміум звіт для "${artistName}" — ОКРЕМО по КОЖНОМУ місту: ${cities.join(', ')}.

🚨 ТІЛЬКИ ПЕРЕВІРЕНІ ДАНІ: кожне твердження — цитата/посилання (X, новина, офіційний пост) або «н/д». Заборонено «оціночно», «приблизно», «ймовірно» без URL.

Спочатку один блок ПРО АРТИСТА (таблиця): останні публічні пости/новини про тур або реліз (до 5 рядків) | джерело URL | дата публікації або н/д

Для КОЖНОГО міста ### 🏙️ [Місто]:

═══ АРТИСТ × МІСТО ═══
- Що публічно відомо про "${artistName}" + це місто (пости, новини, анонси) — список з URL; якщо нічого — «н/д»

═══ 📡 FAN DEMAND (з мережі) ═══
- Теми в X/новинах з прикладами (посилання або н/д)
- Згадки міста + артиста — з URL або н/д

═══ ⚔️ КОНКУРЕНТНА КАРТА (${currentYear}) ═══
| Дата | Подія | Зал | URL джерела |
(лише рядки з реальним URL; інакше: «підтверджених подій у відкритих джерелах не знайдено»)
- Фестивалі до 300 км: назва, дати, URL або н/д
- Перенасичення 🟢🟡🔴 — лише якщо є названі події з таблиці; інакше н/д

═══ 💰 ЦІНИ ═══
- Лише з квиткових сайтів/оголошень з URL; інакше н/д

═══ 🏢 ПРОМОУТЕРИ / МЕДІА ═══
- Назва + сайт URL або н/д

═══ 🎯 НАСТУПНІ КРОКИ ═══
- Що моніторити (конкретні джерела), без припущень

═══ ⚠️ РИЗИКИ ═══
- Тільки з названих джерел; решта — н/д

═══ ФІНАЛ ═══
- Вердикт БУКАТИ/УМОВНО/ПРОПУСТИТИ + причини лише з фактів цього звіту; якщо фактів мало — «н/д, потрібен сканер квиткових сайтів»`;

  if (scrapePrefix.trim()) {
    cityPrompt = `${scrapePrefix.trim()}\n\n--- Звір з уривками вище. ---\n\n${cityPrompt}`;
  }

  return callGrokApi(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: cityPrompt },
    ],
    8192
  );
}

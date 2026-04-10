import { DATE_ACCURACY_BLOCK_UK } from './dateAccuracyPrompt';

const SYSTEM_PROMPT = `Ти — Final Tour Analyst (Claude Sonnet 4). Отримуєш зібрані дані від AI-агентів (Perplexity, Grok, Gemini) та створюєш фінальний структурований звіт з глибокою аналітикою.

Мова відповіді: УКРАЇНСЬКА.
Поточна дата: ${new Date().toLocaleDateString('uk-UA')}.

Твої задачі:
1. Проаналізуй ВСІ зібрані дані від усіх агентів
2. Знайди протиріччя між даними різних агентів і визнач найточнішу інформацію
3. Створи фінальний звіт туру з чіткими рекомендаціями
4. Оціни загальний бюджет туру (витрати та потенційний дохід)
5. Визнач ТОП-3 найперспективніших міст з аргументацією
6. Визнач головні ризики та план B
7. Дай фінальну рекомендацію: GO / CONDITIONAL GO / NO GO
8. ⚔️ РИЗИК-МЕНЕДЖМЕНТ КОНКУРЕНЦІЇ — ОБОВ'ЯЗКОВИЙ РОЗДІЛ:
   - Зведи дані від усіх агентів про конкуруючі концерти того ж жанру
   - Для кожного міста вкажи: скільки конкурентів, хто вони, коли грають
   - Визнач оптимальні дати букінгу (вікна без конкуренції)
   - Оціни ризик канібалізації аудиторії (% втрати від конкурентів)
   - Дай конкретні рекомендації по датах: коли букати, а коли НЕ букати

🚨 ЦІНИ: оренда залів, готелі, квитки — лише з контексту зібраних даних або «н/д» / «уточнити напряму». Не вигадуй цифри.

Фінальний звіт — структурований текст (розділи, таблиці у markdown) для людини; не додавай окремий JSON-блок для експорту.`;

/** Повні моделі для аналітики та фінального звіту. */
const CLAUDE_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'];

/** Легка модель для рутинних задач (JSON-планер, парсинг). */
const CLAUDE_PLANNER_MODEL = 'claude-3-5-haiku-20241022';

function parseClaudeError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    const msg = j.error?.message || j.message || body;
    return `Claude ${status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  } catch {
    return `Claude ${status}: ${body.slice(0, 300)}`;
  }
}

/** Anthropic вимагає max_tokens; не обмежуємо відповідь вручну — ставимо верхню межу моделі (~64k для Sonnet 4.6). */
const CLAUDE_DEFAULT_MAX_TOKENS = 64000;

async function callClaudeApi(body: Record<string, unknown>, retries = 1): Promise<string> {
  const { parseAnthropicStream } = await import('./streamParser');
  let lastRes: Response | null = null;
  let lastBody = '';

  const payload: Record<string, unknown> = {
    ...body,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : CLAUDE_DEFAULT_MAX_TOKENS,
  };

  for (const model of CLAUDE_MODELS) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        console.log(`Claude → ${model} (attempt ${attempt + 1})`);
        const res = await fetch('/api/claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, model }),
        });
        lastRes = res;

        if (res.ok) {
          const text = await parseAnthropicStream(res);
          if (text) {
            console.log(`Claude OK → ${model} (${text.length} chars)`);
            return text;
          }
          lastBody = 'Claude: пуста відповідь (stream empty)';
          break;
        }

        lastBody = await res.text();
        console.warn(`Claude ${model} → ${res.status}`);

        if (res.status === 529 || res.status === 503 || res.status === 500) {
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
            continue;
          }
        }
        if (res.status === 429) {
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
            continue;
          }
        }
        if (res.status !== 400 && res.status !== 404) break;
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Claude ${model} attempt ${attempt + 1} error: ${msg}`);
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        lastBody = msg;
      }
    }
  }

  throw new Error(
    lastBody ? parseClaudeError(lastRes?.status ?? 0, lastBody) : 'Claude: всі моделі недоступні'
  );
}

const COMPETITOR_INTEL_SYSTEM = `Ти — Claude Global Competitor Intelligence Analyst — головний аналітик конкурентного ландшафту та стратегії.
Мова: УКРАЇНСЬКА.
Поточна дата: ${new Date().toLocaleDateString('uk-UA')}.
Рік: ${new Date().getFullYear()}.

Ти працюєш НА ПАРУ з Gemini 3.1 Pro.
Gemini — збирає факти через Google Search (соцмережі, метрики, готелі, логістика).
ТИ — АНАЛІТИК: глибока конкурентна розвідка, стратегічний аналіз, ризик-менеджмент, фінальні рекомендації.
Відповіді мають бути ОБ'ЄМНИМИ і багаторівневими: багато таблиць, порівнянь, сценаріїв — не стискай аналіз.
Perplexity дає чернетку тур-дат (веб); Grok — базз з X/Twitter. Ти синтезуєш і аналізуєш.

${DATE_ACCURACY_BLOCK_UK}

ТВОЇ ЗОНИ ВІДПОВІДАЛЬНОСТІ:

🔬 1. ГЛОБАЛЬНИЙ КОНКУРЕНТНИЙ ЛАНДШАФТ:
- Визнач ТОЧНИЙ жанр артиста та ВСІ суміжні жанри (використовуй карту жанрів нижче)
- Знайди ТОП-20 артистів-конкурентів (прямих та суміжних жанрів) які активно гастролюють
- Для кожного конкурента: рівень популярності, розмір аудиторії, типові зали, ціни квитків
- Хто з конкурентів планує/оголосив тури по Європі на поточний рік?
- Порівняльна таблиця: артист vs конкуренти (Spotify слухачі, розмір залів, ціни)

📊 2. КАРТА СУМІЖНИХ ЖАНРІВ (визнач жанр артиста і розшир пошук):
• Metal → rock, classic rock, progressive rock, alternative rock, hard rock, punk, metalcore, nu-metal, industrial, grunge, gothic, symphonic metal, Christian rock, stoner rock
• Rock → metal, classic rock, progressive rock, alternative rock, indie rock, pop-rock, punk, emo, grunge, folk-rock, post-punk, stoner rock
• Pop → pop-rock, dance-pop, electropop, R&B, indie pop, synth-pop, K-pop, Latin pop
• Hip-Hop/Rap → R&B, trap, grime, drill, reggaeton, pop-rap, alternative hip-hop
• Electronic/EDM → house, techno, trance, dubstep, DnB, synth-pop, electropop
• R&B/Soul → pop, hip-hop, neo-soul, funk, gospel, Afrobeats
• Country → folk, Americana, country-rock, bluegrass, country-pop
• Latin → reggaeton, Latin pop, bachata, hip-hop latino, Latin trap
• Folk/Indie → alternative, indie rock, indie pop, singer-songwriter, dream pop
• Classical/Jazz → chamber music, crossover, world music, smooth jazz

🗓️ 3. ФЕСТИВАЛЬНИЙ КАЛЕНДАР:
- ВСІ великі фестивалі жанру в Європі на поточний рік
- Дати, локації, хедлайнери, масштаб
- Які з цих фестивалів перетинають потенційні дати туру?
- Фестивалі як МОЖЛИВІСТЬ (артист може бути запрошений) vs ЗАГРОЗА (відтягують аудиторію)

📈 4. ТРЕНДИ ЖАНРУ:
- Жанр зростає / стабільний / падає? Чому?
- Нові піджанри та тренди в live-музиці
- Зміни в аудиторії (вік, географія, платоспроможність)
- Чи є "бум" жанру в певних регіонах Європи?

💰 5. ЕКОНОМІКА КОНКУРЕНЦІЇ:
- Середні ціни квитків в жанрі по Європі (West vs East vs North vs South)
- Тренд цін: ростуть / стабільні / падають
- Вплив кількості конкурентних подій на fill rate
- Порівняння попит vs пропозиція в жанрі

⚠️ 6. СТРАТЕГІЧНІ РИЗИКИ:
- Перенасиченість ринку жанром (tour fatigue)
- Ризик "великої риби" — якщо хедлайнер жанру оголосить тур, це вбиває продажі менших артистів
- Сезонні патерни: коли жанр продається найкраще/найгірше
- Регіональні особливості (де жанр сильний, де слабкий)

🧠 7. EXECUTIVE ANALYTICS (ОБОВ'ЯЗКОВО):
- Короткий executive memo для директора (5-10 bullets: що робимо/чого не робимо)
- Матриця рішень GO / CONDITIONAL GO / NO GO з 3-5 чіткими тригерами на кожен статус
- KPI-рамка туру: fill rate, blended ticket, CAC/ROAS маркетингу, break-even point (якщо немає даних — н/д + що потрібно дозібрати)
- Сценарний блок: Base / Stress / Upside (припущення, головні драйвери, ризики зриву)
- План дій 30/60/90 днів: що робити команді букінгу, маркетингу, PR на кожному етапі

🎟️ 8. КВИТКОВА НАУКА (SHOWBIZ ADVANCED, ОБОВ'ЯЗКОВО):
- Побудуй Ticketing Ladder: Early Bird / Regular / Late / Door (якщо немає цифр — дай структуру і логіку, познач н/д)
- Визнач On-sale Calendar: teaser -> announce -> pre-sale -> public on-sale -> last call
- Дай guardrails для ціноутворення: коли піднімати ціну, коли тримати, коли додавати value-add замість discount
- Окремо оцінюй ризик overpricing vs underpricing по містах

📣 9. МЕДІА ТА ШУМ НАВКОЛО ТУРУ:
- Розділи канали на Performance / Creator / PR / Community
- Для кожного каналу дай роль у воронці: awareness -> consideration -> conversion
- Запропонуй 3 хвилі контенту: announcement / social proof / urgency
- Додай anti-crisis PR playbook (скасування, перенос, слабкі продажі в перший тиждень)

🤝 10. DEAL STRUCTURE ТА ПАРТНЕРСТВА:
- Дай рамку угоди: guarantee vs door split vs hybrid (коли який формат доцільний)
- Рекомендації щодо локальних партнерів: promoter, radio partner, creator partner, brand sponsor
- Що обов'язково має бути в райдері/контракті для зниження операційних ризиків

ФОРМАТ ВІДПОВІДІ — СТРУКТУРОВАНО:
Використовуй таблиці, списки, чіткі заголовки.
НЕ ВИГАДУЙ — якщо не впевнений, пиши "потребує перевірки".
🚨 ТОЧНІСТЬ: Spotify слухачі, міста турів, ціни квитків — тільки з публічних джерел або «н/д». Не перелічуй конкурента з «туром по Європі» без посилання на анонс (сайт артиста, bandsintown, songkick). Числа без джерела — заборонені.
Заборонено «оціночно», «приблизно», «ймовірно» — або факт + URL, або н/д.
Конкретні дані там, де є підстава; без "води".`;

/** План допоміжних агентів (українські user-prompt) — видає Claude-оркестратор. */
export interface AuxiliaryTaskPlan {
  perplexity: string;
  grok: string;
  /** Другий прохід Perplexity — лише якщо потрібен вузький додатковий веб-скан */
  perplexity_extra?: string;
  grok_extra?: string;
}

const AUX_ORCHESTRATOR_SYSTEM = `Ти — оркестратор допоміжних AI-агентів для концертного аналізу.
ВИХІД: ЛИШЕ валідний JSON без markdown і без пояснень.

Схема (усі ключі обов'язкові; *_extra — порожній рядок "" якщо не потрібно):
{"perplexity":"...","grok":"...","perplexity_extra":"","grok_extra":""}

СПЕЦІАЛІЗАЦІЯ — не змішуй ролі; рівно 2 допоміжні агенти (соцмережі та майбутні тури з цінами — окремо через Gemini + Google Search, не через цей JSON):
• **perplexity** (+ optional perplexity_extra): ТІЛЬКИ веб, **минулі / завершені** концерти (хронологія, setlist/songkick/bandsintown архів, огляди) — рядок = URL; **не** збирай майбутні дати (це Gemini).
• **grok** (+ optional grok_extra): ТІЛЬКИ X/Twitter базз, сентимент фанів, «come to [city]», обговорення — кожен факт з URL. НЕ доручай тур-таблиці (Perplexity = минуле, Gemini = майбутнє) і НЕ доручай соцметрики (це Gemini).

**perplexity_extra / grok_extra** — додатковий user-prompt для ДРУГОГО виклику, лише якщо є конкретна прогалина.

Головні аналітики (Claude аналітика + Gemini Google Search) перевіряють результат; допоміжні лише чернетки.`;

function extractJsonObject(text: string): string | null {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : t;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseAuxiliaryTaskPlan(text: string): AuxiliaryTaskPlan | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const perplexity = typeof j.perplexity === 'string' ? j.perplexity.trim() : '';
    const grok = typeof j.grok === 'string' ? j.grok.trim() : '';
    if (perplexity.length < 20 || grok.length < 20) return null;
    const perplexity_extra =
      typeof j.perplexity_extra === 'string' ? j.perplexity_extra.trim() : '';
    const grok_extra = typeof j.grok_extra === 'string' ? j.grok_extra.trim() : '';
    return { perplexity, grok, perplexity_extra, grok_extra };
  } catch {
    return null;
  }
}

async function callClaudePlanner(body: Record<string, unknown>): Promise<string> {
  const { parseAnthropicStream } = await import('./streamParser');
  const payload = { ...body, model: CLAUDE_PLANNER_MODEL, max_tokens: 4096 };

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      console.log(`Claude Planner → ${CLAUDE_PLANNER_MODEL} (attempt ${attempt + 1})`);
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const text = await parseAnthropicStream(res);
        if (text) return text;
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
        continue;
      }
      break;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
    }
  }
  return callClaudeApi({ ...body, max_tokens: 4096 });
}

export async function queryAuxiliaryTaskPlanGlobal(artistName: string): Promise<string> {
  return callClaudePlanner({
    system: AUX_ORCHESTRATOR_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Артист: "${artistName}".

Згенеруй JSON: perplexity, grok, perplexity_extra, grok_extra (останні два — "" якщо без другого проходу). Perplexity = лише **минулі** концерти (не майбутні). Майбутні дати й ціни — не доручай Perplexity (це Gemini окремо). Базові промпти — по 3–8 речень. Без URL — н/д.`,
      },
    ],
  });
}

export async function queryAuxiliaryTaskPlanCities(
  artistName: string,
  genre: string,
  cities: string[]
): Promise<string> {
  return callClaudePlanner({
    system: AUX_ORCHESTRATOR_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Артист: "${artistName}".
Жанр: ${genre || '(визначити з контексту)'}.
Міста (тільки вони): ${cities.join(', ')}.

Згенеруй JSON: perplexity, grok, perplexity_extra, grok_extra (порожні рядки якщо не треба другого проходу). Скан САМЕ цих міст; Perplexity = **минулі** концерти артиста (і за потреби минулі конкуренти), Grok = X/Twitter, майбутні події/квитки = Gemini (не в цьому JSON). URL або н/д.`,
      },
    ],
  });
}

export async function queryClaudeHelperWithAuxiliaryDrafts(
  artistName: string,
  drafts: {
    gemini?: string;
    /** Уривки сторінок (Scrapling) за URL з Gemini — без live Search Gemini */
    scrapedPages?: string;
    perplexity: string;
    grok: string;
  }
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const bundle = `=== ЧЕРНЕТКИ (спочатку Gemini + Google Search — факти; далі інші агенти) ===

--- Gemini (попередній збір фактів через Google Search для аналітика) ---
${drafts.gemini?.trim() || '(порожньо)'}

--- Scrapling (текст сторінок за URL з блоку Gemini; звір з чернетками нижче) ---
${drafts.scrapedPages?.trim() || '(немає — скрапер вимкнено або URL не знайдено)'}

--- Perplexity (веб / концерти) ---
${drafts.perplexity || '(порожньо)'}

--- Grok (X/Twitter базз) ---
${drafts.grok || '(порожньо)'}

=== КІНЕЦЬ ЧЕРНЕТОК ===`;

  return callClaudeApi({
    system: `${COMPETITOR_INTEL_SYSTEM}

ДОДАТКОВО: ти отримуєш чернетки. Блок Gemini — попередній збір з Google Search (орієнтир по фактах); блок Scrapling — локальні уривки HTML за тими ж URL (не плутати з Search). Звір Perplexity/Grok/Scrapling між собою і з власним аналізом. Відкинь безджерельні твердження; суперечності — розділ «Суперечності з чернеток». Фінальний вивід — як у стандартному пакеті нижче.`,
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: `Артист: "${artistName}"

${bundle}

Виконай МАКСИМАЛЬНО ПОВНИЙ глобальний стратегічний пакет (не скорочуй розділи), з урахуванням перевірки чернеток:

1. Жанр + піджанри + карта суміжності (хто ділить ту саму аудиторію)
2. Матриця до 25 конкурентів (прямі + суміжні): популярність, типові зали, ціновий сегмент — дані тільки з публічних джерел або н/д; тури Європи ${currentYear}–${nextYear} лише з URL анонсу
3. Хто з конкурентів «з’їдає» media share / стрімінг у жанрі (якісно)
4. Фестивалі ${currentYear}–${nextYear}: таблиця з підтвердженими датами або н/д
5. Регіони Європи: де жанр найсильніший / найслабший; білі плями для туру
6. Економіка жанру: Захід vs Схід vs Північ vs Південь (ціни та платоспроможність — з обережністю, н/д де немає даних)
7. Co-headline / support: лише пари артистів, де обидва мають публічні тури з URL; інакше н/д
8. Стратегічні ризики (tour fatigue, великі тури хедлайнерів, економіка)
9. 3 сценарії туру для цього артиста: обережний / базовий / агресивний з умовами
10. Executive memo (для C-level): 5-10 bullets з рішенням і чому
11. KPI-дизайн: fill rate, blended ticket, CAC, ROMI/ROAS, break-even (формули + що є/чого бракує)
12. План виконання 30/60/90 днів (booking / marketing / PR)

Формат виводу:

### 🎯 ЖАНР ТА ЕКОСИСТЕМА
...

### ⚔️ МАТРИЦЯ КОНКУРЕНТІВ (до 25)
| # | Артист | Жанр | Публічні метрики / н/д | Типовий зал | Ціни / н/д | Тур EU + джерело |

### 🎪 ФЕСТИВАЛІ ${currentYear}–${nextYear}
| Фестиваль | Країна | Дати | Хедлайнери | Масштаб | Джерело |

### 🗺️ ГЕОСТРАТЕГІЯ ЄВРОПИ
...

### 📈 ТРЕНДИ ЖАНРУ ТА LIVE
...

### 💰 ЕКОНОМІКА ТА ЦІНИ
| Регіон | Спостереження | н/д де потрібно |

### 🤝 КОЛАБОРАЦІЇ ТА СЛОТИ
...

### ⚠️ РИЗИКИ ТА ТРИГЕРИ
...

### 🧭 EXECUTIVE MEMO (C-LEVEL)
- 5-10 ключових пунктів для директора

### 📏 KPI ТА BREAK-EVEN РАМКА
| KPI | Формула / логіка | Поточний стан | Що дозібрати |

### 🗓️ ПЛАН 30/60/90
| Період | Booking | Marketing | PR | Критерій успіху |

### 🎟️ TICKETING LADDER ТА ON-SALE КАЛЕНДАР
| Етап | Рівень ціни | Тригер переходу | Ризик | Дія команди |

### 📣 МЕДІА-АРХІТЕКТУРА (3 ХВИЛІ)
| Хвиля | Мета | Канали | KPI | Креативний меседж |

### 🤝 DEAL STRUCTURE
| Місто | Рекомендована модель угоди | Чому | Критичні умови контракту |

### 🎯 РЕКОМЕНДАЦІЇ ДЛЯ БУКІНГУ
- Вікна та регіони пріоритету
- Чого уникати
- Позиціонування vs топ-3 конкуренти`,
      },
    ],
  });
}

export async function queryClaudeHelper(artistName: string): Promise<string> {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  return callClaudeApi({
    system: COMPETITOR_INTEL_SYSTEM,
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: `Артист: "${artistName}"

Виконай МАКСИМАЛЬНО ПОВНИЙ глобальний стратегічний пакет (не скорочуй розділи):

1. Жанр + піджанри + карта суміжності (хто ділить ту саму аудиторію)
2. Матриця до 25 конкурентів (прямі + суміжні): популярність, типові зали, ціновий сегмент — дані тільки з публічних джерел або н/д; тури Європи ${currentYear}–${nextYear} лише з URL анонсу
3. Хто з конкурентів «з’їдає» media share / стрімінг у жанрі (якісно)
4. Фестивалі ${currentYear}–${nextYear}: таблиця з підтвердженими датами або н/д
5. Регіони Європи: де жанр найсильніший / найслабший; білі плями для туру
6. Економіка жанру: Захід vs Схід vs Північ vs Південь (ціни та платоспроможність — з обережністю, н/д де немає даних)
7. Co-headline / support: лише пари артистів, де обидва мають публічні тури з URL; інакше н/д
8. Стратегічні ризики (tour fatigue, великі тури хедлайнерів, економіка)
9. 3 сценарії туру для цього артиста: обережний / базовий / агресивний з умовами
10. Executive memo (для C-level): 5-10 bullets з рішенням і чому
11. KPI-дизайн: fill rate, blended ticket, CAC, ROMI/ROAS, break-even (формули + що є/чого бракує)
12. План виконання 30/60/90 днів (booking / marketing / PR)

Формат виводу:

### 🎯 ЖАНР ТА ЕКОСИСТЕМА
...

### ⚔️ МАТРИЦЯ КОНКУРЕНТІВ (до 25)
| # | Артист | Жанр | Публічні метрики / н/д | Типовий зал | Ціни / н/д | Тур EU + джерело |

### 🎪 ФЕСТИВАЛІ ${currentYear}–${nextYear}
| Фестиваль | Країна | Дати | Хедлайнери | Масштаб | Джерело |

### 🗺️ ГЕОСТРАТЕГІЯ ЄВРОПИ
...

### 📈 ТРЕНДИ ЖАНРУ ТА LIVE
...

### 💰 ЕКОНОМІКА ТА ЦІНИ
| Регіон | Спостереження | н/д де потрібно |

### 🤝 КОЛАБОРАЦІЇ ТА СЛОТИ
...

### ⚠️ РИЗИКИ ТА ТРИГЕРИ
...

### 🧭 EXECUTIVE MEMO (C-LEVEL)
- 5-10 ключових пунктів для директора

### 📏 KPI ТА BREAK-EVEN РАМКА
| KPI | Формула / логіка | Поточний стан | Що дозібрати |

### 🗓️ ПЛАН 30/60/90
| Період | Booking | Marketing | PR | Критерій успіху |

### 🎟️ TICKETING LADDER ТА ON-SALE КАЛЕНДАР
| Етап | Рівень ціни | Тригер переходу | Ризик | Дія команди |

### 📣 МЕДІА-АРХІТЕКТУРА (3 ХВИЛІ)
| Хвиля | Мета | Канали | KPI | Креативний меседж |

### 🤝 DEAL STRUCTURE
| Місто | Рекомендована модель угоди | Чому | Критичні умови контракту |

### 🎯 РЕКОМЕНДАЦІЇ ДЛЯ БУКІНГУ
- Вікна та регіони пріоритету
- Чого уникати
- Позиціонування vs топ-3 конкуренти`,
      },
    ],
  });
}

const CITY_COMPETITOR_SYSTEM = `Ти — Claude City Competition Analyst — глибокий аналітик конкурентного середовища по конкретних містах.
Мова: УКРАЇНСЬКА.
Поточна дата: ${new Date().toLocaleDateString('uk-UA')}.
Рік: ${new Date().getFullYear()}.

Ти отримуєш список обраних міст і аналізуєш КОЖНЕ місто на предмет конкуренції.
Працюєш разом з Gemini — ваші дані об'єднуються для найточнішого результату.
Давай глибокі, об'ємні відповіді по кожному місту: кілька таблиць, сценарії дат, явні прогалини де бракує даних.

${DATE_ACCURACY_BLOCK_UK}

ДЛЯ КОЖНОГО МІСТА АНАЛІЗУЙ:

⚔️ 1. КОНКУРЕНТИ В МІСТІ:
- ВСІ відомі концерти жанру + суміжних жанрів заплановані в цьому місті на рік
- Для кожного: артист, дата, майданчик, жанр, масштаб
- Концерти в радіусі 200 км від міста (теж відтягують аудиторію!)

🗓️ 2. КАЛЕНДАР КОНКУРЕНЦІЇ:
- По місяцях: які місяці зайняті конкурентами, які — вільні
- "Вікна можливостей" — періоди БЕЗ конкуренції
- ЗАБОРОНЕНІ дати (конкурент ±3 тижні в тому ж або близькому залі)

📊 3. РИЗИК КАНІБАЛІЗАЦІЇ:
- Якщо конкурент грає < 6 тижнів до/після — оціни ризик якісно (низький/середній/високий); відсотки втрати — лише якщо є реальні дані зі скану подій, інакше «н/д»
- Великий фестиваль у тому ж місяці — якісний вплив на продаж; без вигаданих відсотків
- Специфіка міста: як часто аудиторія ходить на концерти жанру?

🏆 4. ПОЗИЦІОНУВАННЯ:
- Артист vs конкуренти: хто більший/менший за масштабом?
- Чи може артист бути support/co-headline?
- Яка цінова стратегія оптимальна з огляду на конкурентів?

🎯 5. РЕКОМЕНДАЦІЇ:
- Конкретна рекомендована дата або діапазон дат
- Оцінка ризику: 🟢 НИЗЬКИЙ / 🟡 СЕРЕДНІЙ / 🔴 ВИСОКИЙ
- План B якщо оптимальна дата зайнята

🎟️ 6. МІСЬКА КВИТКОВА СТРАТЕГІЯ:
- Ticket ladder для міста (Early/Regular/Late/Door) + логіка переходів
- Який on-sale cadence дасть найкращий шанс конверсії
- Які тригери вважати «червоними» у перші 7-10 днів продажу

📣 7. МІСЬКИЙ GO-TO-MARKET:
- 2-3 локальні канали, які реально можуть дати продаж (PR/creators/community/performance)
- Гіпотеза головного повідомлення для міста
- Що робити, якщо перша хвиля продажів слабка

НЕ ВИГАДУЙ КОНКРЕТНІ ДАТИ КОНЦЕРТІВ — тільки ті що знаєш.
Якщо не впевнений — пиши "потребує перевірки через Perplexity/Google".
Заборонено «оціночно» — або подія з джерелом, або н/д.`;

export async function queryClaudeCityCompetitors(
  artistName: string,
  genre: string,
  cities: string[]
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  return callClaudeApi({
    system: CITY_COMPETITOR_SYSTEM,
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: `Артист: "${artistName}"
Жанр: ${genre || '(визнач автоматично)'}
Міста для аналізу: ${cities.join(', ')}

Для КОЖНОГО міста — ПОВНИЙ пакет на ${currentYear}–${nextYear} (не один абзац):

### 🏙️ [МІСТО]

#### ⚔️ Конкуренти (лише підтверджені факти; інакше «очікується сканер Perplexity»):
| Артист | Дата | Майданчик | Жанр | Масштаб | Ризик | Примітка |

#### 🎯 Позиціонування "${artistName}" у цьому місті
- vs середній концерт жанру в залі X vs Y
- Чи варто клуб / зал / арена (аргументація)

#### 🗓️ Календар конкуренції по місяцях:
| Місяць | Навантаження | Вікно можливості | Заборонені зони |

#### 🚌 Регіональний дренаж аудиторії
- Події до 200 км що крадуть публіку (якщо відомо) або н/д

#### 📊 Ризик та канібалізація
- Рівень ризику (низький/середній/високий) лише з переліком названих подій з датами; % тільки з даних інакше н/д. Без «оціночно».

#### 🧭 2–3 сценарії дат букінгу (A/B/C) з умовами

#### 🎯 Вердикт 🟢/🟡/🔴 + план B

#### 💼 Комерційна рамка міста
- Price corridor (ticket low/mid/high) з поясненням
- Break-even орієнтир (які параметри критичні)
- Маркетинг-фокус: 2-3 канали + очікувана роль

#### 🎟️ Ticketing Ladder + On-sale cadence
| Етап | Ціна / н/д | Тригер переходу | Ризик | Реакція |

#### 📣 GTM Playbook міста
| Канал | Роль у воронці | KPI | Перше повідомлення |

Після всіх міст:

### 📋 ЗВЕДЕНА МАТРИЦЯ
| Місто | Пріоритет | Ризик | Найкраще вікно | Головна загроза | Головна можливість |

### 🗺️ МАРШРУТНА ЛОГІКА
- Оптимальний порядок міст з огляду на конкуренцію (не кілометраж, якщо немає даних)
- Де краще «анонсувати першим» для шуму

### 🗓️ КАЛЕНДАРНА СТРАТЕГІЯ
- Квартали пріоритету для всього туру

### 🧭 EXECUTIVE MEMO (C-LEVEL)
- 5-8 bullets: рішення для керівника по всьому туру

### 🗓️ ПЛАН 30/60/90
| Період | Booking | Marketing | PR | KPI контроль |`,
      },
    ],
  });
}

export async function queryClaudeCityCompetitorsWithDrafts(
  artistName: string,
  genre: string,
  cities: string[],
  drafts: {
    gemini?: string;
    scrapedPages?: string;
    perplexity: string;
    grok: string;
  }
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const bundle = `=== ЧЕРНЕТКИ ПО МІСТАХ (спочатку Gemini + Search; далі інші) ===
--- Gemini (Google Search — попередній збір по містах) ---
${drafts.gemini?.trim() || '(порожньо)'}
--- Scrapling (текст сторінок за URL з Gemini) ---
${drafts.scrapedPages?.trim() || '(немає)'}
--- Perplexity (веб / концерти) ---
${drafts.perplexity || '(порожньо)'}
--- Grok (X/Twitter базз) ---
${drafts.grok || '(порожньо)'}
=== КІНЕЦЬ ===`;

  return callClaudeApi({
    system: `${CITY_COMPETITOR_SYSTEM}

ДОДАТКОВО: нижче — чернетки Gemini (Search), Scrapling (уривки сторінок), Perplexity, Grok. Використай як сирі дані; звір між джерелами; без URL у чернетці не приймай як факт.`,
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: `Артист: "${artistName}"
Жанр: ${genre || '(визнач автоматично)'}
Міста для аналізу: ${cities.join(', ')}

${bundle}

Для КОЖНОГО міста — ПОВНИЙ пакет на ${currentYear}–${nextYear} (не один абзац):

### 🏙️ [МІСТО]

#### ⚔️ Конкуренти (лише підтверджені факти; інакше «очікується сканер Perplexity»):
| Артист | Дата | Майданчик | Жанр | Масштаб | Ризик | Примітка |

#### 🎯 Позиціонування "${artistName}" у цьому місті
- vs середній концерт жанру в залі X vs Y
- Чи варто клуб / зал / арена (аргументація)

#### 🗓️ Календар конкуренції по місяцях:
| Місяць | Навантаження | Вікно можливості | Заборонені зони |

#### 🚌 Регіональний дренаж аудиторії
- Події до 200 км що крадуть публіку (якщо відомо) або н/д

#### 📊 Ризик та канібалізація
- Рівень ризику (низький/середній/високий) лише з переліком названих подій з датами; % тільки з даних інакше н/д. Без «оціночно».

#### 🧭 2–3 сценарії дат букінгу (A/B/C) з умовами

#### 🎯 Вердикт 🟢/🟡/🔴 + план B

#### 💼 Комерційна рамка міста
- Price corridor (ticket low/mid/high) з поясненням
- Break-even орієнтир (які параметри критичні)
- Маркетинг-фокус: 2-3 канали + очікувана роль

#### 🎟️ Ticketing Ladder + On-sale cadence
| Етап | Ціна / н/д | Тригер переходу | Ризик | Реакція |

#### 📣 GTM Playbook міста
| Канал | Роль у воронці | KPI | Перше повідомлення |

Після всіх міст:

### 📋 ЗВЕДЕНА МАТРИЦЯ
| Місто | Пріоритет | Ризик | Найкраще вікно | Головна загроза | Головна можливість |

### 🗺️ МАРШРУТНА ЛОГІКА
- Оптимальний порядок міст з огляду на конкуренцію (не кілометраж, якщо немає даних)
- Де краще «анонсувати першим» для шуму

### 🗓️ КАЛЕНДАРНА СТРАТЕГІЯ
- Квартали пріоритету для всього туру

### 🧭 EXECUTIVE MEMO (C-LEVEL)
- 5-8 bullets: рішення для керівника по всьому туру

### 🗓️ ПЛАН 30/60/90
| Період | Booking | Marketing | PR | KPI контроль |`,
      },
    ],
  });
}

export async function queryClaude(userPrompt: string): Promise<string> {
  return callClaudeApi({
    system: SYSTEM_PROMPT,
    max_tokens: 32768,
    messages: [{ role: 'user', content: userPrompt }],
  });
}

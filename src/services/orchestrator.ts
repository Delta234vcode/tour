import {
  queryClaude,
  queryClaudeHelperWithAuxiliaryDrafts,
  queryClaudeCityCompetitorsWithDrafts,
  parseAuxiliaryTaskPlan,
  queryAuxiliaryTaskPlanGlobal,
  queryAuxiliaryTaskPlanCities,
  type AuxiliaryTaskPlan,
} from './claude';
import { queryPerplexity, queryPerplexityCompetitors } from './perplexity';
import { queryGrok, queryGrokCities } from './grok';
import { DATE_ACCURACY_BLOCK_UK } from './dateAccuracyPrompt';
import { fetchGeminiResearchBundleForAnalyst, fetchGeminiCityBundleForAnalyst } from './gemini';
import { prependScrapeBlock, scrapePrefixFromGeminiBundle } from './scrapeContext';
export type AgentId = 'gemini' | 'claude' | 'perplexity' | 'grok';

export interface AgentUpdate {
  agentId: AgentId;
  status: 'idle' | 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export type OnAgentUpdate = (update: AgentUpdate) => void;

export interface ResearchResults {
  concertHistory: string;
  twitterBuzz: string;
  /** Окремий прохід Gemini + Google Search — факти для Claude ДО аналітики */
  geminiResearch: string;
  claudeHelper: string;
  competitorScan: string;
}

const FOLLOWUP_MIN_LEN = 24;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Пауза між послідовними API-викликами (уникнення rate-limit). */
const API_COOLDOWN_MS = 3000;

function appendDraft(
  field: 'concertHistory' | 'twitterBuzz',
  results: ResearchResults,
  block: string
) {
  const tag = '\n\n--- Додаткове завдання (оркестратор Claude) ---\n';
  results[field] = (results[field] ? results[field] + tag : '') + block;
}

/** Другий виклик допоміжних, якщо Claude задав *_extra у JSON-плані. */
async function runFollowUpAuxiliaryTasks(
  plan: AuxiliaryTaskPlan,
  results: ResearchResults,
  onUpdate: OnAgentUpdate,
  scrapePrefix = ''
): Promise<void> {
  const pe = plan.perplexity_extra?.trim();
  if (pe && pe.length >= FOLLOWUP_MIN_LEN) {
    await sleep(API_COOLDOWN_MS);
    onUpdate({ agentId: 'perplexity', status: 'running' });
    try {
      const t = await queryPerplexity(prependScrapeBlock(scrapePrefix, pe));
      appendDraft('concertHistory', results, t);
      onUpdate({ agentId: 'perplexity', status: 'done', result: results.concertHistory });
    } catch (e: any) {
      console.error('Perplexity follow-up:', e);
      onUpdate({ agentId: 'perplexity', status: 'error', error: e.message });
    }
  }
  const gr = plan.grok_extra?.trim();
  if (gr && gr.length >= FOLLOWUP_MIN_LEN) {
    await sleep(API_COOLDOWN_MS);
    onUpdate({ agentId: 'grok', status: 'running' });
    try {
      const t = await queryGrok(prependScrapeBlock(scrapePrefix, gr));
      appendDraft('twitterBuzz', results, t);
      onUpdate({ agentId: 'grok', status: 'done', result: results.twitterBuzz });
    } catch (e: any) {
      console.error('Grok follow-up:', e);
      onUpdate({ agentId: 'grok', status: 'error', error: e.message });
    }
  }
}

function defaultGlobalAuxPlan(artistName: string): AuxiliaryTaskPlan {
  const a = artistName.trim();
  const cy = new Date().getFullYear();
  const years = [];
  for (let y = 2024; y <= cy + 1; y++) years.push(y);
  return {
    perplexity: `Artist "${a}" — ENGLISH TASK: collect **PAST / COMPLETED concerts ONLY** (date strictly before today). Reply in UKRAINIAN.

Do **NOT** list upcoming or future shows — another agent (Gemini + Google Search) covers scheduled dates and ticket prices.

MANDATORY sources for history (URL per row or skip):
• setlist.fm, songkick.com/past, bandsintown past, concert archives, news reviews, official site /news or past tour pages
• worldafisha.com for past RU-market shows abroad when relevant

YEAR-BY-YEAR (mandatory): for EACH year ${years.filter((y) => y <= cy).join(', ')} (and earlier back to 2024 if needed), list **completed** shows only.

Table: DD.MM.YYYY | city | country | venue | status **completed** or **cancelled** (if show was cancelled before playing) | primary URL. Ticket price only if archived on a ticket page; else n/a.

Maximum depth; no invented dates.`,
    grok: `Артист "${a}". ТВОЯ СПЕЦІАЛІЗАЦІЯ — ТІЛЬКИ X/Twitter: базз, запити фанів «come to [city]», сентимент, обговорення турів — кожен пункт з URL або н/д. НЕ збирай тур-дати, НЕ збирай соцмережі (Spotify/IG/TikTok) — це робить Gemini через Google Search.`,
    perplexity_extra: '',
    grok_extra: '',
  };
}

function defaultCityAuxPlan(artistName: string, cities: string[]): AuxiliaryTaskPlan {
  const a = artistName.trim();
  const c = cities.join(', ');
  return {
    perplexity: `Artist "${a}". Cities: ${c}. ENGLISH TASK: **PAST concerts only** for this artist in or near these cities (completed shows, date before today). URL per row. Do NOT list upcoming/future — Gemini handles that. Optional: past competitor shows same genre within 300 km with URL. Reply in UKRAINIAN.`,
    grok: `Артист "${a}". Міста: ${c}. ТІЛЬКИ X/Twitter базз по цих містах: пости фанів, обговорення, запити, настрої — URL або н/д. НЕ збирай тур-дати і НЕ збирай соцметрики.`,
    perplexity_extra: '',
    grok_extra: '',
  };
}

export async function runResearchPhase(
  artistName: string,
  onUpdate: OnAgentUpdate
): Promise<ResearchResults> {
  const results: ResearchResults = {
    concertHistory: '',
    twitterBuzz: '',
    geminiResearch: '',
    claudeHelper: '',
    competitorScan: '',
  };

  let plan: AuxiliaryTaskPlan = defaultGlobalAuxPlan(artistName);
  try {
    const planRaw = await queryAuxiliaryTaskPlanGlobal(artistName);
    plan = parseAuxiliaryTaskPlan(planRaw) ?? defaultGlobalAuxPlan(artistName);
  } catch (e: any) {
    console.warn('Auxiliary task plan (global) fallback:', e?.message);
  }

  await sleep(API_COOLDOWN_MS);

  const runAux = async (): Promise<string> => {
    onUpdate({ agentId: 'gemini', status: 'running' });
    try {
      results.geminiResearch = await fetchGeminiResearchBundleForAnalyst(artistName);
      onUpdate({ agentId: 'gemini', status: 'done', result: results.geminiResearch });
    } catch (e: any) {
      console.error('Gemini research (global):', e);
      onUpdate({ agentId: 'gemini', status: 'error', error: e.message });
    }

    const scrapePrefix = await scrapePrefixFromGeminiBundle(results.geminiResearch);

    await sleep(API_COOLDOWN_MS);

    const tasks: Promise<void>[] = [
      (async () => {
        onUpdate({ agentId: 'perplexity', status: 'running' });
        try {
          results.concertHistory = await queryPerplexity(
            prependScrapeBlock(scrapePrefix, plan.perplexity)
          );
          onUpdate({ agentId: 'perplexity', status: 'done', result: results.concertHistory });
        } catch (e: any) {
          console.error('Perplexity error:', e);
          onUpdate({ agentId: 'perplexity', status: 'error', error: e.message });
        }
      })(),
      (async () => {
        await sleep(1500);
        if (!plan.grok?.trim()) return;
        onUpdate({ agentId: 'grok', status: 'running' });
        try {
          results.twitterBuzz = await queryGrok(prependScrapeBlock(scrapePrefix, plan.grok));
          onUpdate({ agentId: 'grok', status: 'done', result: results.twitterBuzz });
        } catch (e: any) {
          console.error('Grok error:', e);
          onUpdate({ agentId: 'grok', status: 'error', error: e.message });
        }
      })(),
    ];
    await Promise.allSettled(tasks);
    return scrapePrefix;
  };

  const scrapePrefixGlobal = await runAux();
  await runFollowUpAuxiliaryTasks(plan, results, onUpdate, scrapePrefixGlobal);

  await sleep(API_COOLDOWN_MS);

  try {
    onUpdate({ agentId: 'claude', status: 'running' });
    results.claudeHelper = await queryClaudeHelperWithAuxiliaryDrafts(artistName, {
      gemini: results.geminiResearch,
      scrapedPages: scrapePrefixGlobal,
      perplexity: results.concertHistory,
      grok: results.twitterBuzz,
    });
    results.competitorScan = results.claudeHelper;
    onUpdate({ agentId: 'claude', status: 'done', result: results.claudeHelper });
  } catch (e: any) {
    console.error('Claude synthesis error:', e);
    onUpdate({ agentId: 'claude', status: 'error', error: e.message });
  }

  return results;
}

export async function runDeepCityResearch(
  artistName: string,
  cities: string[],
  genre: string,
  onUpdate: OnAgentUpdate
): Promise<ResearchResults> {
  const results: ResearchResults = {
    concertHistory: '',
    twitterBuzz: '',
    geminiResearch: '',
    claudeHelper: '',
    competitorScan: '',
  };

  let plan: AuxiliaryTaskPlan = defaultCityAuxPlan(artistName, cities);
  try {
    const planRaw = await queryAuxiliaryTaskPlanCities(artistName, genre, cities);
    plan = parseAuxiliaryTaskPlan(planRaw) ?? defaultCityAuxPlan(artistName, cities);
  } catch (e: any) {
    console.warn('Auxiliary task plan (cities) fallback:', e?.message);
  }

  await sleep(API_COOLDOWN_MS);

  const runAuxCities = async (): Promise<string> => {
    onUpdate({ agentId: 'gemini', status: 'running' });
    try {
      results.geminiResearch = await fetchGeminiCityBundleForAnalyst(artistName, cities);
      onUpdate({ agentId: 'gemini', status: 'done', result: results.geminiResearch });
    } catch (e: any) {
      console.error('Gemini research (cities):', e);
      onUpdate({ agentId: 'gemini', status: 'error', error: e.message });
    }

    const scrapePrefix = await scrapePrefixFromGeminiBundle(results.geminiResearch);

    await sleep(API_COOLDOWN_MS);

    const tasks: Promise<void>[] = [
      (async () => {
        onUpdate({ agentId: 'perplexity', status: 'running' });
        try {
          results.concertHistory = await queryPerplexity(
            prependScrapeBlock(scrapePrefix, plan.perplexity)
          );
          onUpdate({ agentId: 'perplexity', status: 'done', result: results.concertHistory });
        } catch (e: any) {
          try {
            await sleep(API_COOLDOWN_MS);
            results.concertHistory = await queryPerplexityCompetitors(
              artistName,
              genre || 'music',
              cities,
              scrapePrefix
            );
            onUpdate({ agentId: 'perplexity', status: 'done', result: results.concertHistory });
          } catch (e2: any) {
            console.error('Perplexity city error:', e2);
            onUpdate({ agentId: 'perplexity', status: 'error', error: e2.message });
          }
        }
      })(),
      (async () => {
        await sleep(1500);
        if (!plan.grok?.trim()) return;
        onUpdate({ agentId: 'grok', status: 'running' });
        try {
          results.twitterBuzz = await queryGrok(prependScrapeBlock(scrapePrefix, plan.grok));
          onUpdate({ agentId: 'grok', status: 'done', result: results.twitterBuzz });
        } catch (e: any) {
          try {
            await sleep(API_COOLDOWN_MS);
            results.twitterBuzz = await queryGrokCities(artistName, cities, scrapePrefix);
            onUpdate({ agentId: 'grok', status: 'done', result: results.twitterBuzz });
          } catch (e2: any) {
            console.error('Grok city error:', e2);
            onUpdate({ agentId: 'grok', status: 'error', error: e2.message });
          }
        }
      })(),
    ];
    await Promise.allSettled(tasks);
    return scrapePrefix;
  };

  const scrapePrefixCities = await runAuxCities();

  await runFollowUpAuxiliaryTasks(plan, results, onUpdate, scrapePrefixCities);

  await sleep(API_COOLDOWN_MS);

  try {
    onUpdate({ agentId: 'claude', status: 'running' });
    results.claudeHelper = await queryClaudeCityCompetitorsWithDrafts(artistName, genre, cities, {
      gemini: results.geminiResearch,
      scrapedPages: scrapePrefixCities,
      perplexity: results.concertHistory,
      grok: results.twitterBuzz,
    });
    results.competitorScan = results.claudeHelper;
    onUpdate({ agentId: 'claude', status: 'done', result: results.claudeHelper });
  } catch (e: any) {
    console.error('Claude city synthesis error:', e);
    onUpdate({ agentId: 'claude', status: 'error', error: e.message });
  }

  return results;
}

export function buildEnrichedPrompt(
  artistName: string,
  cities: string,
  research: ResearchResults
): string {
  let prompt = `Аналізуй артиста: ${artistName.trim()}.`;
  if (cities.trim()) {
    prompt += `\nКористувач також вказав свої міста для розгляду: ${cities.trim()}.`;
  }

  prompt += `\n\n${DATE_ACCURACY_BLOCK_UK}`;

  prompt += `\n\n📊 ДАНІ ВІД AI-АГЕНТІВ:`;

  if (research.geminiResearch) {
    prompt += `\n\n=== 🔵 GEMINI — Попередній збір фактів (Google Search) для аналітика — ПЕРЕВІР/ДОПОВНИ Search ===\n${research.geminiResearch}`;
  }
  if (research.concertHistory) {
    prompt += `\n\n=== 🔍 PERPLEXITY — Допоміжна чернетка (веб / тури) — ПЕРЕВІР Google Search ===\n${research.concertHistory}`;
  }
  if (research.twitterBuzz) {
    prompt += `\n\n=== ⚡ GROK — X/Twitter базз (чернетка) — ПЕРЕВІР ===\n${research.twitterBuzz}`;
  }
  if (research.claudeHelper) {
    prompt += `\n\n=== 🧠 CLAUDE — Аналітика: конкуренти, ризики, стратегія, фінальні рекомендації ===\n${research.claudeHelper}`;
  }
  prompt += `\n\nРОЗПОДІЛ РОЛЕЙ: **Gemini** — **минулі й майбутні** концерти + ціни (Google Search); **Perplexity** — додатковий веб-архів **минулих** шоу; **Grok** — X/Twitter; **Claude** — аналітика. У чаті ти узгоджуєш усе через Search; **минулі концерти в КРОЦІ 2 — обовʼязкові**.`;

  prompt += `\n\n⚠️ ТІЛЬКИ ПЕРЕВІРЕНІ ДАНІ: заборонено слова «оціночно», «приблизно», «ймовірно», «гіпотеза» без URL з пошуку. Кожен факт — джерело (посилання) або «н/д».`;

  prompt += `\n\n📋 ОБОВ'ЯЗКОВО ВІДПОВІДЬ МІСТИТЬ (КРОК 1–2, про артиста):
- Таблиця «Верифікований профіль артиста»: метрика | значення | URL джерела або н/д
- Хронологія live: лише ДД.ММ.РРРР за стандартом точності дат (один первинний URL події АБО два узгоджені агрегатори)
- Без URL — не виводити дату як факт; суперечливі дати — підрозділ з обома посиланнями`;

  prompt += `\n\n🚦 ЦЕ ФАЗА A (перший запит у чаті). Виконуй у відповіді ЛИШЕ КРОК 0–3 + теги [CITIES_TO_SELECT:…] та [ALL_CITIES_MAP:…]. НЕ виводь КРОК 5–8, НЕ виводь [ROUTE_MAP:…], НЕ будуй фінальний звіт туру — користувач ще не обрав міста в UI.`;

  return prompt;
}

export function buildCityEnrichedPrompt(
  artistName: string,
  cities: string[],
  research: ResearchResults
): string {
  let prompt = `Обираю ці міста для туру артиста "${artistName.trim()}": ${cities.join(', ')}.`;
  prompt += `\n\n🚦 ФАЗА B: міста УЖЕ обрані (кнопками в UI). Виконуй КРОК 5, 6, 7 і 8 для ЦИХ міст; обов'язково [ROUTE_MAP:…] після маршруту. Не проси знову обрати міста.`;
  prompt += `\n\n${DATE_ACCURACY_BLOCK_UK}`;
  prompt += `\n\n📊 ДОДАТКОВІ ДАНІ ВІД AI-АГЕНТІВ ПО ОБРАНИХ МІСТАХ:`;

  if (research.geminiResearch) {
    prompt += `\n\n=== 🔵 GEMINI — Попередній збір по містах (Google Search) — ПЕРЕВІР Search ===\n${research.geminiResearch}`;
  }
  if (research.concertHistory) {
    prompt += `\n\n=== 🔍 PERPLEXITY — Міський скан (чернетка) — ПЕРЕВІР Google ===\n${research.concertHistory}`;
  }
  if (research.twitterBuzz) {
    prompt += `\n\n=== ⚡ GROK — X/Twitter базз по містах (чернетка) — ПЕРЕВІР ===\n${research.twitterBuzz}`;
  }
  if (research.claudeHelper) {
    prompt += `\n\n=== 🧠 CLAUDE — Міська аналітика конкуренції та стратегія ===\n${research.claudeHelper}`;
  }
  prompt += `\n\nРОЗПОДІЛ РОЛЕЙ: Gemini — **минулі + майбутні** по містах (Search); Perplexity — додаткові **минулі**; Grok — X/Twitter; Claude — аналітика. ОБОВ'ЯЗКОВО БЛОК D2 по кожному місту!`;

  prompt += `\n\n⚠️ ТІЛЬКИ ПЕРЕВІРЕНІ ДАНІ: без «оціночно»/«приблизно». Події конкурентів — тільки з URL у сканері або з твого Google Search (вказати посилання). Дедуплікація: дата + зал + артист. Суперечності — окремий підрозділ з обома джерелами.`;

  prompt += `\n\n📋 ДЛЯ КОЖНОГО МІСТА З СПИСКУ ОБОВ'ЯЗКОВО (КРОК 7):
1) Підзаголовок ### 🏙️ [Місто, країна]
2) Підрозділ «Артист у місті»: таблиця виступів/анонсів "${artistName.trim()}" — ДД.ММ.РРРР | зал | URL первинної сторінки події (або два URL агрегаторів при суперечності); без дня в джерелі — н/д; якщо після пошуку немає — «н/д (перевірено: setlist, songkick, bandsintown, офіційний сайт)»
3) Підрозділ «Місто»: населення, ВВП, аеропорт — тільки з Wikipedia / Eurostat / офіційного статистичного сайту (назва джерела в клітинці) або н/д
4) Підрозділ «Конкуренти»: таблиця подій — кожен рядок з URL або н/д
5) Ціни квитків / оренда / готелі — таблиця «показник | значення | URL джерела» або н/д`;

  return prompt;
}

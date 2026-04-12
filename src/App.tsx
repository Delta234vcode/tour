import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createChatSession, type GeminiChatSession } from './services/gemini';
import {
  runResearchPhase,
  runDeepCityResearch,
  mergeResearchResults,
  buildCityEnrichedPrompt,
  type AgentUpdate,
  type AgentId,
} from './services/orchestrator';
import { fetchConcerts, type ConcertData } from './services/concertScraper';
import { verifyLastPastConcertPerSelectedCity } from './services/cityPastVerify';
import { fetchWeatherMatrix, wmoLabel, type WeatherDay } from './services/weatherOpenMeteo';
import { parsePeriodDatesForWeather } from './utils/tourDateParse';
import { addTokens, emptyUsageTotals, type UsageTotals } from './utils/tokenPricing';
import {
  Send,
  Loader2,
  Music,
  Play,
  Check,
  Search,
  Calendar,
  MapPin,
  CloudSun,
} from 'lucide-react';
import { cn } from './utils/cn';
import { ConcertTable } from './components/ConcertTable';
import { AgentPanel } from './components/AgentPanel';
import { SessionTokenBar } from './components/SessionTokenBar';
import { ChatMessage, type ChatMsg } from './components/ChatMessage';
import { INITIAL_AGENTS, AGENT_COLORS, AGENT_ICONS, type AgentState } from './constants/agents';
import { useGeminiChat } from './hooks/useGeminiChat';

type Phase = 'landing' | 'scraping' | 'concerts' | 'analyzing' | 'chat';

/** Фонове відео на лендингу (після закінчення залишається останній кадр). */
const LANDING_HERO_VIDEO_URL = 'https://d.uguu.se/bbagovJM.MP4';

function parseCitiesInput(raw: string): string[] {
  return raw
    .split(/[,;]|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isoToUa(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function weatherSourceUa(s: WeatherDay['source']): string {
  if (s === 'forecast') return 'прогноз';
  if (s === 'archive') return 'архів';
  if (s === 'typical_past') return 'орієнтир (минулий рік)';
  return 'немає даних';
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [artistName, setArtistName] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentState[]>(INITIAL_AGENTS);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);

  const [concertData, setConcertData] = useState<ConcertData | null>(null);
  const [scrapeError, setScrapeError] = useState('');
  const [citiesInput, setCitiesInput] = useState('');
  const [datesInput, setDatesInput] = useState('');

  const [usageTotals, setUsageTotals] = useState<UsageTotals>(() => emptyUsageTotals());
  const [pipelineStep, setPipelineStep] = useState('');
  const [weatherDays, setWeatherDays] = useState<WeatherDay[] | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');

  const chatRef = useRef<GeminiChatSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recordMeter = useCallback(
    (e: { agentId: AgentId; prompt: number; completion: number }) => {
      setUsageTotals((t) => addTokens(t, e.agentId, e.prompt, e.completion));
    },
    []
  );

  const recordGeminiChatTokens = useCallback((prompt: number, completion: number) => {
    setUsageTotals((t) => addTokens(t, 'gemini', prompt, completion));
  }, []);

  const { streamGeminiResponse, abortStream } = useGeminiChat(
    chatRef,
    setMessages,
    recordGeminiChatTokens
  );

  const weatherPeriodDates = useMemo(
    () => parsePeriodDatesForWeather(datesInput),
    [datesInput]
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => () => abortStream(), [abortStream]);

  const updateAgent = useCallback((update: AgentUpdate) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === update.agentId ? { ...a, status: update.status, error: update.error } : a
      )
    );
  }, []);

  const handleFindConcerts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistName.trim()) return;
    setPhase('scraping');
    setScrapeError('');
    setConcertData(null);
    setUsageTotals(emptyUsageTotals());
    setPipelineStep('');
    setWeatherDays(null);
    setWeatherError('');
    try {
      const data = await fetchConcerts(artistName.trim());
      setConcertData(data);
      setPhase('concerts');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Помилка скрапера';
      setScrapeError(msg);
      setPhase('concerts');
    }
  };

  const handleStartAnalysis = async () => {
    const citiesRaw = citiesInput.trim();
    if (!citiesRaw || isAnalyzing) return;
    const cityList = parseCitiesInput(citiesRaw);
    if (cityList.length === 0) return;

    setPhase('analyzing');
    setIsAnalyzing(true);
    setShowAgentPanel(true);
    setAgentPanelCollapsed(false);
    setAgents(INITIAL_AGENTS);
    setUsageTotals(emptyUsageTotals());
    setPipelineStep('');

    chatRef.current = createChatSession();

    const researchLoadingId = `research-${Date.now()}`;
    setMessages([
      {
        id: researchLoadingId,
        role: 'model',
        content:
          '📡 **Збираю дані з AI-агентів…**\n\nГлобальний збір + контекст по ваших містах (Perplexity, Grok, Gemini, Claude); це може зайняти до хвилини.',
        isStreaming: true,
      },
    ]);

    const runOpts = { onPipelineStep: setPipelineStep, onMeter: recordMeter };

    try {
      setPipelineStep('Крок 2: перевірка останнього концерту артиста в кожному обраному місті…');
      try {
        const { concertData: refreshed } = await verifyLastPastConcertPerSelectedCity({
          artist: artistName.trim(),
          cities: cityList,
          concertData,
          onProgress: setPipelineStep,
          onTokens: (p, c) => recordMeter({ agentId: 'perplexity', prompt: p, completion: c }),
        });
        setConcertData(refreshed);
      } catch (e) {
        console.error('[cityPastVerify]', e);
      }

      const globalResearch = await runResearchPhase(artistName.trim(), updateAgent, runOpts);
      const cityResearch = await runDeepCityResearch(
        artistName.trim(),
        cityList,
        '',
        updateAgent,
        runOpts
      );
      const researchResults = mergeResearchResults(globalResearch, cityResearch);

      updateAgent({ agentId: 'gemini', status: 'running' });

      const datesHint = datesInput.trim()
        ? `\nБажані дати/періоди для туру: ${datesInput.trim()}.`
        : '';
      const enrichedPrompt =
        buildCityEnrichedPrompt(artistName.trim(), cityList, researchResults) + datesHint;

      const newUserMsg: ChatMsg = {
        id: Date.now().toString(),
        role: 'user',
        content:
          `Обираю ці міста для туру артиста "${artistName.trim()}": ${cityList.join(', ')}.` +
          (datesInput.trim() ? ` Бажані дати: ${datesInput.trim()}.` : ''),
      };

      const modelMsgId = (Date.now() + 1).toString();
      setMessages([newUserMsg, { id: modelMsgId, role: 'model', content: '', isStreaming: true }]);

      setPipelineStep('Чат Gemini: фінальний звіт по обраних містах…');
      const success = await streamGeminiResponse(enrichedPrompt, modelMsgId);
      updateAgent({ agentId: 'gemini', status: success ? 'done' : 'error' });

      setMessages((prev) =>
        prev.map((msg) => (msg.id === modelMsgId ? { ...msg, isStreaming: false } : msg))
      );
      setPhase('chat');
    } catch (e: unknown) {
      console.error(e);
      const errText = e instanceof Error ? e.message : 'Помилка збору даних';
      setMessages([
        {
          id: researchLoadingId,
          role: 'model',
          content: `**Помилка збору:** ${errText}\n\nПеревірте ключі API / мережу й спробуйте «Аналіз конкуренції» знову.`,
          isStreaming: false,
        },
      ]);
      setPhase('chat');
    } finally {
      setPipelineStep('');
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent, overridePrompt?: string) => {
    e?.preventDefault();
    const prompt = overridePrompt || chatInput.trim();
    if (!prompt || isAnalyzing || !chatRef.current) return;

    setChatInput('');
    setSelectedChips([]);
    setIsAnalyzing(true);
    setPipelineStep('Чат Gemini: відповідь…');

    const newUserMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: prompt };
    setMessages((prev) => [...prev, newUserMsg]);

    const modelMsgId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: modelMsgId, role: 'model', content: '', isStreaming: true },
    ]);

    try {
      updateAgent({ agentId: 'gemini', status: 'running' });
      const success = await streamGeminiResponse(prompt, modelMsgId);
      updateAgent({ agentId: 'gemini', status: success ? 'done' : 'error' });

      setMessages((prev) =>
        prev.map((msg) => (msg.id === modelMsgId ? { ...msg, isStreaming: false } : msg))
      );
    } finally {
      setPipelineStep('');
      setIsAnalyzing(false);
    }
  };

  const sendSelectedChips = async () => {
    if (selectedChips.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    setShowAgentPanel(true);
    setAgentPanelCollapsed(false);
    setAgents((prev) => prev.map((a) => ({ ...a, status: 'idle' as const })));

    const researchLoadingId = `research-cities-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: researchLoadingId,
        role: 'model',
        content: '📡 **Глибокий збір по обраних містах…** Зачекайте, агенти оновлюють дані.',
        isStreaming: true,
      },
    ]);

    const chipsSnapshot = [...selectedChips];

    try {
      setPipelineStep('Крок 2: перевірка останнього концерту в містах з чіпів…');
      try {
        const { concertData: refreshed } = await verifyLastPastConcertPerSelectedCity({
          artist: artistName.trim(),
          cities: chipsSnapshot,
          concertData,
          onProgress: setPipelineStep,
          onTokens: (p, c) => recordMeter({ agentId: 'perplexity', prompt: p, completion: c }),
        });
        setConcertData(refreshed);
      } catch (e) {
        console.error('[cityPastVerify chips]', e);
      }

      const runOpts = { onPipelineStep: setPipelineStep, onMeter: recordMeter };
      const deepResearch = await runDeepCityResearch(
        artistName.trim(),
        chipsSnapshot,
        '',
        updateAgent,
        runOpts
      );

      const enrichedPrompt = buildCityEnrichedPrompt(artistName.trim(), chipsSnapshot, deepResearch);

      const newUserMsg: ChatMsg = {
        id: Date.now().toString(),
        role: 'user',
        content: `Обираю ці міста для туру: ${chipsSnapshot.join(', ')}`,
      };
      setSelectedChips([]);

      const modelMsgId = (Date.now() + 1).toString();
      setMessages((prev) => {
        const withoutLoading = prev.filter((m) => m.id !== researchLoadingId);
        return [
          ...withoutLoading,
          newUserMsg,
          { id: modelMsgId, role: 'model', content: '', isStreaming: true },
        ];
      });

      setPipelineStep('Чат Gemini: оновлення з урахуванням обраних міст…');
      updateAgent({ agentId: 'gemini', status: 'running' });
      const success = await streamGeminiResponse(enrichedPrompt, modelMsgId);
      updateAgent({ agentId: 'gemini', status: success ? 'done' : 'error' });

      setMessages((prev) =>
        prev.map((msg) => (msg.id === modelMsgId ? { ...msg, isStreaming: false } : msg))
      );
    } catch (e: unknown) {
      console.error(e);
      setMessages((prev) => prev.filter((m) => m.id !== researchLoadingId));
    } finally {
      setPipelineStep('');
      setIsAnalyzing(false);
    }
  };

  const toggleChip = (city: string) => {
    setSelectedChips((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  const handleLoadWeather = async () => {
    const cities = parseCitiesInput(citiesInput);
    if (weatherPeriodDates.length === 0 || cities.length === 0) return;
    setWeatherLoading(true);
    setWeatherError('');
    try {
      const rows = await fetchWeatherMatrix(cities, weatherPeriodDates);
      setWeatherDays(rows);
    } catch (err: unknown) {
      setWeatherError(err instanceof Error ? err.message : 'Не вдалося завантажити погоду');
      setWeatherDays(null);
    } finally {
      setWeatherLoading(false);
    }
  };

  let availableCities: string[] = [];
  const latestModelMsg = [...messages].reverse().find((m) => m.role === 'model');
  if (latestModelMsg && !latestModelMsg.isStreaming) {
    const match = latestModelMsg.content.match(/\[CITIES_TO_SELECT:(.*?)\]/);
    if (match) {
      availableCities = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const activeAgentCount = agents.filter((a) => a.status === 'running').length;
  const doneAgentCount = agents.filter((a) => a.status === 'done').length;
  const hasStarted = phase !== 'landing' && phase !== 'scraping' && phase !== 'concerts';
  const showTokenFooter = phase !== 'landing' && phase !== 'scraping';

  return (
    <div className="min-h-screen bg-page text-gray-200 selection:bg-brand/30">
      <div className="max-w-6xl mx-auto h-screen flex flex-col">
        <header className="flex-none py-3 px-5 border-b border-white/10 flex items-center justify-between bg-page/85 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand shadow-lg shadow-brand/35 ring-1 ring-white/15">
              <img
                src="/chaika-logo.jpg"
                alt=""
                width={56}
                height={56}
                className="h-full w-full object-contain"
                decoding="async"
              />
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-white tracking-tight leading-tight">
                CHAIKA EVENTS
              </h1>
              <p className="text-[10px] text-gray-500 tracking-widest uppercase">
                Tour Intelligence Platform
              </p>
            </div>
          </div>
          {hasStarted && (
            <div className="flex items-center gap-1.5" aria-live="polite" aria-atomic="true">
              {agents.map((agent) => {
                if (agent.status === 'idle') return null;
                return (
                  <div
                    key={agent.id}
                    className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center border transition-all',
                      agent.status === 'done'
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : agent.status === 'running'
                          ? 'border-brand/35 bg-brand/15'
                          : agent.status === 'error'
                            ? 'border-red-500/30 bg-red-500/10'
                            : AGENT_COLORS[agent.id]
                    )}
                    title={`${agent.name}: ${agent.status}`}
                  >
                    {agent.status === 'running' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-light" />
                    ) : agent.status === 'done' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : agent.status === 'error' ? (
                      <span className="text-[10px] text-red-400">!</span>
                    ) : (
                      AGENT_ICONS[agent.id]
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </header>

        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {phase === 'landing' && (
          <div className="relative flex-1 flex min-h-0 overflow-hidden">
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={LANDING_HERO_VIDEO_URL}
              muted
              playsInline
              autoPlay
              preload="auto"
              loop={false}
              onEnded={(e) => {
                e.currentTarget.pause();
              }}
            />
            <div
              className="absolute inset-0 bg-page/80 backdrop-blur-[1px]"
              aria-hidden
            />
            <div className="relative z-10 flex flex-1 items-center justify-center p-6 overflow-y-auto">
            <div className="w-full max-w-md">
              <div className="text-center mb-8">
                <div className="mx-auto mb-5 flex h-40 w-40 items-center justify-center overflow-hidden rounded-2xl bg-brand shadow-2xl shadow-brand/40 ring-1 ring-white/15 sm:h-44 sm:w-44">
                  <img
                    src="/chaika-logo.jpg"
                    alt="CHAIKA"
                    width={176}
                    height={176}
                    className="h-full w-full object-contain p-1.5"
                    decoding="async"
                  />
                </div>
                <h2 className="text-2xl font-extrabold text-white tracking-tight mb-1">
                  CHAIKA EVENTS
                </h2>
                <p className="text-xs text-gray-500 tracking-widest uppercase">
                  Tour Intelligence Platform
                </p>
              </div>

              <div className="chaika-card p-6">
                <form onSubmit={handleFindConcerts} className="space-y-4">
                  <div>
                    <label
                      htmlFor="artist"
                      className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 block"
                    >
                      Артист
                    </label>
                    <div className="relative">
                      <Music className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600" />
                      <input
                        id="artist"
                        type="text"
                        required
                        value={artistName}
                        onChange={(e) => setArtistName(e.target.value)}
                        className="chaika-input block w-full pl-10 pr-4 py-3.5 text-sm"
                        placeholder="Введіть ім'я артиста"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={!artistName.trim()}
                    className="chaika-btn-primary w-full flex items-center justify-center gap-2.5 text-sm"
                  >
                    <Search className="w-4 h-4" />
                    <span>Знайти концерти</span>
                  </button>
                </form>
              </div>
              <p className="text-center text-[10px] text-gray-600 mt-4 tracking-wider">
                Дані з setlist.fm · bandsintown · songkick · worldafisha.com · Ticketmaster* (ціни — де є в API/HTML)
              </p>
            </div>
            </div>
          </div>
        )}

        {phase === 'scraping' && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-brand mx-auto mb-4" />
              <p className="text-white font-semibold text-lg mb-1">Скануємо концертні платформи…</p>
              <p className="text-gray-500 text-sm">
                setlist.fm · bandsintown · songkick · worldafisha.com · Ticketmaster*
              </p>
              <p className="text-gray-600 text-xs mt-2">Артист: {artistName}</p>
            </div>
          </div>
        )}

        {phase === 'concerts' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <div className="max-w-5xl mx-auto space-y-6">
              <button
                type="button"
                onClick={() => {
                  setPhase('landing');
                  setConcertData(null);
                  setScrapeError('');
                  setUsageTotals(emptyUsageTotals());
                  setPipelineStep('');
                  setWeatherDays(null);
                  setWeatherError('');
                }}
                className="text-xs text-gray-500 hover:text-white transition-colors"
              >
                ← Інший артист
              </button>

              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Music className="w-5 h-5 text-brand-light" />
                {artistName}
              </h2>

              {scrapeError && (
                <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-red-300 text-sm">
                  {scrapeError}
                </div>
              )}

              {concertData && (
                <>
                  <p className="text-[11px] text-gray-500 mb-2">
                    Показано концерти з <span className="text-gray-400">01.01.2024</span>. Колонка
                    «Майданчик» і «Ціна» — з setlist.fm / Songkick / Bandsintown / worldafisha.com / Ticketmaster (Discovery) /
                    Gemini, якщо джерело їх публікує; інакше «—».
                  </p>
                  {concertData.sources_checked.length > 0 && (
                    <p className="text-[11px] text-gray-500">
                      Джерела: {concertData.sources_checked.join(', ')}
                      {concertData.errors.length > 0 && (
                        <span className="text-amber-500 ml-2">
                          ({concertData.errors.length}{' '}
                          {concertData.errors.length === 1 ? 'повідомлення' : 'повідомлень'})
                        </span>
                      )}
                    </p>
                  )}
                  {concertData.errors.length > 0 && (
                    <ul className="text-[10px] text-amber-500/90 list-disc pl-4 space-y-0.5 mb-2">
                      {concertData.errors.slice(0, 6).map((msg, i) => (
                        <li key={i}>{msg}</li>
                      ))}
                    </ul>
                  )}

                  <div className="bg-surface border border-white/10 rounded-2xl overflow-hidden shadow-lg shadow-black/20">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Заплановані концерти
                      </h3>
                      <span className="text-xs text-gray-500 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                        {concertData.upcoming.length}
                      </span>
                    </div>
                    <ConcertTable events={concertData.upcoming} isPast={false} />
                  </div>

                  <div className="bg-surface border border-white/10 rounded-2xl overflow-hidden shadow-lg shadow-black/20">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-400 flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Минулі концерти
                      </h3>
                      <span className="text-xs text-gray-500 bg-white/[0.05] px-2 py-0.5 rounded-md border border-white/[0.08]">
                        {concertData.past.length}
                      </span>
                    </div>
                    <ConcertTable events={concertData.past} isPast={true} />
                  </div>
                </>
              )}

              <div className="bg-surface border border-brand/25 rounded-2xl p-6 space-y-4 shadow-lg shadow-black/20">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-brand-light" />
                  Аналіз конкуренції
                </h3>
                <p className="text-xs text-gray-400">
                  Введіть міста та бажані дати — AI-агенти проаналізують конкурентне середовище,
                  зали, ціни та ризики.
                </p>
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5 block">
                    Міста (через кому)
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600" />
                    <input
                      type="text"
                      value={citiesInput}
                      onChange={(e) => setCitiesInput(e.target.value)}
                      className="chaika-input block w-full pl-9 pr-4 py-3 text-sm"
                      placeholder="Warsaw, Berlin, Prague, Vienna"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5 block">
                    Бажані дати / період (опційно)
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600" />
                    <input
                      type="text"
                      value={datesInput}
                      onChange={(e) => setDatesInput(e.target.value)}
                      className="chaika-input block w-full pl-9 pr-4 py-3 text-sm"
                      placeholder="вересень 2026, 15.09.2026, 2026-10 — для аналізу та погоди в кроці 2"
                    />
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1.5">
                    Погоду по цьому періоду можна відкрити внизу екрана після переходу до кроку 2 (аналіз / чат).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStartAnalysis}
                  disabled={!citiesInput.trim() || isAnalyzing}
                  className="chaika-btn-primary w-full flex items-center justify-center gap-2.5 text-sm"
                >
                  <Play className="w-4 h-4" />
                  <span>Аналіз конкуренції</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {(phase === 'analyzing' || phase === 'chat') && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {showAgentPanel && (
              <AgentPanel
                agents={agents}
                agentPanelCollapsed={agentPanelCollapsed}
                onToggleCollapse={() => setAgentPanelCollapsed((c) => !c)}
                activeAgentCount={activeAgentCount}
                doneAgentCount={doneAgentCount}
                pipelineStep={pipelineStep}
              />
            )}

            <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} msg={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {availableCities.length > 0 && !isAnalyzing && (
              <div className="flex-none p-5 border-t border-white/10 bg-page-deep/90">
                <div className="max-w-5xl mx-auto">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                    Оберіть міста для глибокого аналізу
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {availableCities.map((city) => {
                      const isSelected = selectedChips.includes(city);
                      return (
                        <button
                          key={city}
                          type="button"
                          onClick={() => toggleChip(city)}
                          className={cn(
                            'px-3.5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 border',
                            isSelected
                              ? 'bg-brand border-brand-light text-white shadow-lg shadow-brand/30'
                              : 'bg-white/[0.02] border-white/[0.08] text-gray-300 hover:bg-white/[0.05] hover:border-white/[0.15]'
                          )}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                          {city}
                        </button>
                      );
                    })}
                  </div>
                  {selectedChips.length > 0 && (
                    <button
                      type="button"
                      onClick={sendSelectedChips}
                      disabled={isAnalyzing}
                      className="chaika-btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-40"
                    >
                      <Play className="w-4 h-4" />
                      Аналіз обраних міст ({selectedChips.length})
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-none border-t border-white/10 bg-page-deep/90">
              <div className="max-w-5xl mx-auto px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                      <CloudSun className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden />
                      Крок 2 — погода
                    </p>
                    {datesInput.trim() ? (
                      <p className="text-[11px] text-gray-400 truncate" title={datesInput.trim()}>
                        <span className="text-gray-200 font-medium">{datesInput.trim()}</span>
                      </p>
                    ) : (
                      <p className="text-[10px] text-amber-500/90 leading-snug">
                        Вкажіть дати на кроці з концертами → «Аналіз конкуренції».
                      </p>
                    )}
                    {weatherPeriodDates.length > 0 ? (
                      <p className="text-[10px] text-sky-400/80 leading-snug">
                        {weatherPeriodDates.length}{' '}
                        {weatherPeriodDates.length === 1 ? 'дата' : 'дат'} · прогноз до ~2 тижнів, далі — орієнтир
                        (ERA5)
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadWeather}
                    disabled={
                      weatherLoading ||
                      !citiesInput.trim() ||
                      weatherPeriodDates.length === 0 ||
                      isAnalyzing
                    }
                    title="Завантажити погоду на обраний період"
                    aria-label="Завантажити погоду на обраний період"
                    className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-sky-500/35 bg-sky-500/10 text-sky-200 hover:bg-sky-500/18 transition-all disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    {weatherLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                    ) : (
                      <CloudSun className="w-4 h-4" aria-hidden />
                    )}
                  </button>
                </div>
                {weatherError ? (
                  <div className="text-xs text-red-400/90">{weatherError}</div>
                ) : null}
                {weatherDays && weatherDays.length > 0 ? (
                  <div className="rounded-xl border border-white/[0.06] overflow-x-auto bg-black/25">
                    <table className="w-full text-left text-[11px] min-w-[520px]">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-gray-500 uppercase tracking-wider">
                          <th className="px-3 py-2 font-semibold">Місто</th>
                          <th className="px-3 py-2 font-semibold">Дата</th>
                          <th className="px-3 py-2 font-semibold">Темп.</th>
                          <th className="px-3 py-2 font-semibold">Умови</th>
                          <th className="px-3 py-2 font-semibold">Опади</th>
                          <th className="px-3 py-2 font-semibold">Джерело</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weatherDays.map((w, i) => (
                          <tr
                            key={`${w.city}-${w.date}-${i}`}
                            className="border-b border-white/[0.04] text-gray-300"
                          >
                            <td className="px-3 py-2 whitespace-nowrap">{w.city}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{isoToUa(w.date)}</td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {w.tMin != null && w.tMax != null
                                ? `${Math.round(w.tMin)}…${Math.round(w.tMax)} °C`
                                : '—'}
                            </td>
                            <td className="px-3 py-2">{wmoLabel(w.code)}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {w.precipProb != null ? `${w.precipProb}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-500">{weatherSourceUa(w.source)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex-none p-4 border-t border-white/10 bg-page">
              <div className="max-w-5xl mx-auto">
                <form onSubmit={(e) => handleSendMessage(e)} className="relative flex items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Введіть повідомлення..."
                    disabled={isAnalyzing}
                    className="chaika-input w-full rounded-xl pl-5 pr-14 py-3.5 text-sm disabled:opacity-40"
                    aria-label="Повідомлення в чат"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isAnalyzing}
                    className="absolute right-1.5 w-9 h-9 flex items-center justify-center rounded-lg bg-brand text-white shadow-md shadow-brand/30 transition-all hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Надіслати повідомлення"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
        </main>

        {showTokenFooter ? <SessionTokenBar totals={usageTotals} /> : null}
      </div>
    </div>
  );
}

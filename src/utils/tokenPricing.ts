import type { AgentId } from '../services/orchestrator';

/** Орієнтовні тарифи USD за 1M токенів (оновлюйте під свій тарифний план). */
const USD_PER_M: Record<
  AgentId,
  { in: number; out: number; note: string }
> = {
  gemini: { in: 0.15, out: 0.6, note: 'Gemini 2.5 Flash — орієнтир (перевір на ai.google.dev)' },
  claude: { in: 3, out: 15, note: 'Claude Sonnet — орієнтир' },
  perplexity: { in: 3, out: 15, note: 'Sonar Pro — орієнтир' },
  grok: { in: 5, out: 15, note: 'Grok — орієнтир' },
};

export type UsageTotals = Record<AgentId, { prompt: number; completion: number }>;

export const emptyUsageTotals = (): UsageTotals => ({
  gemini: { prompt: 0, completion: 0 },
  claude: { prompt: 0, completion: 0 },
  perplexity: { prompt: 0, completion: 0 },
  grok: { prompt: 0, completion: 0 },
});

export function addTokens(
  totals: UsageTotals,
  agent: AgentId,
  prompt: number,
  completion: number
): UsageTotals {
  const p = Math.max(0, Math.round(prompt));
  const c = Math.max(0, Math.round(completion));
  return {
    ...totals,
    [agent]: {
      prompt: totals[agent].prompt + p,
      completion: totals[agent].completion + c,
    },
  };
}

export function estimateUsdForAgent(agent: AgentId, prompt: number, completion: number): number {
  const r = USD_PER_M[agent];
  return (prompt / 1_000_000) * r.in + (completion / 1_000_000) * r.out;
}

export function estimateTotalUsd(totals: UsageTotals): number {
  return (Object.keys(totals) as AgentId[]).reduce(
    (s, id) => s + estimateUsdForAgent(id, totals[id].prompt, totals[id].completion),
    0
  );
}

export function pricingNote(agent: AgentId): string {
  return USD_PER_M[agent].note;
}

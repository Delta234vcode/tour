import type { AgentId } from '../services/orchestrator';
import type { UsageTotals } from '../utils/tokenPricing';
import { estimateUsdForAgent, estimateTotalUsd } from '../utils/tokenPricing';
import { INITIAL_AGENTS } from '../constants/agents';
import { cn } from '../utils/cn';

const ORDER: AgentId[] = ['gemini', 'claude', 'perplexity', 'grok'];

function agentLabel(id: AgentId): string {
  return INITIAL_AGENTS.find((a) => a.id === id)?.name ?? id;
}

type Props = {
  totals: UsageTotals;
  className?: string;
};

export function SessionTokenBar({ totals, className }: Props) {
  const totalUsd = estimateTotalUsd(totals);
  const anyTokens = ORDER.some(
    (id) => totals[id].prompt > 0 || totals[id].completion > 0
  );

  return (
    <div
      className={cn(
        'flex-none border-t border-white/[0.06] bg-[#08080a] px-4 py-2.5',
        className
      )}
      aria-label="Використання токенів за сесію"
    >
      <div className="max-w-5xl mx-auto">
        <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
          Токени та орієнтовна вартість (USD)
        </p>
        {!anyTokens ? (
          <p className="text-[10px] text-gray-600">
            Після викликів API тут з’являться prompt / completion і приблизна ціна за тарифами з коду.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 items-baseline text-[10px] sm:text-[11px]">
            {ORDER.map((id) => {
              const { prompt, completion } = totals[id];
              if (!prompt && !completion) return null;
              const usd = estimateUsdForAgent(id, prompt, completion);
              return (
                <span key={id} className="text-gray-400">
                  <span className="text-gray-500">{agentLabel(id)}:</span>{' '}
                  <span className="text-gray-300 tabular-nums">
                    in {prompt.toLocaleString()} · out {completion.toLocaleString()}
                  </span>{' '}
                  <span className="text-emerald-400/90 tabular-nums">~${usd.toFixed(3)}</span>
                </span>
              );
            })}
            <span className="text-violet-400/95 font-semibold tabular-nums ml-auto sm:ml-0">
              Разом: ~${totalUsd.toFixed(3)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

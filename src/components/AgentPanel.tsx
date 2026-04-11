import { ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react';
import { cn } from '../utils/cn';
import { AGENT_COLORS, AGENT_ICONS, type AgentState } from '../constants/agents';

type Props = {
  agents: AgentState[];
  agentPanelCollapsed: boolean;
  onToggleCollapse: () => void;
  activeAgentCount: number;
  doneAgentCount: number;
  /** Поточний етап пайплайну (оркестратор / чат). */
  pipelineStep?: string;
};

export function AgentPanel({
  agents,
  agentPanelCollapsed,
  onToggleCollapse,
  activeAgentCount,
  doneAgentCount,
  pipelineStep,
}: Props) {
  return (
    <div className="flex-none border-b border-white/10 bg-page-deep/90">
      <div className="max-w-5xl mx-auto px-5">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-between py-2.5"
          aria-expanded={!agentPanelCollapsed}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex-shrink-0">
              AI Agents
            </span>
            {agentPanelCollapsed && pipelineStep?.trim() ? (
              <span className="text-[9px] text-brand-light/95 truncate min-w-0" title={pipelineStep}>
                {pipelineStep}
              </span>
            ) : null}
            {activeAgentCount > 0 && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-md bg-brand/15 text-brand-light border border-brand/25 font-semibold"
                aria-live="polite"
              >
                {activeAgentCount} working
              </span>
            )}
            <span
              className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold"
              aria-live="polite"
            >
              {doneAgentCount}/{agents.length}
            </span>
          </div>
          {agentPanelCollapsed ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-600" aria-hidden />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-gray-600" aria-hidden />
          )}
        </button>
        {pipelineStep?.trim() ? (
          <div
            className="flex items-start gap-2 px-0 pb-2 text-[10px] text-brand-light/95 leading-snug"
            aria-live="polite"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 mt-0.5 text-brand-light" />
            <span>{pipelineStep}</span>
          </div>
        ) : null}
        {!agentPanelCollapsed && (
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 pb-3"
            role="list"
            aria-label="Статус AI-агентів"
          >
            {agents.map((agent) => (
              <div
                key={agent.id}
                role="listitem"
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all',
                  agent.status === 'running'
                    ? 'border-brand/30 bg-brand/8'
                    : agent.status === 'done'
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : agent.status === 'error'
                        ? 'border-red-500/25 bg-red-500/5'
                        : 'border-white/[0.04] bg-white/[0.01]'
                )}
              >
                <div
                  className={cn(
                    'w-6 h-6 rounded-md flex items-center justify-center border flex-shrink-0',
                    AGENT_COLORS[agent.id]
                  )}
                >
                  {AGENT_ICONS[agent.id]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-white truncate">{agent.name}</div>
                  <div
                    className={cn(
                      'text-[9px] truncate',
                      agent.status === 'error' ? 'text-red-400' : 'text-gray-600'
                    )}
                  >
                    {agent.status === 'error' && agent.error ? agent.error : agent.task}
                  </div>
                </div>
                <div className="flex-shrink-0" aria-hidden>
                  {agent.status === 'idle' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-700" />
                  )}
                  {agent.status === 'running' && (
                    <Loader2 className="w-3 h-3 animate-spin text-brand-light" />
                  )}
                  {agent.status === 'done' && <Check className="w-3 h-3 text-emerald-400" />}
                  {agent.status === 'error' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

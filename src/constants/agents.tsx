import React from 'react';
import { Zap, FileSpreadsheet, Search, Radio } from 'lucide-react';
import type { AgentId } from '../services/orchestrator';

export interface AgentState {
  id: AgentId;
  name: string;
  model: string;
  task: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
}

export const INITIAL_AGENTS: AgentState[] = [
  {
    id: 'gemini',
    name: 'Gemini 2.5 Flash',
    model: 'Google Search',
    task: 'Чат + збір фактів (2.5 Flash)',
    status: 'idle',
  },
  {
    id: 'claude',
    name: 'Claude Sonnet 4.6 / Haiku',
    model: 'Аналітика',
    task: 'Планер (Haiku) + аналітика (Sonnet)',
    status: 'idle',
  },
  {
    id: 'perplexity',
    name: 'Perplexity Sonar Pro',
    model: 'Веб-дані',
    task: 'Дати шоу, зали, агрегатори',
    status: 'idle',
  },
  {
    id: 'grok',
    name: 'Grok',
    model: 'X / Twitter',
    task: 'Базз, сентимент, запити фанів',
    status: 'idle',
  },
];

export const AGENT_COLORS: Record<AgentId, string> = {
  gemini: 'text-brand-light bg-brand/15 border-brand/30',
  claude: 'text-cyan-200 bg-cyan-500/10 border-cyan-400/25',
  perplexity: 'text-sky-200 bg-sky-500/10 border-sky-400/25',
  grok: 'text-amber-200 bg-amber-500/10 border-amber-400/25',
};

export const AGENT_ICONS: Record<AgentId, React.ReactNode> = {
  gemini: <Zap className="w-4 h-4" />,
  claude: <FileSpreadsheet className="w-4 h-4" />,
  perplexity: <Search className="w-4 h-4" />,
  grok: <Radio className="w-4 h-4" />,
};

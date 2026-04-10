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
    name: 'Gemini 3.1 Pro / 2.5 Flash',
    model: 'Google Search',
    task: 'Чат (Pro) + збір фактів (Flash)',
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
  gemini: 'text-violet-300 bg-violet-500/10 border-violet-500/25',
  claude: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/25',
  perplexity: 'text-sky-300 bg-sky-500/10 border-sky-500/25',
  grok: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
};

export const AGENT_ICONS: Record<AgentId, React.ReactNode> = {
  gemini: <Zap className="w-4 h-4" />,
  claude: <FileSpreadsheet className="w-4 h-4" />,
  perplexity: <Search className="w-4 h-4" />,
  grok: <Radio className="w-4 h-4" />,
};

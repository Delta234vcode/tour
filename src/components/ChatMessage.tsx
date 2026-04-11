import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot } from 'lucide-react';
import MapComponent, { type RoutePoint } from './MapComponent';
import { cn } from '../utils/cn';

export type ChatMsg = {
  id: string;
  role: 'user' | 'model';
  content: string;
  isStreaming?: boolean;
  agentSource?: string;
};

function tryParseRouteJson(jsonStr: string): RoutePoint[] | null {
  try {
    const data = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(data)) return null;
    return data.filter((p): p is RoutePoint => {
      if (!p || typeof p !== 'object') return false;
      const o = p as Record<string, unknown>;
      const lat = Number(o.lat);
      const lng = Number(o.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && typeof o.city === 'string';
    });
  } catch {
    return null;
  }
}

export function ChatMessage({ msg }: { msg: ChatMsg }) {
  let displayContent = msg.content.replace(/\[CITIES_TO_SELECT:.*?\]/g, '');

  let routeData: RoutePoint[] | null = null;
  const routeMatch = displayContent.match(/\[ROUTE_MAP:\s*(\[.*?\])\s*\]/);
  if (routeMatch) {
    routeData = tryParseRouteJson(routeMatch[1]);
    displayContent = displayContent.replace(/\[ROUTE_MAP:.*?\]/g, '');
  }

  let allCitiesData: RoutePoint[] | null = null;
  const allCitiesMatch = displayContent.match(/\[ALL_CITIES_MAP:\s*(\[.*?\])\s*\]/);
  if (allCitiesMatch) {
    allCitiesData = tryParseRouteJson(allCitiesMatch[1]);
    displayContent = displayContent.replace(/\[ALL_CITIES_MAP:.*?\]/g, '');
  }

  return (
    <div
      className={cn(
        'flex gap-4 max-w-5xl mx-auto',
        msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      <div className="flex-none">
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
            msg.role === 'user'
              ? 'bg-brand text-white shadow-md shadow-brand/25'
              : 'bg-raised border border-white/10 text-gray-500'
          )}
        >
          {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>
      </div>
      <div className={cn('flex-1 space-y-1', msg.role === 'user' ? 'text-right' : 'text-left')}>
        <div
          className={cn(
            'inline-block rounded-2xl px-5 py-4 text-[13.5px] leading-relaxed',
            msg.role === 'user'
              ? 'bg-brand text-white shadow-lg shadow-brand/20'
              : 'bg-surface border border-white/10 text-gray-300 w-full'
          )}
        >
          {msg.role === 'user' ? (
            <div className="whitespace-pre-wrap font-medium">{displayContent}</div>
          ) : (
            <div className="markdown-body prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-headings:text-white prose-a:text-brand-light hover:prose-a:text-wave prose-th:bg-white/[0.03] prose-td:border-white/10 prose-th:border-white/10 prose-strong:text-white">
              <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
              {routeData && routeData.length > 0 && (
                <div role="application" aria-label="Карта маршруту туру">
                  <MapComponent route={routeData} isRoute={true} />
                </div>
              )}
              {allCitiesData && allCitiesData.length > 0 && (
                <div role="application" aria-label="Карта міст-кандидатів">
                  <MapComponent route={allCitiesData} isRoute={false} />
                </div>
              )}
              {msg.isStreaming && (
                <span className="inline-block w-1.5 h-5 ml-1 bg-brand-light animate-pulse align-middle rounded-sm" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

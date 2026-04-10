import { ExternalLink } from 'lucide-react';
import type { ConcertEvent } from '../services/concertScraper';
import { formatDate, formatTimeSinceConcert, formatTimeUntilConcert } from '../utils/dates';

export function ConcertTable({ events, isPast }: { events: ConcertEvent[]; isPast: boolean }) {
  if (!events.length) {
    return <p className="text-gray-500 text-sm py-3 text-center">Не знайдено</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th
              scope="col"
              className="py-2 px-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider"
            >
              Дата
            </th>
            <th
              scope="col"
              className="py-2 px-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider"
            >
              Місто
            </th>
            <th
              scope="col"
              className="py-2 px-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider"
            >
              Майданчик
            </th>
            <th
              scope="col"
              className="py-2 px-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider"
            >
              Джерело
            </th>
            <th
              scope="col"
              className="py-2 px-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider min-w-[9rem]"
            >
              {isPast ? 'Минуло' : 'Залишилось'}
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const elapsed = isPast
              ? formatTimeSinceConcert(e.date)
              : formatTimeUntilConcert(e.date);
            return (
              <tr
                key={i}
                className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-2.5 px-3 font-mono text-gray-300 whitespace-nowrap">
                  {formatDate(e.date)}
                </td>
                <td className="py-2.5 px-3 text-white">
                  {e.city}
                  {e.country ? `, ${e.country}` : ''}
                </td>
                <td className="py-2.5 px-3 text-gray-400">{e.venue || '—'}</td>
                <td className="py-2.5 px-3">
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 hover:text-violet-300 flex items-center gap-1 text-xs"
                    >
                      {e.source} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-gray-600 text-xs">{e.source}</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right text-xs leading-snug max-w-[12rem]">
                  {elapsed ? (
                    <span className={isPast ? 'text-gray-400' : 'text-emerald-400'}>{elapsed}</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

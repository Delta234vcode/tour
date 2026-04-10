import { extractUrlsFromText } from '../utils/extractUrlsFromText';

/** Форматує уривки з /api/scrape для дописування до промптів Perplexity / Grok. */
export async function buildScrapedContextBlock(urls: string[]): Promise<string> {
  if (!urls.length) return '';
  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        max_chars_per_page: 10_000,
        mode: 'fetch',
      }),
    });
    if (!res.ok) {
      console.warn('[scrape]', res.status, await res.text().catch(() => ''));
      return '';
    }
    const data = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      snippets?: Array<{ url: string; text: string; error: string | null }>;
    };
    if (data.skipped || !data.snippets?.length) return '';

    const parts: string[] = [
      '## Уривки сторінок (локальний скрапер Scrapling — звір з власним пошуком)',
      '',
    ];
    for (const s of data.snippets) {
      parts.push(`### ${s.url}`);
      if (s.error) parts.push(`(помилка: ${s.error})`);
      else if (s.text?.trim()) parts.push(s.text.trim());
      else parts.push('(порожньо)');
      parts.push('');
    }
    return parts.join('\n').trim();
  } catch (e) {
    console.warn('[scrape] buildScrapedContextBlock:', e);
    return '';
  }
}

/** URL з тексту Gemini → блок уривків для допоміжних агентів (не для Gemini). */
export async function scrapePrefixFromGeminiBundle(geminiMarkdown: string): Promise<string> {
  if (!geminiMarkdown?.trim()) return '';
  try {
    const urls = extractUrlsFromText(geminiMarkdown, { maxUrls: 12 });
    return await buildScrapedContextBlock(urls);
  } catch (e) {
    console.warn('[scrape] scrapePrefixFromGeminiBundle:', e);
    return '';
  }
}

export function prependScrapeBlock(prefix: string, taskBody: string): string {
  const p = prefix.trim();
  const b = taskBody.trim();
  if (!p) return b;
  if (!b) return p;
  return `${p}\n\n--- Завдання нижче; звір з уривками вище. ---\n\n${b}`;
}

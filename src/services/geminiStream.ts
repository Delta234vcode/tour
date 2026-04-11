/**
 * Парсинг SSE від Gemini streamGenerateContent (?alt=sse).
 */

export type GeminiStreamUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

function extractUsageFromChunk(obj: unknown): GeminiStreamUsage | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const u = (obj as Record<string, unknown>).usageMetadata;
  if (!u || typeof u !== 'object') return undefined;
  const m = u as Record<string, unknown>;
  const promptTokenCount = typeof m.promptTokenCount === 'number' ? m.promptTokenCount : undefined;
  const candidatesTokenCount =
    typeof m.candidatesTokenCount === 'number' ? m.candidatesTokenCount : undefined;
  const totalTokenCount = typeof m.totalTokenCount === 'number' ? m.totalTokenCount : undefined;
  if (promptTokenCount == null && candidatesTokenCount == null && totalTokenCount == null)
    return undefined;
  return { promptTokenCount, candidatesTokenCount, totalTokenCount };
}

function extractTextFromChunk(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  const cands = o.candidates;
  if (!Array.isArray(cands) || !cands[0] || typeof cands[0] !== 'object') return '';
  const content = (cands[0] as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return '';
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const p of parts) {
    if (p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string') {
      out += (p as Record<string, string>).text;
    }
  }
  return out;
}

/** Ітерує текстові дельти з тіла відповіді streamGenerateContent (SSE). */
export async function* parseGeminiSseStream(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<{ text: string; usage?: GeminiStreamUsage }> {
  if (!response.body) throw new Error('Gemini: немає тіла відповіді');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw) as unknown;
          const text = extractTextFromChunk(evt);
          const usage = extractUsageFromChunk(evt);
          if (text) yield { text, ...(usage ? { usage } : {}) };
          else if (usage) yield { text: '', usage };
        } catch {
          // ignore malformed JSON line
        }
      }
    }
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const raw = trimmed.slice(5).trim();
        if (raw && raw !== '[DONE]') {
          try {
            const evt = JSON.parse(raw);
            const text = extractTextFromChunk(evt);
            const usage = extractUsageFromChunk(evt);
            if (text) yield { text, ...(usage ? { usage } : {}) };
            else if (usage) yield { text: '', usage };
          } catch {
            /* skip */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function collectGeminiSseText(
  response: Response,
  signal?: AbortSignal
): Promise<string> {
  const { text } = await collectGeminiSseTextAndUsage(response, signal);
  return text;
}

export async function collectGeminiSseTextAndUsage(
  response: Response,
  signal?: AbortSignal
): Promise<{ text: string; usage?: GeminiStreamUsage }> {
  let full = '';
  let lastUsage: GeminiStreamUsage | undefined;
  for await (const chunk of parseGeminiSseStream(response, signal)) {
    full += chunk.text ?? '';
    if (chunk.usage) lastUsage = chunk.usage;
  }
  return { text: full.trim(), usage: lastUsage };
}

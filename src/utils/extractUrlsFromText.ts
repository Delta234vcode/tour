/** Витягує унікальні http(s) URL з тексту (наприклад з виводу Gemini) для Scrapling. */
export function extractUrlsFromText(text: string, opts?: { maxUrls?: number }): string[] {
  const max = Math.min(Math.max(opts?.maxUrls ?? 12, 1), 20);
  if (!text?.trim()) return [];

  const re = /https?:\/\/[^\s\]"'<>]+/gi;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const m of text.matchAll(re)) {
    let u = m[0].replace(/[),.;]+$/g, '').replace(/\u2060/g, '');
    if (!/^https?:\/\//i.test(u)) continue;
    const low = u.toLowerCase();
    if (low.includes('schema.org')) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

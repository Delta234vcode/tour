/** Спільний retry для OpenAI-стилю streaming API (Perplexity, Grok). */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    lastRes = res;
    const isRateOrServer = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (isRateOrServer && i < retries) {
      const base = res.status === 429 ? 8000 : 5000;
      await new Promise((r) => setTimeout(r, base * (i + 1)));
      continue;
    }
    return res;
  }
  return lastRes!;
}

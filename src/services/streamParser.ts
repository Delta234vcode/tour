export type OpenAIStreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

function processOpenAiSseLine(
  raw: string,
  fullContent: { s: string },
  usage: { u?: OpenAIStreamUsage }
): void {
  if (!raw || raw === '[DONE]') return;
  try {
    const evt = JSON.parse(raw) as Record<string, unknown>;
    const delta = (evt.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content;
    if (delta) fullContent.s += delta;
    const u = evt.usage as OpenAIStreamUsage | undefined;
    if (u && typeof u === 'object') usage.u = u;
  } catch (e) {
    console.warn('parseOpenAIStream: skipped malformed SSE line', raw.slice(0, 120), e);
  }
}

export async function parseOpenAIStream(response: Response): Promise<string> {
  const { text } = await parseOpenAIStreamWithUsage(response);
  return text;
}

export async function parseOpenAIStreamWithUsage(
  response: Response
): Promise<{ text: string; usage?: OpenAIStreamUsage }> {
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const fullContent = { s: '' };
  const usage: { u?: OpenAIStreamUsage } = {};
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      processOpenAiSseLine(raw, fullContent, usage);
    }
  }

  if (buffer.startsWith('data: ')) {
    const raw = buffer.slice(6).trim();
    processOpenAiSseLine(raw, fullContent, usage);
  }

  return { text: fullContent.s, usage: usage.u };
}

export type AnthropicStreamUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

function mergeAnthropicUsage(
  acc: AnthropicStreamUsage,
  u: Record<string, unknown> | undefined
): void {
  if (!u || typeof u !== 'object') return;
  const inp = u.input_tokens;
  const out = u.output_tokens;
  if (typeof inp === 'number') acc.input_tokens = Math.max(acc.input_tokens ?? 0, inp);
  if (typeof out === 'number') acc.output_tokens = Math.max(acc.output_tokens ?? 0, out);
}

export async function parseAnthropicStream(response: Response): Promise<string> {
  const { text } = await parseAnthropicStreamWithUsage(response);
  return text;
}

export async function parseAnthropicStreamWithUsage(
  response: Response
): Promise<{ text: string; usage?: AnthropicStreamUsage }> {
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  const usage: AnthropicStreamUsage = {};
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw) as Record<string, unknown>;
        if (evt.type === 'content_block_delta' && (evt.delta as { text?: string })?.text) {
          fullContent += (evt.delta as { text: string }).text;
        }
        const msg = evt.message as Record<string, unknown> | undefined;
        if (msg?.usage) mergeAnthropicUsage(usage, msg.usage as Record<string, unknown>);
        if (evt.usage) mergeAnthropicUsage(usage, evt.usage as Record<string, unknown>);
      } catch (e) {
        console.warn('parseAnthropicStream: skipped malformed SSE line', raw.slice(0, 120), e);
      }
    }
  }

  const hasUsage =
    typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number';
  return { text: fullContent, usage: hasUsage ? usage : undefined };
}

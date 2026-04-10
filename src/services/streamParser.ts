export async function parseOpenAIStream(response: Response): Promise<string> {
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
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
        const evt = JSON.parse(raw);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      } catch (e) {
        console.warn('parseOpenAIStream: skipped malformed SSE line', raw.slice(0, 120), e);
      }
    }
  }

  if (buffer.startsWith('data: ')) {
    const raw = buffer.slice(6).trim();
    if (raw && raw !== '[DONE]') {
      try {
        const evt = JSON.parse(raw);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      } catch (e) {
        console.warn('parseOpenAIStream: skipped trailing buffer', raw.slice(0, 120), e);
      }
    }
  }

  return fullContent;
}

export async function parseAnthropicStream(response: Response): Promise<string> {
  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
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
        const evt = JSON.parse(raw);
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          fullContent += evt.delta.text;
        }
      } catch (e) {
        console.warn('parseAnthropicStream: skipped malformed SSE line', raw.slice(0, 120), e);
      }
    }
  }

  return fullContent;
}

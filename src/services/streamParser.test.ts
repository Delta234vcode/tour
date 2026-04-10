import { describe, it, expect } from 'vitest';
import { parseOpenAIStream, parseAnthropicStream } from './streamParser';

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    })
  );
}

describe('parseOpenAIStream', () => {
  it('accumulates delta content from SSE lines', async () => {
    const res = sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    ]);
    const text = await parseOpenAIStream(res);
    expect(text).toBe('Hello world');
  });

  it('ignores malformed JSON lines with warning path covered', async () => {
    const res = sseResponse([
      'data: not-json\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    ]);
    const text = await parseOpenAIStream(res);
    expect(text).toBe('ok');
  });
});

describe('parseAnthropicStream', () => {
  it('accumulates content_block_delta text', async () => {
    const res = sseResponse([
      'data: {"type":"content_block_delta","delta":{"text":"A"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"B"}}\n\n',
    ]);
    const text = await parseAnthropicStream(res);
    expect(text).toBe('AB');
  });
});

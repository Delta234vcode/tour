import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { GeminiChatSession } from '../services/gemini';
import type { ChatMsg } from '../components/ChatMessage';

export function useGeminiChat(
  chatRef: MutableRefObject<GeminiChatSession | null>,
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>
) {
  const streamAbortRef = useRef<AbortController | null>(null);

  const abortStream = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  const streamGeminiResponse = useCallback(
    async (prompt: string, modelMsgId: string): Promise<boolean> => {
      if (!chatRef.current) return false;

      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;
      const { signal } = ac;

      let retries = 3;
      let delay = 5000;

      while (retries > 0) {
        if (signal.aborted) return false;
        try {
          const stream = await chatRef.current.sendMessageStream({ message: prompt, signal });
          for await (const chunk of stream) {
            if (signal.aborted) break;
            const text = chunk.text ?? '';
            if (!text) continue;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === modelMsgId ? { ...msg, content: msg.content + text } : msg
              )
            );
          }
          if (signal.aborted) return false;
          if (streamAbortRef.current === ac) streamAbortRef.current = null;
          return true;
        } catch (error: unknown) {
          if (signal.aborted) {
            if (streamAbortRef.current === ac) streamAbortRef.current = null;
            return false;
          }
          const errorStr = String(error);
          if (
            errorStr.includes('429') ||
            errorStr.includes('RESOURCE_EXHAUSTED') ||
            errorStr.includes('quota')
          ) {
            retries--;
            if (retries === 0) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === modelMsgId
                    ? {
                        ...msg,
                        content: msg.content + '\n\n**Помилка:** Перевищено ліміт запитів.',
                      }
                    : msg
                )
              );
              if (streamAbortRef.current === ac) streamAbortRef.current = null;
              return false;
            }
            await new Promise((res) => setTimeout(res, delay));
            delay *= 2;
          } else {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === modelMsgId
                  ? {
                      ...msg,
                      content: msg.content + '\n\n**Помилка:** Не вдалося завершити аналіз.',
                    }
                  : msg
              )
            );
            if (streamAbortRef.current === ac) streamAbortRef.current = null;
            return false;
          }
        }
      }
      if (streamAbortRef.current === ac) streamAbortRef.current = null;
      return false;
    },
    [chatRef, setMessages]
  );

  return { streamGeminiResponse, abortStream };
}

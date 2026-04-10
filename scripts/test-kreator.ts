/**
 * Тест API з артистом Kreator та 3 містами (Берлін, Варшава, Прага).
 * Запускай після npm run dev (в іншому терміналі).
 *
 * npx tsx scripts/test-kreator.ts
 */

const BASE = 'http://localhost:3000';

const PERPLEXITY_SYSTEM = `Ти — Concert Research Agent. Мова: УКРАЇНСЬКА. Шукай концертну історію на setlist.fm, songkick. Не вигадуй ціни.`;

const GROK_SYSTEM = `Ти — X/Twitter Intelligence Agent. Мова: УКРАЇНСЬКА. Аналізуй buzz та сентимент фанатів.`;

async function post(path: string, body: object): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

async function main() {
  const artist = 'Kreator';
  const cities = ['Берлін', 'Варшава', 'Прага'];

  console.log('--- Тест: артист Kreator, міста:', cities.join(', '), '---\n');

  console.log('1. Perplexity (концертна історія)...');
  const p = await post('/api/perplexity', {
    model: 'sonar-pro',
    messages: [
      { role: 'system', content: PERPLEXITY_SYSTEM },
      { role: 'user', content: `Знайди концертну історію артиста "${artist}" за останні 3-4 роки. Дати, міста, майданчики.` },
    ],
    temperature: 0.1,
  });
  if (p.ok) {
    const content = (p.data as any)?.choices?.[0]?.message?.content;
    console.log('   OK:', content ? `${String(content).slice(0, 200)}...` : '(пусто)');
  } else {
    console.log('   ПОМИЛКА', p.status, (p.data as any)?.error?.message || p.text.slice(0, 200));
  }

  console.log('\n2. Grok (X/Twitter buzz)...');
  const k = await post('/api/grok', {
    model: 'grok-4-1-fast-non-reasoning',
    messages: [
      { role: 'system', content: GROK_SYSTEM },
      { role: 'user', content: `Проаналізуй buzz навколо артиста "${artist}" на X/Twitter. Сентимент, регіони, обговорення турів.` },
    ],
    temperature: 0.3,
  });
  if (k.ok) {
    const content = (k.data as any)?.choices?.[0]?.message?.content;
    console.log('   OK:', content ? `${String(content).slice(0, 200)}...` : '(пусто)');
  } else {
    console.log('   ПОМИЛКА', k.status, (k.data as any)?.error?.message || k.text.slice(0, 200));
  }

  console.log('\n3. Perplexity по містах (майданчики, готелі)...');
  const pc = await post('/api/perplexity', {
    model: 'sonar-pro',
    messages: [
      { role: 'system', content: PERPLEXITY_SYSTEM },
      { role: 'user', content: `Для артиста "${artist}" знайди по містах ${cities.join(', ')}: концертні майданчики, готелі поблизу, логістика. Ціни тільки з джерел або н/д.` },
    ],
    temperature: 0.1,
  });
  if (pc.ok) {
    const content = (pc.data as any)?.choices?.[0]?.message?.content;
    console.log('   OK:', content ? `${String(content).slice(0, 200)}...` : '(пусто)');
  } else {
    console.log('   ПОМИЛКА', pc.status, (pc.data as any)?.error?.message || pc.text.slice(0, 200));
  }

  console.log('\n--- Кінець тесту ---');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

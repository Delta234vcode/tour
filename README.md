<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f4628d83-e918-4b1b-bb0d-c4a118359317

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Скопіюй [.env.example](.env.example) у `.env.local` і заповни ключі (мінімум для повного аналізу: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GROK_API_KEY`). Ніколи не коміть ключі в git.
3. На **Vercel** додай ті самі змінні в Project → Settings → Environment Variables.
5. Run the app:
   `npm run dev`

**Перевірка API (локально):** у другому терміналі після `npm run dev` — `npx tsx scripts/test-kreator.ts` (тестує `/api/perplexity`, `/api/grok` на прикладі Kreator).

**Скрипти:** `npm run lint` (перевірка TypeScript), `npm run build` (прод-збірка), `npm run clean` (видаляє `dist`, працює на Windows/macOS/Linux).

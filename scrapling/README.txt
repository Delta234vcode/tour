Scrapling (Python) — частина цього репозиторію; місток для Perplexity / Grok / Claude.
Репозиторій бібліотеки: https://github.com/D4Vinci/Scrapling

--- Варіант A: Docker (інтегровано в проєкт, без локального Python) ---
З кореня репо:
  npm run scraper:docker
Перший build може бути довгим (scrapling install). Потім: npm run dev
Зупинка: npm run scraper:docker:down
Логи: npm run scraper:docker:logs
Опційно в .env у корені: SCRAPER_SERVICE_SECRET=... (той самий секрет, якщо проксієте з Vercel).

--- Варіант B: Локальний Python ---
1) Python 3.10+
2) cd scrapling
3) python -m venv .venv
4) .venv\Scripts\activate  (Windows)  або  source .venv/bin/activate
5) pip install -r requirements.txt
6) scrapling install
7) З кореня: npm run scraper
8) Інший термінал: npm run dev

Vercel: Node не запускає Scrapling; задайте SCRAPER_SERVICE_URL на URL контейнера/VPS і SCRAPER_SERVICE_SECRET.

Режим "stealth" у POST /scrape (поле mode) вимагає браузер; за замовчуванням mode=fetch (HTTP Fetcher).

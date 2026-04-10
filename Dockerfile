# ============================================================
# CHAIKA EVENTS — single Railway service
# Stage 1: build Vite frontend
# Stage 2: Python runtime (FastAPI + Scrapling + static dist/)
# ============================================================

FROM node:20-slim AS frontend

WORKDIR /build

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

ARG CACHEBUST=1
RUN npm run build

# --- Stage 2: Python runtime ---
FROM python:3.12-slim-bookworm

RUN useradd --create-home --uid 1000 appuser

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY scrapling/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Browser stack for Scrapling stealth (optional); set SCRAPLING_INSTALL_BROWSER=1 to enforce
ARG SCRAPLING_INSTALL_BROWSER=0
RUN if [ "$SCRAPLING_INSTALL_BROWSER" = "1" ]; then scrapling install; else echo "Skipping scrapling install (HTTP fetchers work without browser). Set SCRAPLING_INSTALL_BROWSER=1 if you need stealth mode."; fi

COPY scrapling/*.py .

COPY --from=frontend /build/dist ./dist

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8765

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "python -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-8765}"]

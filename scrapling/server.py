"""
CHAIKA EVENTS — єдиний бекенд (Railway).
  - Статика Vite (dist/)
  - Проксі AI API (Gemini, Claude, Perplexity, Grok) — ключі лише на сервері
  - Скрапінг (Scrapling): /scrape, /concerts
  - Кеш минулих концертів: GET/POST /api/past-concert-cache → data/past_concert_cache.json
Запуск: uvicorn server:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from unidecode import unidecode

from concerts import fetch_all_concerts

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("chaika.server")

app = FastAPI(title="CHAIKA EVENTS", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TIMEOUT = httpx.Timeout(600.0, connect=30.0)

MAX_URLS = 20
DEFAULT_CHARS = 10_000

GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"


# ================================================================
#  Доступ до AI-проксі (опційно)
# ================================================================


def _allowed_origins_set() -> set[str]:
    raw = (os.environ.get("ALLOWED_ORIGINS") or "").strip()
    if not raw:
        return set()
    return {o.strip() for o in raw.split(",") if o.strip()}


def _check_ai_proxy_access(request: Request) -> None:
    """Якщо ALLOWED_ORIGINS задано — перевіряємо заголовок Origin."""
    allowed = _allowed_origins_set()
    if not allowed:
        return
    origin = (request.headers.get("origin") or "").strip()
    if origin and origin in allowed:
        return
    referer = (request.headers.get("referer") or "").strip()
    for o in allowed:
        if referer.startswith(o):
            return
    log.warning("ai_proxy blocked: origin=%r referer=%r", origin, referer[:80] if referer else "")
    raise HTTPException(status_code=403, detail="Origin not allowed")


def _check_ai_proxy_secret(request: Request, header_value: str | None) -> None:
    """Якщо AI_PROXY_SECRET задано — вимагаємо X-AI-Proxy-Secret (для BFF / внутрішніх викликів)."""
    expected = (os.environ.get("AI_PROXY_SECRET") or "").strip()
    if not expected:
        return
    got = (header_value or "").strip()
    if got != expected:
        raise HTTPException(status_code=401, detail="Invalid AI proxy secret")


def _startup_env_warnings() -> None:
    if not (os.environ.get("GEMINI_API_KEY") or "").strip():
        log.warning("GEMINI_API_KEY not set — Gemini proxy and UI chat will fail")
    for name in ("ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY", "GROK_API_KEY"):
        if not (os.environ.get(name) or "").strip():
            log.warning("%s not set — %s proxy may return 401", name, name.split("_")[0].lower())


@app.on_event("startup")
def _on_startup() -> None:
    _startup_env_warnings()


# ================================================================
#  Gemini (ключ лише на сервері, SSE stream)
# ================================================================


def _normalize_gemini_json(body: dict[str, Any]) -> dict[str, Any]:
    """REST очікує google_search; клієнт може надіслати googleSearch."""
    out = dict(body)
    tools = out.get("tools")
    if isinstance(tools, list):
        normalized: list[Any] = []
        for t in tools:
            if isinstance(t, dict) and "googleSearch" in t and "google_search" not in t:
                gs = t.get("googleSearch")
                normalized.append({"google_search": gs if isinstance(gs, dict) else {}})
            else:
                normalized.append(t)
        out["tools"] = normalized
    return out


@app.post("/api/gemini/stream")
async def proxy_gemini_stream(
    request: Request,
    x_ai_proxy_secret: str | None = Header(None, alias="X-AI-Proxy-Secret"),
):
    _check_ai_proxy_access(request)
    _check_ai_proxy_secret(request, x_ai_proxy_secret)
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured on server")

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object expected")
    model = (body.get("model") or "gemini-2.5-flash").strip()
    if not model or len(model) > 128 or any(c in model for c in ("\n", "\r", "/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid model id")
    payload = _normalize_gemini_json({k: v for k, v in body.items() if k != "apiKey"})
    encoded_model = quote(model, safe="")
    url = (
        f"{GEMINI_API_ROOT}/models/{encoded_model}:streamGenerateContent"
        f"?key={quote(key, safe='')}&alt=sse"
    )

    client = httpx.AsyncClient(timeout=TIMEOUT)
    try:
        req = client.build_request(
            "POST",
            url,
            headers={"Content-Type": "application/json"},
            content=json.dumps(payload),
        )
        resp = await client.send(req, stream=True)
        log.info("gemini stream started model=%s status=%s", model, resp.status_code)

        async def _stream():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        media = resp.headers.get("content-type") or "text/event-stream"
        return StreamingResponse(
            _stream(),
            status_code=resp.status_code,
            media_type=media,
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except HTTPException:
        await client.aclose()
        raise
    except Exception as exc:
        await client.aclose()
        log.exception("gemini proxy error: %s", exc)
        return StreamingResponse(
            iter([str(exc).encode()]),
            status_code=502,
            media_type="text/plain",
        )


# ================================================================
#  AI API Proxies (Claude, Perplexity, Grok)
# ================================================================


@app.post("/api/claude")
async def proxy_claude(
    request: Request,
    x_ai_proxy_secret: str | None = Header(None, alias="X-AI-Proxy-Secret"),
):
    _check_ai_proxy_access(request)
    _check_ai_proxy_secret(request, x_ai_proxy_secret)
    body = await request.json()
    body["stream"] = True
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    client = httpx.AsyncClient(timeout=TIMEOUT)
    try:
        req = client.build_request(
            "POST",
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
        resp = await client.send(req, stream=True)

        async def _stream():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            _stream(),
            status_code=resp.status_code,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except Exception as exc:
        await client.aclose()
        log.exception("claude proxy: %s", exc)
        return StreamingResponse(
            iter([str(exc).encode()]),
            status_code=502,
            media_type="text/plain",
        )


@app.post("/api/perplexity")
async def proxy_perplexity(
    request: Request,
    x_ai_proxy_secret: str | None = Header(None, alias="X-AI-Proxy-Secret"),
):
    _check_ai_proxy_access(request)
    _check_ai_proxy_secret(request, x_ai_proxy_secret)
    body = await request.json()
    body["stream"] = True
    key = os.environ.get("PERPLEXITY_API_KEY", "")
    client = httpx.AsyncClient(timeout=TIMEOUT)
    try:
        req = client.build_request(
            "POST",
            "https://api.perplexity.ai/chat/completions",
            headers={
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
            },
            json=body,
        )
        resp = await client.send(req, stream=True)

        async def _stream():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            _stream(),
            status_code=resp.status_code,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except Exception as exc:
        await client.aclose()
        log.exception("perplexity proxy: %s", exc)
        return StreamingResponse(
            iter([str(exc).encode()]),
            status_code=502,
            media_type="text/plain",
        )


@app.post("/api/grok")
async def proxy_grok(
    request: Request,
    x_ai_proxy_secret: str | None = Header(None, alias="X-AI-Proxy-Secret"),
):
    _check_ai_proxy_access(request)
    _check_ai_proxy_secret(request, x_ai_proxy_secret)
    body = await request.json()
    body["stream"] = True
    key = os.environ.get("GROK_API_KEY", "")
    client = httpx.AsyncClient(timeout=TIMEOUT)
    try:
        req = client.build_request(
            "POST",
            "https://api.x.ai/v1/chat/completions",
            headers={
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
            },
            json=body,
        )
        resp = await client.send(req, stream=True)

        async def _stream():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            _stream(),
            status_code=resp.status_code,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except Exception as exc:
        await client.aclose()
        log.exception("grok proxy: %s", exc)
        return StreamingResponse(
            iter([str(exc).encode()]),
            status_code=502,
            media_type="text/plain",
        )


# ================================================================
#  Scraping endpoints
# ================================================================


def _auth_ok(secret_header: str | None) -> None:
    expected = (os.environ.get("SCRAPER_SERVICE_SECRET") or "").strip()
    if not expected:
        return
    got = (secret_header or "").strip()
    if got != expected:
        raise HTTPException(status_code=401, detail="Invalid scraper secret")


class ScrapeRequest(BaseModel):
    urls: list[str] = Field(default_factory=list, max_length=MAX_URLS)
    max_chars_per_page: int = Field(default=DEFAULT_CHARS, ge=500, le=50_000)
    mode: Literal["fetch", "stealth"] = "fetch"


def _fetch_one(url: str, max_chars: int, mode: str) -> dict[str, Any]:
    try:
        if mode == "stealth":
            from scrapling.fetchers import StealthyFetcher

            page = StealthyFetcher.fetch(url, headless=True, network_idle=False)
        else:
            from scrapling.fetchers import Fetcher

            page = Fetcher.get(url, stealthy_headers=True)

        parts = page.css("body *::text").getall()
        blob = " ".join(p.strip() for p in parts if p and p.strip())
        if len(blob) > max_chars:
            blob = blob[:max_chars] + "\n…[trimmed]"
        return {"url": url, "text": blob, "error": None}
    except Exception as e:
        log.warning("scrape fetch failed url=%s err=%s", url[:80], e)
        return {"url": url, "text": "", "error": str(e)[:800]}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/scrape")
def scrape(
    body: ScrapeRequest,
    x_scraper_secret: str | None = Header(None, alias="X-Scraper-Secret"),
) -> dict[str, Any]:
    _auth_ok(x_scraper_secret)
    seen: set[str] = set()
    urls: list[str] = []
    for raw in body.urls[:MAX_URLS]:
        u = (raw or "").strip()
        if not u.startswith(("http://", "https://")):
            continue
        if u in seen:
            continue
        seen.add(u)
        urls.append(u)

    snippets: list[dict[str, Any]] = []
    for u in urls:
        snippets.append(_fetch_one(u, body.max_chars_per_page, body.mode))

    return {"ok": True, "skipped": False, "snippets": snippets}


class ConcertRequest(BaseModel):
    artist: str = Field(min_length=1)


@app.post("/api/concerts")
def concerts(
    body: ConcertRequest,
    x_scraper_secret: str | None = Header(None, alias="X-Scraper-Secret"),
) -> dict[str, Any]:
    _auth_ok(x_scraper_secret)
    return fetch_all_concerts(body.artist.strip())


# Зворотна сумісність (старі URL без /api/ префіксу)
@app.post("/scrape")
def scrape_compat(
    body: ScrapeRequest,
    x_scraper_secret: str | None = Header(None, alias="X-Scraper-Secret"),
) -> dict[str, Any]:
    return scrape(body, x_scraper_secret)


@app.post("/concerts")
def concerts_compat(
    body: ConcertRequest,
    x_scraper_secret: str | None = Header(None, alias="X-Scraper-Secret"),
) -> dict[str, Any]:
    return concerts(body, x_scraper_secret)


# ================================================================
#  Кеш минулих концертів (JSON у scrapling/data/)
# ================================================================

PAST_CACHE_PATH = Path(__file__).resolve().parent / "data" / "past_concert_cache.json"


def _norm_seg(s: str) -> str:
    t = unidecode((s or "").lower())
    return re.sub(r"[^a-z0-9]+", "", t)[:56]


def _past_row_key(row: dict[str, Any]) -> str:
    city = (row.get("city") or "").split(",")[0].strip()
    return f'{row.get("date") or ""}|{_norm_seg(city)}|{_norm_seg(row.get("venue") or "")}'


def _past_row_score(row: dict[str, Any]) -> int:
    n = 0
    if (row.get("venue") or "").strip():
        n += 3
    if (row.get("price_label") or "").strip():
        n += 3
    if (row.get("country") or "").strip():
        n += 1
    if (row.get("city") or "").strip():
        n += 1
    if (row.get("url") or "").strip():
        n += 1
    if (row.get("event_status") or "").strip():
        n += 1
    src = str(row.get("source") or "")
    if "Gemini" not in src:
        n += 2
    if "Perplexity" in src:
        n -= 1
    return n


def _merge_past_row_dicts(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> list[dict[str, Any]]:
    m: dict[str, dict[str, Any]] = {}
    for row in a + b:
        if not (row.get("date") or "").strip():
            continue
        k = _past_row_key(row)
        prev = m.get(k)
        if prev is None or _past_row_score(row) > _past_row_score(prev):
            m[k] = dict(row)
    return list(m.values())


def _load_past_cache_root() -> dict[str, Any]:
    if not PAST_CACHE_PATH.is_file():
        return {"version": 1, "entries": {}}
    try:
        with PAST_CACHE_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or data.get("version") != 1:
            return {"version": 1, "entries": {}}
        entries = data.get("entries")
        if not isinstance(entries, dict):
            entries = {}
        return {"version": 1, "entries": entries}
    except Exception as e:
        log.warning("past cache load failed: %s", e)
        return {"version": 1, "entries": {}}


def _save_past_cache_root(data: dict[str, Any]) -> None:
    PAST_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PAST_CACHE_PATH.with_suffix(".tmp.json")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(PAST_CACHE_PATH)


class PastConcertRow(BaseModel):
    date: str | None = None
    city: str = ""
    country: str = ""
    venue: str = ""
    url: str = ""
    source: str = ""
    price_label: str | None = None
    event_status: str | None = None


class PastCacheUpsert(BaseModel):
    key: str = Field(min_length=1, max_length=96)
    artistDisplay: str = ""
    past: list[PastConcertRow] = Field(default_factory=list)


@app.get("/api/past-concert-cache")
def get_past_concert_cache(key: str) -> dict[str, Any]:
    k = (key or "").strip()
    if not k:
        raise HTTPException(status_code=400, detail="missing key")
    root = _load_past_cache_root()
    ent = root["entries"].get(k)
    if not isinstance(ent, dict):
        raise HTTPException(status_code=404, detail="no cache for key")
    past = ent.get("past") or []
    if not isinstance(past, list):
        past = []
    return {
        "key": k,
        "artistDisplay": ent.get("artistDisplay") or "",
        "past": past,
        "updatedAt": ent.get("updatedAt"),
    }


@app.post("/api/past-concert-cache")
def post_past_concert_cache(body: PastCacheUpsert) -> dict[str, Any]:
    root = _load_past_cache_root()
    entries: dict[str, Any] = root["entries"]
    k = body.key.strip()
    existing = entries.get(k)
    old_past: list[Any] = []
    if isinstance(existing, dict):
        raw = existing.get("past") or []
        if isinstance(raw, list):
            old_past = [x for x in raw if isinstance(x, dict)]
    new_dicts = [r.model_dump() for r in body.past]
    merged = _merge_past_row_dicts(old_past, new_dicts)
    entries[k] = {
        "artistDisplay": body.artistDisplay.strip() or k,
        "past": merged,
        "updatedAt": int(time.time() * 1000),
    }
    _save_past_cache_root(root)
    log.info("past_concert_cache upsert key=%s rows=%s", k, len(merged))
    return {"ok": True, "count": len(merged)}


# ================================================================
#  Static files — Vite build (dist/)
# ================================================================

DIST_DIR = Path(__file__).resolve().parent / "dist"
if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")

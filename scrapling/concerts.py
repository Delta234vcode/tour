"""
Скрапінг концертних платформ для точних дат виступів артиста.
- setlist.fm: пошук + парсинг (Selector з HTML)
- bandsintown: REST API (потрібен BANDSINTOWN_APP_ID) або пошук HTML → /a/123 або /a/123-slug (з фінального URL після редіректу)
- songkick: пошук артиста → gigography/calendar
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime
from typing import Any
from urllib.parse import quote, quote_plus, urlparse

import httpx

log = logging.getLogger("chaika.concerts")

# Заголовки як у звичайного браузера (Railway / дата-центри інколи отримують 202 без тіла без них)
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,uk;q=0.8",
}


def _parse_date(raw: str) -> str | None:
    raw = raw.strip()
    if not raw:
        return None
    for fmt in (
        "%b %d, %Y",
        "%B %d, %Y",
        "%d %b %Y",
        "%d %B %Y",
        "%Y-%m-%d",
        "%d.%m.%Y",
        "%m/%d/%Y",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def _days_from_today(iso_date: str) -> int | None:
    try:
        d = datetime.strptime(iso_date, "%Y-%m-%d").date()
        return (date.today() - d).days
    except Exception:
        return None


def _event_dict(
    dt: str | None,
    city: str,
    country: str,
    venue: str,
    url: str,
    source: str,
) -> dict[str, Any]:
    days = _days_from_today(dt) if dt else None
    return {
        "date": dt,
        "city": city.strip(),
        "country": country.strip(),
        "venue": venue.strip(),
        "url": url.strip(),
        "source": source,
        "days_ago": days if days is not None and days >= 0 else None,
        "days_until": -days if days is not None and days < 0 else None,
    }


def _selector_from_html(html: str):
    from scrapling.parser import Selector

    return Selector(html)


# --------------- setlist.fm (API first, HTML fallback) ---------------

_SETLISTFM_API = "https://api.setlist.fm/rest/1.0"
_SETLISTFM_HEADERS_BASE = {"Accept": "application/json"}


def _setlistfm_api_key() -> str:
    return (os.environ.get("SETLISTFM_API_KEY") or "").strip()


def _setlistfm_normalize_setlist_list(data: dict[str, Any]) -> list[dict[str, Any]]:
    """API sometimes returns one setlist as object instead of list."""
    sl = data.get("setlist")
    if sl is None:
        return []
    if isinstance(sl, dict):
        return [sl]
    if isinstance(sl, list):
        return sl
    return []


def _setlistfm_events_from_json(setlists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for sl in setlists:
        raw_date = (sl.get("eventDate") or "").strip()  # dd-MM-yyyy
        iso = None
        if raw_date:
            m = re.match(r"(\d{2})-(\d{2})-(\d{4})", raw_date)
            if m:
                iso = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        venue = sl.get("venue") or {}
        vname = (venue.get("name") or "").strip()
        city_obj = venue.get("city") or {}
        city_name = (city_obj.get("name") or "").strip()
        country_obj = city_obj.get("country") or {}
        country_name = (country_obj.get("name") or "").strip()
        url = (sl.get("url") or "").strip()
        if iso or city_name or vname:
            out.append(_event_dict(iso, city_name, country_name, vname, url, "setlist.fm"))
    return out


def _setlistfm_search_artist_mbid(artist: str, api_key: str) -> str | None:
    """Search for artist by name, return Musicbrainz ID of the best match."""
    try:
        r = httpx.get(
            f"{_SETLISTFM_API}/search/artists",
            params={"artistName": artist, "p": "1", "sort": "relevance"},
            headers={**_SETLISTFM_HEADERS_BASE, "x-api-key": api_key},
            timeout=30.0,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        artists = data.get("artist") or []
        if not artists:
            return None
        q_low = artist.lower().strip()
        for a in artists:
            name = (a.get("name") or "").strip()
            if name.lower() == q_low:
                return a.get("mbid")
        for a in artists:
            name = (a.get("name") or "").strip()
            if q_low in name.lower() or name.lower() in q_low:
                return a.get("mbid")
        return artists[0].get("mbid") if artists else None
    except Exception:
        log.warning("setlist.fm: artist MBID search failed for %r", artist, exc_info=True)
        return None


def scrape_setlistfm_api(artist: str) -> list[dict[str, Any]]:
    """Fetch setlists from API. Ordering is chronological (often oldest first); we request
    early pages AND the last pages so recent European shows are not cut off after ~100 rows."""
    api_key = _setlistfm_api_key()
    if not api_key:
        return []
    mbid = _setlistfm_search_artist_mbid(artist, api_key)
    if not mbid:
        return []

    def fetch_page(p: int) -> tuple[list[dict[str, Any]], int, int]:
        r = httpx.get(
            f"{_SETLISTFM_API}/artist/{mbid}/setlists",
            params={"p": str(p)},
            headers={**_SETLISTFM_HEADERS_BASE, "x-api-key": api_key},
            timeout=30.0,
        )
        if r.status_code != 200:
            return [], 0, 20
        data = r.json()
        return _setlistfm_normalize_setlist_list(data), int(data.get("total") or 0), int(data.get("itemsPerPage") or 20) or 20

    all_setlists: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def add_batch(batch: list[dict[str, Any]]) -> None:
        for sl in batch:
            sid = (sl.get("id") or sl.get("versionId") or "") + "|" + (sl.get("eventDate") or "")
            if sid in seen_ids:
                continue
            seen_ids.add(sid)
            all_setlists.append(sl)

    try:
        batch, total, per_page = fetch_page(1)
        if not batch and total == 0:
            return []
        add_batch(batch)
        last_page = max(1, (total + per_page - 1) // per_page) if total else 1

        # Head: pages 2..8 (more history / or recent if API is reversed)
        head_end = min(last_page, 8)
        for p in range(2, head_end + 1):
            batch, _, _ = fetch_page(p)
            if not batch:
                break
            add_batch(batch)

        # Tail: last 8 pages (recent shows if API sorts oldest → newest)
        tail_start = max(2, last_page - 7)
        for p in range(tail_start, last_page + 1):
            if p <= head_end:
                continue
            batch, _, _ = fetch_page(p)
            if not batch:
                break
            add_batch(batch)
    except Exception:
        log.warning("setlist.fm API: pagination failed for artist=%r", artist, exc_info=True)

    return _setlistfm_events_from_json(all_setlists)


def _scrape_setlistfm_html(artist: str) -> list[dict[str, Any]]:
    """HTML fallback when API key is not set."""
    events: list[dict[str, Any]] = []
    q = quote_plus(artist)
    urls_to_try = (
        f"https://www.setlist.fm/search?query={q}&type=setlists",
        f"https://www.setlist.fm/search?query={q}",
    )

    html = ""
    for search_url in urls_to_try:
        try:
            r = httpx.get(search_url, headers=_BROWSER_HEADERS, follow_redirects=True, timeout=45.0)
            if r.status_code == 200 and len(r.text) > 500:
                html = r.text
                break
        except Exception:
            log.debug("setlist.fm HTML: GET failed %s", search_url, exc_info=True)
            continue

    if not html:
        try:
            from scrapling.fetchers import Fetcher

            page = Fetcher.get(urls_to_try[0], stealthy_headers=True)
            html = page.text or ""
        except Exception:
            log.warning("setlist.fm HTML: Scrapling fetcher failed", exc_info=True)
            return events

    root = _selector_from_html(html)
    rows = root.css(".setlistPreview") or root.css("[data-type='setlist']")
    for row in rows[:80]:
        date_parts = []
        for sel in (".month", ".day", ".year"):
            el = row.css(sel)
            if el:
                date_parts.append(el[0].css("::text").get("").strip())
        raw_date = " ".join(date_parts).strip()
        iso = _parse_date(raw_date)

        venue_el = row.css(".setlistHeadline a, .venue a, a[href*='/venue/']")
        venue = venue_el[0].css("::text").get("").strip() if venue_el else ""

        city_el = row.css(".setlistHeadline span, .venue span, span[itemprop='addressLocality']")
        city_text = city_el[0].css("::text").get("").strip() if city_el else ""
        parts = [p.strip() for p in city_text.split(",")]
        city_name = parts[0] if parts else ""
        country_name = parts[-1] if len(parts) > 1 else ""

        link_el = row.css("a[href*='/setlist/']")
        href = link_el[0].attrib.get("href", "") if link_el else ""
        full_url = f"https://www.setlist.fm{href}" if href.startswith("/") else href

        if iso or city_name:
            events.append(_event_dict(iso, city_name, country_name, venue, full_url, "setlist.fm"))

    if not events:
        for m in re.finditer(
            r'href="(/setlist/[^"]+\.html)"[^>]*>[\s\S]{0,400}?'
            r'(?:<span[^>]*>(\w{3})</span>\s*<span[^>]*>(\d{1,2})</span>\s*<span[^>]*>(\d{4})</span>)',
            html,
            re.I,
        ):
            href, mon, day, year = m.group(1), m.group(2), m.group(3), m.group(4)
            try:
                raw = f"{mon} {day}, {year}"
                iso = _parse_date(raw)
            except Exception:
                log.debug("setlist.fm HTML: regex date parse failed", exc_info=True)
                iso = None
            if iso:
                events.append(
                    _event_dict(iso, "", "", "", f"https://www.setlist.fm{href}", "setlist.fm")
                )

    return events[:100]


def scrape_setlistfm(artist: str) -> list[dict[str, Any]]:
    """API first (needs SETLISTFM_API_KEY), HTML scraper as fallback."""
    ev = scrape_setlistfm_api(artist)
    if ev:
        return ev
    return _scrape_setlistfm_html(artist)


# --------------- bandsintown (REST + HTML) ---------------

def _bandsintown_events_from_json(data: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ev in data:
        if not isinstance(ev, dict):
            continue
        dt_raw = ev.get("starts_at") or ev.get("datetime") or ev.get("startsAt") or ""
        iso = None
        if dt_raw:
            iso = dt_raw[:10] if re.match(r"\d{4}-\d{2}-\d{2}", dt_raw[:10]) else _parse_date(dt_raw)

        venue = ev.get("venue") or {}
        if isinstance(venue, dict):
            vname = (venue.get("name") or "").strip()
            vcity = (venue.get("city") or "").strip()
            vcountry = (venue.get("country") or "").strip()
        else:
            vname, vcity, vcountry = "", "", ""

        url = (ev.get("url") or ev.get("link") or "").strip()
        if iso or vcity or vname:
            out.append(_event_dict(iso, vcity, vcountry, vname, url, "bandsintown.com"))
    return out


def _normalize_bandsintown_artist_path(path: str) -> str | None:
    """Шлях артиста: /a/123 або /a/123-slug (раніше вимагали лише варіант з дефісом — редіректи дають /a/123)."""
    p = (path or "").split("?")[0].split("#")[0].strip()
    if not p.startswith("/"):
        p = "/" + p.lstrip("/")
    p = p.rstrip("/") or "/"
    if not re.match(r"^/a/\d+(?:-[^/]+)?$", p):
        return None
    return p


def _pick_best_bandsintown_path(candidates: list[str]) -> str | None:
    norm: list[str] = []
    for c in candidates:
        n = _normalize_bandsintown_artist_path(c)
        if n and n not in norm:
            norm.append(n)
    if not norm:
        return None
    with_slug = [p for p in norm if re.match(r"^/a/\d+-", p)]
    pool = with_slug or norm
    return max(pool, key=len)


def _resolve_bandsintown_artist_path(html: str, final_url: str) -> str | None:
    cands: list[str] = []
    for m in re.finditer(r'href=["\']([^"\']*?/a/\d+(?:-[^"\']+)?)["\']', html, re.I):
        href = m.group(1).strip()
        if "facebook.com" in href:
            continue
        path = urlparse(href).path if href.startswith("http") else href.split("?")[0]
        n = _normalize_bandsintown_artist_path(path)
        if n:
            cands.append(n)
    for m in re.finditer(
        r'content="https://www\.bandsintown\.com(/a/\d+(?:-[^"]+)?)"',
        html,
        re.I,
    ):
        n = _normalize_bandsintown_artist_path(m.group(1))
        if n:
            cands.append(n)
    n = _normalize_bandsintown_artist_path(urlparse(final_url).path)
    if n:
        cands.append(n)
    return _pick_best_bandsintown_path(cands)


def scrape_bandsintown_api(artist: str, app_id: str) -> list[dict[str, Any]]:
    if not app_id:
        return []
    name_enc = quote(artist, safe="")
    url = f"https://rest.bandsintown.com/artists/{name_enc}/events"
    try:
        with httpx.Client(timeout=45.0) as client:
            r = client.get(url, params={"app_id": app_id, "date": "all"})
            if r.status_code != 200:
                return []
            data = r.json()
            if isinstance(data, list):
                return _bandsintown_events_from_json(data)
    except Exception:
        log.warning("bandsintown REST failed for %r", artist, exc_info=True)
    return []


def scrape_bandsintown_html(artist: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    q = quote_plus(artist)
    search_urls = (
        f"https://www.bandsintown.com/search?q={q}",
        f"https://www.bandsintown.com/search?search_term={q}",
        f"https://www.bandsintown.com/?search_term={q}",
    )

    artist_path: str | None = None
    for su in search_urls:
        try:
            r = httpx.get(su, headers=_BROWSER_HEADERS, follow_redirects=True, timeout=45.0)
            if r.status_code != 200:
                continue
            artist_path = _resolve_bandsintown_artist_path(r.text, str(r.url))
            if artist_path:
                break
        except Exception:
            log.debug("bandsintown HTML: search GET failed %s", su, exc_info=True)
            continue

    if not artist_path:
        try:
            from scrapling.fetchers import Fetcher

            page = Fetcher.get(search_urls[0], stealthy_headers=True)
            text = page.text or ""
            final = str(getattr(page, "url", None) or getattr(page, "final_url", None) or "") or search_urls[0]
            artist_path = _resolve_bandsintown_artist_path(text, final)
        except Exception:
            pass

    if not artist_path:
        return events

    base = f"https://www.bandsintown.com{artist_path}"

    for suffix in ("", "/past-events"):
        page_url = base + suffix
        try:
            r = httpx.get(page_url, headers=_BROWSER_HEADERS, follow_redirects=True, timeout=45.0)
            if r.status_code != 200:
                continue
            root = _selector_from_html(r.text)
            cards = (
                root.css("[data-testid='event-card']")
                or root.css("a[href*='/e/']")
                or root.css("[class*='EventCard']")
                or []
            )
            seen_urls: set[str] = set()
            for card in cards[:100]:
                link_el = card.css("a[href*='/e/']") if hasattr(card, "css") else []
                href = ""
                if link_el:
                    href = link_el[0].attrib.get("href", "") or link_el[0].css("::attr(href)").get() or ""
                elif hasattr(card, "attrib") and "/e/" in (card.attrib.get("href") or ""):
                    href = card.attrib.get("href", "")
                elif hasattr(card, "css"):
                    href = card.css("::attr(href)").get() or ""
                full_url = f"https://www.bandsintown.com{href}" if href.startswith("/") else href
                if full_url in seen_urls:
                    continue
                seen_urls.add(full_url)

                text_parts = card.css("*::text").getall() if hasattr(card, "css") else []
                blob = " | ".join(t.strip() for t in text_parts if t.strip())

                date_match = re.search(
                    r"(\w{3}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})",
                    blob,
                )
                iso = _parse_date(date_match.group(0)) if date_match else None

                venue = ""
                city_name = ""
                country_name = ""
                for pat in (
                    r"at\s+(.+?)\s+in\s+([^,|]+)(?:,\s*([A-Za-z\s]+))?",
                    r"([^|]+)\s*\|\s*([^|]+)",
                ):
                    mm = re.search(pat, blob)
                    if mm:
                        venue = mm.group(1).strip()[:200]
                        city_name = mm.group(2).strip()[:120]
                        country_name = mm.group(3).strip()[:80] if len(mm.groups()) > 2 else ""
                        break

                if iso or venue or city_name or full_url:
                    events.append(_event_dict(iso, city_name, country_name, venue, full_url, "bandsintown.com"))
        except Exception:
            continue

    return events


def scrape_bandsintown(artist: str) -> list[dict[str, Any]]:
    app_id = (os.environ.get("BANDSINTOWN_APP_ID") or "").strip()
    ev = scrape_bandsintown_api(artist, app_id)
    if ev:
        return ev
    return scrape_bandsintown_html(artist)


# --------------- songkick ---------------

def _songkick_city_country_from_row(row: Any) -> tuple[str, str]:
    """Gigography: metro у p.location; calendar/summary: .primary-detail; фолбек — JSON-LD."""
    metro = (row.css("p.location a[href*='/metro-areas/'] span::text").get() or "").strip()
    if not metro:
        blob = " ".join(t.strip() for t in row.css("p.location a[href*='/metro-areas/'] *::text").getall() if t.strip())
        metro = blob.strip()
    if metro:
        parts = [p.strip() for p in metro.split(",") if p.strip()]
        if len(parts) >= 2:
            return parts[0], parts[-1]
        if parts:
            return parts[0], ""
    prim = (row.css("a.event-details .primary-detail::text").get() or "").strip()
    if not prim:
        prim = (row.css(".primary-detail::text").get() or "").strip()
    if prim:
        parts = [p.strip() for p in prim.split(",") if p.strip()]
        if len(parts) >= 2:
            return parts[0], parts[-1]
        if parts:
            return parts[0], ""
    script = row.css('.microformat script[type="application/ld+json"]::text').get()
    if script:
        try:
            data = json.loads(script)
            if isinstance(data, list) and data:
                loc = (data[0].get("location") or {}) if isinstance(data[0], dict) else {}
                addr = loc.get("address") or {}
                if isinstance(addr, dict):
                    c = (addr.get("addressLocality") or "").strip()
                    co = (addr.get("addressCountry") or "").strip()
                    if c or co:
                        return c, co
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return "", ""


def _songkick_venue_from_row(row: Any) -> str:
    v = (row.css("a.event-details .secondary-detail::text").get() or "").strip()
    if v:
        return v
    v = (row.css(".secondary-detail::text").get() or "").strip()
    if v:
        return v
    v = (row.css("p.location span.venue-name a::text").get() or "").strip()
    if v:
        return v
    v = (row.css("p.location .venue-name::text").get() or "").strip()
    if v:
        return v
    el = row.css("a[href*='/venues/']")
    if el:
        return (el[0].css("::text").get() or "").strip()
    return (row.css(".venue-name a, .venue-name, strong a::text").get() or "").strip()


def _name_similarity(query: str, candidate: str) -> float:
    """Simple case-insensitive similarity: 1.0 = exact, 0.0 = no overlap."""
    q = query.lower().strip()
    c = candidate.lower().strip()
    if q == c:
        return 1.0
    if q in c or c in q:
        return 0.8
    q_words = set(re.split(r"\W+", q))
    c_words = set(re.split(r"\W+", c))
    common = q_words & c_words
    if not q_words:
        return 0.0
    return len(common) / max(len(q_words), len(c_words))


def _songkick_pick_best_artist(root: Any, html: str, artist: str) -> str | None:
    """Pick the artist link from search results that best matches the query; ignore sidebar/popular/trending."""
    search_result_links = root.css("ul.artists li a.search-link[data-resource-name='artist']")
    if not search_result_links:
        search_result_links = root.css("ul.artists li a[href*='/artists/']")
    if not search_result_links:
        search_result_links = root.css(".artists .subject a[href*='/artists/']")

    best_href: str | None = None
    best_score = 0.0
    for link in (search_result_links or []):
        href = link.attrib.get("href", "")
        if not href or "/artists/" not in href:
            continue
        name = (link.css("::text").get() or "").strip()
        if not name:
            name = (link.css("strong::text").get() or "").strip()
        score = _name_similarity(artist, name) if name else 0.0
        if score > best_score:
            best_score = score
            best_href = href

    if best_href and best_score >= 0.5:
        return best_href

    for m in re.finditer(
        r'<a[^>]*href="(/artists/\d+-[^"]+)"[^>]*class="[^"]*search-link[^"]*"[^>]*>'
        r'\s*(?:<strong>)?([^<]+?)(?:</strong>)?\s*</a>',
        html,
        re.I,
    ):
        href, name = m.group(1), m.group(2).strip()
        score = _name_similarity(artist, name)
        if score > best_score:
            best_score = score
            best_href = href

    if best_href and best_score >= 0.4:
        return best_href

    return None


def scrape_songkick(artist: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    q = quote_plus(artist)
    search_url = f"https://www.songkick.com/search?query={q}&type=artists"

    html = ""
    try:
        r = httpx.get(search_url, headers=_BROWSER_HEADERS, follow_redirects=True, timeout=45.0)
        if r.status_code == 200:
            html = r.text
    except Exception:
        log.warning("songkick: search request failed", exc_info=True)
        html = ""

    if not html:
        try:
            from scrapling.fetchers import Fetcher

            page = Fetcher.get(search_url, stealthy_headers=True)
            html = page.text or ""
        except Exception:
            log.warning("songkick: Scrapling search failed", exc_info=True)
            return events

    root = _selector_from_html(html)
    artist_href = _songkick_pick_best_artist(root, html, artist)
    if not artist_href:
        return events

    artist_url = f"https://www.songkick.com{artist_href}" if artist_href.startswith("/") else artist_href
    base = artist_url.rstrip("/")

    for suffix in ("/gigography", "/calendar"):
        for page in range(1, 12):
            page_url = f"{base}{suffix}" + (f"?page={page}" if page > 1 else "")
            try:
                r = httpx.get(page_url, headers=_BROWSER_HEADERS, follow_redirects=True, timeout=45.0)
                if r.status_code != 200:
                    break
                gig_root = _selector_from_html(r.text)
                rows = (
                    gig_root.css("li.event-listings-element")
                    or gig_root.css("li.event-listing-item")
                    or gig_root.css(".event-listings li")
                    or gig_root.css("article")
                    or gig_root.css("time[datetime]")
                    or []
                )
                if not rows:
                    if page == 1:
                        for m in re.finditer(
                            r'<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"[^>]*>[\s\S]{0,800}?'
                            r'href="(/[^"]*?(?:concerts|festivals)/[^"]+)"',
                            r.text,
                        ):
                            iso, href = m.group(1), m.group(2)
                            full_url = f"https://www.songkick.com{href}" if href.startswith("/") else href
                            events.append(_event_dict(iso, "", "", "", full_url, "songkick.com"))
                    break

                page_added = 0
                for row in rows[:120]:
                    link_el = row.css("a[href*='/concerts/'], a[href*='/festivals/']")
                    href = link_el[0].attrib.get("href", "") if link_el else ""
                    if not href:
                        continue

                    time_el = row.css("time") if hasattr(row, "css") else []
                    raw_date = ""
                    if time_el:
                        raw_date = time_el[0].attrib.get("datetime", "") or time_el[0].css("::text").get("").strip()
                    iso = _parse_date(raw_date) if raw_date else None

                    venue = _songkick_venue_from_row(row)
                    city_name, country_name = _songkick_city_country_from_row(row)
                    if not city_name:
                        loc_el = row.css("span[itemprop='addressLocality']")
                        if loc_el:
                            city_name = (loc_el[0].css("::text").get() or "").strip()

                    full_url = f"https://www.songkick.com{href}" if href.startswith("/") else href

                    if iso or city_name or venue:
                        events.append(_event_dict(iso, city_name, country_name, venue, full_url, "songkick.com"))
                        page_added += 1
                if page_added == 0:
                    break
            except Exception:
                log.warning("songkick: gigography page failed %s", page_url, exc_info=True)
                break

    return events


# --------------- deduplication ---------------

def _dedup_key(e: dict[str, Any]) -> str:
    return f"{e.get('date') or ''}|{(e.get('city') or '').lower()}|{(e.get('venue') or '').lower()[:40]}"


def deduplicate(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for e in events:
        key = _dedup_key(e)
        if key not in seen:
            seen[key] = e
        elif not seen[key].get("url") and e.get("url"):
            seen[key] = e
    return list(seen.values())


# --------------- public API ---------------

def fetch_all_concerts(artist: str) -> dict[str, Any]:
    all_events: list[dict[str, Any]] = []
    sources: list[str] = []
    errors: list[str] = []
    bandsintown_empty_no_app = False
    app_id_set = bool((os.environ.get("BANDSINTOWN_APP_ID") or "").strip())
    setlistfm_api_key_set = bool(_setlistfm_api_key())

    for name, fn in [
        ("setlist.fm", scrape_setlistfm),
        ("bandsintown.com", scrape_bandsintown),
        ("songkick.com", scrape_songkick),
    ]:
        try:
            evts = fn(artist)
            all_events.extend(evts)
            src_label = name
            if name == "setlist.fm":
                src_label = "setlist.fm (API)" if setlistfm_api_key_set else "setlist.fm (HTML)"
            sources.append(src_label)
            if not evts and name == "bandsintown.com" and not app_id_set:
                bandsintown_empty_no_app = True
        except Exception as exc:
            errors.append(f"{name}: {str(exc)[:200]}")

    if bandsintown_empty_no_app and len(all_events) == 0:
        errors.append(
            "bandsintown.com: немає подій через HTML; задайте BANDSINTOWN_APP_ID (REST API) у Variables на Railway — див. help.artists.bandsintown.com API."
        )

    if not setlistfm_api_key_set:
        errors.append(
            "setlist.fm: використано HTML-скрапер; для кращих результатів задайте SETLISTFM_API_KEY у Variables — https://api.setlist.fm"
        )

    deduped = deduplicate(all_events)

    today = date.today()
    past: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    for e in deduped:
        if e.get("date"):
            try:
                d = datetime.strptime(e["date"], "%Y-%m-%d").date()
                if d <= today:
                    past.append(e)
                else:
                    upcoming.append(e)
                continue
            except Exception:
                log.debug("concert row: skip invalid date %r", e.get("date"), exc_info=True)
        past.append(e)

    past.sort(key=lambda x: x.get("date") or "0000", reverse=True)
    upcoming.sort(key=lambda x: x.get("date") or "9999")

    return {
        "artist": artist,
        "past": past,
        "upcoming": upcoming,
        "sources_checked": sources,
        "errors": errors,
    }

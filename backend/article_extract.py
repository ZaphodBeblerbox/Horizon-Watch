import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from threading import Lock

import httpx

_CACHE_TTL_SECONDS = 24 * 3600
_MAX_CACHE_ENTRIES = 2000
_CACHE_PATH = Path(__file__).resolve().parent / "article_preview_cache.json"
_USER_AGENT = "AkiliDashboard/1.0 (article-preview)"

_CACHE_LOCK = Lock()
ARTICLE_PREVIEW_CACHE: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: str, max_len: int | None = None) -> str:
    text = re.sub(r"\s+", " ", (value or "")).strip()
    if max_len is not None and len(text) > max_len:
        return text[:max_len].rstrip() + "..."
    return text


class _HeadMetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta: dict[str, str] = {}
        self.title_text: str = ""
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        tag_l = (tag or "").lower()
        attrs_d = {str(k).lower(): str(v) for k, v in attrs if k and v}
        if tag_l == "meta":
            prop = attrs_d.get("property", "").lower()
            name = attrs_d.get("name", "").lower()
            content = attrs_d.get("content", "")
            if prop and content:
                self.meta[prop] = content
            if name and content:
                self.meta[name] = content
        elif tag_l == "title":
            self._in_title = True

    def handle_endtag(self, tag: str):
        if (tag or "").lower() == "title":
            self._in_title = False

    def handle_data(self, data: str):
        if self._in_title:
            self._title_parts.append(data)

    def close(self):
        super().close()
        self.title_text = _clean_text(" ".join(self._title_parts))


def extract_article_preview(url: str) -> dict:
    """
    Best-effort extraction from article HTML.
    Never raises; returns {} on failure.
    """
    target = (url or "").strip()
    if not target:
        return {}

    try:
        with httpx.Client(
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        ) as client_h:
            resp = client_h.get(target)
            resp.raise_for_status()
            html = resp.text or ""
    except Exception:
        return {}

    try:
        parser = _HeadMetaParser()
        parser.feed(html)
        parser.close()
        meta = parser.meta

        title = (
            meta.get("og:title")
            or parser.title_text
            or meta.get("twitter:title")
            or ""
        )
        description = (
            meta.get("og:description")
            or meta.get("description")
            or meta.get("twitter:description")
            or ""
        )
        site_name = meta.get("og:site_name", "")
        image = meta.get("og:image", "")

        preview = {
            "title": _clean_text(title),
            "description": _clean_text(description, max_len=300),
            "site_name": _clean_text(site_name),
            "image": _clean_text(image),
            "fetched_at": _now_iso(),
        }
        if not any([preview["title"], preview["description"], preview["site_name"], preview["image"]]):
            return {}
        return preview
    except Exception:
        return {}


def _load_cache() -> None:
    if not _CACHE_PATH.exists():
        return
    try:
        raw = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return
        now = time.time()
        with _CACHE_LOCK:
            ARTICLE_PREVIEW_CACHE.clear()
            for url, item in raw.items():
                if not isinstance(item, dict):
                    continue
                ts = float(item.get("ts", 0))
                if now - ts > _CACHE_TTL_SECONDS:
                    continue
                ARTICLE_PREVIEW_CACHE[url] = {
                    "ts": ts,
                    "preview": item.get("preview", {}) if isinstance(item.get("preview", {}), dict) else {},
                }
    except Exception:
        return


def _persist_cache() -> None:
    try:
        with _CACHE_LOCK:
            payload = ARTICLE_PREVIEW_CACHE.copy()
        _CACHE_PATH.write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        return


def get_article_preview(url: str) -> dict:
    """
    Cached preview getter.
    Returns {} on extraction failure.
    """
    target = (url or "").strip()
    if not target:
        return {}

    now = time.time()
    with _CACHE_LOCK:
        cached = ARTICLE_PREVIEW_CACHE.get(target)
        if cached:
            ts = float(cached.get("ts", 0))
            if now - ts <= _CACHE_TTL_SECONDS:
                return cached.get("preview", {}) if isinstance(cached.get("preview", {}), dict) else {}

    preview = extract_article_preview(target)
    with _CACHE_LOCK:
        ARTICLE_PREVIEW_CACHE[target] = {"ts": now, "preview": preview if isinstance(preview, dict) else {}}
        if len(ARTICLE_PREVIEW_CACHE) > _MAX_CACHE_ENTRIES:
            # Drop oldest entries.
            ordered = sorted(
                ARTICLE_PREVIEW_CACHE.items(),
                key=lambda kv: float((kv[1] or {}).get("ts", 0)),
            )
            to_drop = max(0, len(ordered) - _MAX_CACHE_ENTRIES)
            for key, _ in ordered[:to_drop]:
                ARTICLE_PREVIEW_CACHE.pop(key, None)
    _persist_cache()
    return preview if isinstance(preview, dict) else {}


_load_cache()

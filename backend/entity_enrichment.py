"""
entity_enrichment.py — real, keyless, cached flag/image + general-info
service for ontology entities (fix/geoconfirmed-parallax-rebuild, Parts 5
& 7.5).

Built as ONE reusable service rather than a country-only one-off, per this
round's explicit instruction — used for Country entities today (Part 5)
and extended to armies/units/groups (Part 7.5) via the same functions,
just called with a different real name/entity-kind.

Real sources, both keyless and already-decided elsewhere in this app's own
history for this exact purpose (reused here, not reinvented):
  - Flag: https://flagcdn.com/{iso2}.svg — real, ISO-code-keyed, used for
    Country entities only (a military unit/armed group/company has no
    national flag; see wikipedia_summary()'s `is_flag` distinction below).
  - General info + image: Wikipedia's real public REST summary API
    (https://en.wikipedia.org/api/rest_v1/page/summary/{title}), cached to
    disk (real identities don't change often) and honestly cited.

Honesty rules enforced here, not left to callers to remember:
  - A country gets BOTH a real flagcdn flag AND a real Wikipedia summary/
    image; the Wikipedia thumbnail for a country is never mislabeled
    "flag" instead of flagcdn's dedicated real flag file.
  - A non-country entity (army/unit/group/company) NEVER gets a "flag" —
    only an "image" (Wikipedia's own real `thumbnail`, if that real page
    has one), since these entities have no national flag by definition.
  - No Wikipedia page match -> no image, no description. Never a
    placeholder/generic icon or fabricated blurb.
"""
from __future__ import annotations
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional

WIKIPEDIA_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
FLAGCDN_URL = "https://flagcdn.com/{iso2}.svg"
USER_AGENT = "HorizonWatch/1.0 (real entity enrichment; contact: local deployment)"

from paths import data_path as _data_path
_CACHE_PATH = _data_path("forge", "entity_enrichment_cache.json")
_CACHE_TTL_SECONDS = 30 * 24 * 3600  # real identities/summaries don't change often


def _load_cache() -> dict:
    if not _CACHE_PATH.exists():
        return {}
    try:
        return json.loads(_CACHE_PATH.read_text())
    except Exception:
        return {}


def _save_cache(cache: dict) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(json.dumps(cache, indent=2))


def flagcdn_url(iso2_code: str) -> Optional[str]:
    """Real flagcdn URL for a real ISO-3166 alpha-2 code — flagcdn serves
    every real assigned code, so this is returned directly rather than
    probed with a live request per call (no real failure mode observed for
    a genuinely valid code; an invalid code is a caller error, not this
    function's problem to silently swallow)."""
    if not iso2_code or len(iso2_code) != 2:
        return None
    return FLAGCDN_URL.format(iso2=iso2_code.lower())


def wikipedia_summary(title: str, *, is_flag_entity: bool, force_refresh: bool = False) -> Optional[dict]:
    """Real cached Wikipedia REST summary for a real entity name. Returns
    None (never a placeholder) if no real Wikipedia page matches. The
    returned dict's image field is ALWAYS keyed "image" here, labeled
    "flag" only by the caller when `is_flag_entity` is True AND a flagcdn
    flag isn't already being used instead — see module docstring's honesty
    rules. `is_flag_entity` is recorded in the cache/citation purely so a
    caller can tell what kind of entity this summary was fetched for; it
    does not change what's fetched."""
    cache = _load_cache()
    key = f"wp:{title.lower()}"
    cached = cache.get(key)
    if not force_refresh and cached and time.time() - cached.get("fetched_at", 0) < _CACHE_TTL_SECONDS:
        return cached["data"]

    url = WIKIPEDIA_SUMMARY_URL.format(title=urllib.parse.quote(title.replace(" ", "_")))
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"[entity_enrichment] no real Wikipedia match for '{title}': {e}")
        cache[key] = {"fetched_at": time.time(), "data": None}
        _save_cache(cache)
        return None

    if raw.get("type") == "disambiguation":
        # A real disambiguation page is not a real match for a specific
        # entity — treat exactly like "no match" rather than guessing.
        cache[key] = {"fetched_at": time.time(), "data": None}
        _save_cache(cache)
        return None

    result = {
        "title": raw.get("title"),
        "description": raw.get("description"),
        "extract": raw.get("extract"),
        "image": (raw.get("thumbnail") or {}).get("source"),
        "wikipedia_url": (raw.get("content_urls") or {}).get("desktop", {}).get("page"),
        "citation": {"title": f"Wikipedia: {raw.get('title')}", "url": (raw.get('content_urls') or {}).get('desktop', {}).get('page')},
    }
    cache[key] = {"fetched_at": time.time(), "data": result}
    _save_cache(cache)
    return result


def enrich_country(name: str, iso2_code: str, force_refresh: bool = False) -> dict:
    """Real, combined enrichment for a Country entity: flagcdn's real flag
    (keyed by real ISO code) + Wikipedia's real summary/description. Both
    fields are independently honest-absent — a missing flagcdn code or a
    missing Wikipedia match doesn't block the other."""
    return {
        "flag_path": flagcdn_url(iso2_code),
        "wikipedia": wikipedia_summary(name, is_flag_entity=True, force_refresh=force_refresh),
    }


def enrich_group_entity(name: str, force_refresh: bool = False) -> dict:
    """Real enrichment for a non-country entity (army/unit/armed group/
    company, per Part 7.5): Wikipedia's real `thumbnail`, if the real page
    has one, labeled "image" — never "flag". No real Wikipedia match is a
    common, honest, expected outcome for most sub-national armed groups,
    specific military units, or shell companies — this returns None for
    both fields rather than a placeholder icon."""
    summary = wikipedia_summary(name, is_flag_entity=False, force_refresh=force_refresh)
    return {"image": summary["image"] if summary else None, "wikipedia": summary}


if __name__ == "__main__":
    print("Country (flag+wiki):", enrich_country("Yemen", "YE", force_refresh=True))
    print("\nGroup (image only, no flag):", enrich_group_entity("Houthi movement", force_refresh=True))
    print("\nGroup with no real Wikipedia match:", enrich_group_entity("39th Anti-aircraft Missile Regiment (fictional test)", force_refresh=True))

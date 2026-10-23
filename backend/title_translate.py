"""
title_translate.py — every headline someone reads is in English.

Seen 2026-10-23 on the phone's Home, "For you": "Fransa'da ohal! Tüm eylemler
yasaklandı" (Turkish) and "Midtvejsvalget i USA, urolighederne i Frankrig …"
(Danish), raw GDELT titles near a user's live asset, and "Missile launch at
Суми" from a live signal. Users must read every headline in English.

THE OWNER'S RULE: be smart, don't fire the model on everything. So:

  * Only what reaches someone is translated. The callers are the places a
    person reads a headline (the notification feed after the profile filter,
    the push sweep, the surface after the profile filter, Telegram posts in a
    user's profile); nothing walks the stores translating in bulk.
  * A cheap local test decides first (needs_translation): a word in another
    script, or a Latin headline that langdetect is sure about and that has no
    English words in it. English and doubtful titles cost nothing.
  * One translation per title, ever: answers are cached by the title's text
    in data/title_translations.json, so a restart or the next user re-pays
    nothing.
  * Titles are batched: a request never waits on the model. Unknown foreign
    titles are queued; one background thread sends them BATCH at a time
    (after a short pause so a page's worth arrives together), capped per day.
  * openai_gate purpose ENRICH ("giving a useless headline a usable one"),
    the cheap model the GDELT judge already uses for headlines.

THE RULE FALLBACK. While a title waits, or when the model is off or out of
budget, the original stays and the item says which language it is in
(title_lang_name), so the screen can mark it rather than pass it off as
English. The original is always kept beside a translation ({key}_original).
"""
from __future__ import annotations

import functools
import hashlib
import json
import os
import re
import threading
import time
import unicodedata

from paths import data_path as _data_path

BATCH = 20
COALESCE_S = 2.0              # let a page's worth of titles queue before a call
MAX_QUEUE = 400
MAX_CACHE = 20000
RETRY_AFTER_S = 30 * 60       # a title the model did not answer is not asked again at once
PER_DAY = int(os.getenv("TITLE_TRANSLATE_PER_DAY", "1500") or 1500)
ENABLED = (os.getenv("TITLE_TRANSLATE_ENABLED", "1") or "1").strip() not in ("0", "false", "no")

_PATH = str(_data_path("title_translations.json"))
_LOCK = threading.Lock()
_CACHE: dict | None = None
_QUEUE: dict[str, str] = {}               # key -> text, insertion-ordered
_RETRY: dict[str, float] = {}             # key -> not before
_RUNNING = threading.Event()
_DAY = {"day": "", "n": 0}
STATS = {"calls": 0, "translated": 0, "failed_calls": 0, "queued": 0, "skipped_cap": 0}

LANG_NAMES = {
    "ar": "Arabic", "bg": "Bulgarian", "ca": "Catalan", "cs": "Czech", "da": "Danish", "de": "German",
    "el": "Greek", "es": "Spanish", "et": "Estonian", "fa": "Persian", "fi": "Finnish", "fr": "French",
    "he": "Hebrew", "hi": "Hindi", "hr": "Croatian", "hu": "Hungarian", "hy": "Armenian", "id": "Indonesian",
    "it": "Italian", "ja": "Japanese", "ka": "Georgian", "ko": "Korean", "lt": "Lithuanian", "lv": "Latvian",
    "nl": "Dutch", "no": "Norwegian", "pl": "Polish", "pt": "Portuguese", "ro": "Romanian", "ru": "Russian",
    "sk": "Slovak", "sl": "Slovenian", "sq": "Albanian", "sr": "Serbian", "sv": "Swedish", "th": "Thai",
    "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu", "vi": "Vietnamese", "zh": "Chinese", "zh-cn": "Chinese",
    "zh-tw": "Chinese", "und": "another language", "az": "Azerbaijani", "kk": "Kazakh", "be": "Belarusian", "so": "Somali", "sw": "Swahili",
}
# by script, when there is no detector to name the language
_SCRIPT_LANG = {"CYRILLIC": "ru", "ARABIC": "ar", "HEBREW": "he", "GREEK": "el", "CJK": "zh", "HIRAGANA": "ja",
                "KATAKANA": "ja", "HANGUL": "ko", "THAI": "th", "DEVANAGARI": "hi", "GEORGIAN": "ka", "ARMENIAN": "hy"}

# Words that make a headline English. A foreign headline with a place name in
# it ("Manifestation à Paris") has none of these; an English one has two.
_EN = set("""
a an the of in on at to for from by with without into onto over under after before near amid against between
and or but not no is are was were be been being has have had will would can could may might must says said say
this that these those it its their his her our your who what where when why how which as than then there here
new more most first last two three four five six seven eight nine ten dozens hundreds thousands
attack attacks attacked strike strikes struck killed kills dead death deaths injured wounded hit hits fire fires
drone drones missile missiles rocket rockets shelling shell bomb bombing explosion explosions blast blasts
police officers troops army forces soldiers military navy militants rebels protest protesters protests march
rally riot riots clashes clash arrest arrests arrested detained raid raids launch launched launches seized ship
vessel tanker port border city town village region capital government minister president state emergency
war ceasefire talks court ban banned warns warning reported report reports says claims claimed near outside
""".split())
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(text or ""))).strip()


def _key(text: str) -> str:
    return hashlib.sha1(_norm(text).encode("utf-8")).hexdigest()[:24]


def lang_name(code: str | None) -> str | None:
    if not code:
        return None
    return LANG_NAMES.get(code.lower()) or code.upper()


def _script_of(ch: str) -> str:
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return "OTHER"
    if name.startswith("LATIN"):
        return "LATIN"
    first = name.split(" ")[0]
    return "CJK" if first in ("CJK",) else first


def _detect(text: str) -> tuple[str | None, float]:
    try:
        from langdetect import DetectorFactory, detect_langs
        DetectorFactory.seed = 0
        best = detect_langs(text)[0]
        return best.lang, float(best.prob)
    except Exception:                                          # noqa: BLE001 — no detector, or nothing to detect
        return None, 0.0


@functools.lru_cache(maxsize=20000)
def needs_translation(text: str) -> str | None:
    """The language code when this headline is not English, else None.
    Free and local; doubtful cases count as English (no model call)."""
    t = _norm(text)
    if len(t) < 8:
        return None
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return None
    foreign_script = [c for c in letters if _script_of(c) != "LATIN"]
    if len(foreign_script) >= 3:
        # "Missile launch at Суми": name the language from the foreign words
        # only (the whole line reads as French to langdetect)
        script = _script_of(foreign_script[0])
        lang, _p = _detect(" ".join(w for w in _WORD.findall(t) if _script_of(w[0]) == script))
        return lang if lang and lang != "en" and lang in LANG_NAMES else _SCRIPT_LANG.get(script, "und")
    words = [w.lower() for w in _WORD.findall(t)]
    if len(words) < 4:
        return None                                           # a name, a call sign, a place
    en = sum(1 for w in words if w in _EN)
    if en >= 2:
        return None
    lang, p = _detect(t)
    # one shared word ("in", "police") is allowed in a long foreign line
    if lang and lang != "en" and p >= 0.95 and (en == 0 or (en == 1 and len(words) >= 5)):
        return lang
    return None


# ── the cache ──────────────────────────────────────────────────────────

def _load() -> dict:
    global _CACHE
    if _CACHE is None:
        try:
            with open(_PATH, encoding="utf-8") as fh:
                _CACHE = json.load(fh)
            if not isinstance(_CACHE, dict):
                _CACHE = {}
        except (OSError, ValueError):
            _CACHE = {}
    return _CACHE


def _save() -> None:
    cache = _load()
    if len(cache) > MAX_CACHE:
        for k, _v in sorted(cache.items(), key=lambda kv: kv[1].get("at") or 0)[: len(cache) - MAX_CACHE]:
            cache.pop(k, None)
    tmp = _PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False)
    os.replace(tmp, _PATH)


def cached(text: str) -> dict | None:
    with _LOCK:
        return _load().get(_key(text))


# ── the model ──────────────────────────────────────────────────────────

SYSTEM = """You translate news headlines into English for a security monitoring app.
For each numbered headline, write it in natural English, as an English newspaper would.
- Keep every fact: who, what, where, numbers, and words of doubt ("reportedly", "claims").
- Do not add anything, do not explain, do not summarise.
- Place names in their usual English spelling (Суми -> Sumy, Fransa -> France).
- A headline already in English comes back unchanged.
Answer as JSON: {"results": [{"n": 1, "lang": "<ISO 639-1 code of the original>", "en": "<English headline>"}, ...]}"""


def translate_batch(texts: list[str]) -> list[dict | None]:
    """[text] -> [{"en", "lang"} | None] in order. One model call, or none."""
    import openai_gate
    out: list[dict | None] = [None] * len(texts)
    if not texts:
        return out
    client = openai_gate.get_client(openai_gate.ENRICH)
    if client is None:
        return out
    model = openai_gate.model_for(openai_gate.ENRICH)
    numbered = "\n".join(f"{i + 1}. {_norm(t)[:300]}" for i, t in enumerate(texts))
    STATS["calls"] += 1
    try:
        resp = client.chat.completions.create(
            model=model, temperature=0, max_tokens=80 * len(texts) + 50,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": numbered}])
        openai_gate.note_ok()
    except Exception as e:                                     # noqa: BLE001
        openai_gate.note_error(e)
        STATS["failed_calls"] += 1
        print(f"[title_translate] batch failed — {type(e).__name__}: {str(e)[:200]}", flush=True)
        return out
    usage = getattr(resp, "usage", None)
    if usage:
        try:
            import usage_tracker
            usage_tracker.record_call(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens,
                                      call_type="enrich", model=model, headline=f"translate {len(texts)} titles")
        except Exception:                                      # noqa: BLE001
            pass
    try:
        results = json.loads(resp.choices[0].message.content or "{}").get("results") or []
    except (ValueError, IndexError, AttributeError):
        print("[title_translate] unparseable answer", flush=True)
        return out
    for r in results:
        try:
            i = int(r.get("n")) - 1
        except (TypeError, ValueError, AttributeError):
            continue
        en = r.get("en")
        if 0 <= i < len(out) and isinstance(en, str) and en.strip() and len(en) <= 400:
            lang = r.get("lang") if isinstance(r.get("lang"), str) else None
            out[i] = {"en": _norm(en), "lang": (lang or "").lower()[:8] or None}
    return out


def _over_day_cap(n: int) -> bool:
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if _DAY["day"] != day:
        _DAY.update(day=day, n=0)
    return _DAY["n"] + n > PER_DAY


def _translate_now(pairs: list[tuple[str, str]], guessed: dict[str, str]) -> int:
    """Send these (key, text) pairs to the model in batches and cache the
    answers. Returns how many were translated."""
    done = 0
    for k in range(0, len(pairs), BATCH):
        chunk = pairs[k:k + BATCH]
        with _LOCK:
            if _over_day_cap(len(chunk)):
                STATS["skipped_cap"] += len(chunk)
                for key, _t in chunk:
                    _RETRY[key] = time.time() + RETRY_AFTER_S
                continue
            _DAY["n"] += len(chunk)
        answers = translate_batch([t for _, t in chunk])
        with _LOCK:
            cache = _load()
            for (key, text), a in zip(chunk, answers):
                if a is None:
                    _RETRY[key] = time.time() + RETRY_AFTER_S
                    continue
                lang = a["lang"] or guessed.get(key)
                same = a["en"].casefold() == _norm(text).casefold() or lang == "en"
                cache[key] = {"en": None if same else a["en"], "lang": "en" if same else lang, "at": int(time.time())}
                done += 0 if same else 1
            if any(a is not None for a in answers):
                try:
                    _save()
                except OSError as e:
                    print(f"[title_translate] cache not saved: {e}", flush=True)
    STATS["translated"] += done
    return done


def _drain() -> None:
    try:
        time.sleep(COALESCE_S)
        while True:
            with _LOCK:
                if not _QUEUE:
                    return
                keys = list(_QUEUE)[:BATCH * 5]
                pairs = [(k, _QUEUE.pop(k)) for k in keys]
            _translate_now(pairs, {k: needs_translation(t) or "" for k, t in pairs})
    except Exception as e:                                     # noqa: BLE001 — a failed pass never takes the feed with it
        print(f"[title_translate] drain failed: {type(e).__name__}: {e}", flush=True)
    finally:
        _RUNNING.clear()


def _enqueue(pairs: list[tuple[str, str]]) -> None:
    if not pairs:
        return
    with _LOCK:
        for key, text in pairs:
            if len(_QUEUE) >= MAX_QUEUE:
                break
            if key not in _QUEUE:
                _QUEUE[key] = text
                STATS["queued"] += 1
    if not _RUNNING.is_set():
        _RUNNING.set()
        threading.Thread(target=_drain, daemon=True, name="title-translate").start()


# ── the one entry point ────────────────────────────────────────────────

def apply(items: list[dict], keys: tuple[str, ...] = ("title",), wait: bool = False,
          enqueue: bool = True) -> list[dict]:
    """The items with their headlines in English, as new dicts where changed
    (the inputs may be shared cache rows). A cached translation is used at
    once; an unknown foreign headline is queued for the model (enqueue) or,
    with wait=True (a background caller such as the push sweep), translated
    before returning. Until then it keeps its text and is marked with its
    language: title_lang, title_lang_name, title_translated False."""
    if not ENABLED or not items:
        return items
    found: list[tuple[int, str, str, str, str]] = []           # (index, key-name, text, cache key, lang)
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        for name in keys:
            text = it.get(name)
            if isinstance(text, str) and text.strip():
                lang = needs_translation(text)
                if lang:
                    found.append((i, name, text, _key(text), lang))
    if not found:
        return items
    now = time.time()
    with _LOCK:
        cache = _load()
        todo = {ck: text for _i, _n, text, ck, _l in found
                if ck not in cache and _RETRY.get(ck, 0) <= now}
    if todo:
        if wait:
            _translate_now(list(todo.items()), {ck: lang for _i, _n, _t, ck, lang in found})
        elif enqueue:
            _enqueue(list(todo.items()))
    out = list(items)
    with _LOCK:
        cache = _load()
        for i, name, text, ck, lang in found:
            hit = cache.get(ck)
            row = out[i] if out[i] is not items[i] else dict(items[i])
            out[i] = row
            if hit and hit.get("lang") == "en":
                continue                                       # the model says it is English after all
            if hit and hit.get("en"):
                row[f"{name}_original"] = text
                row[name] = hit["en"]
                row["title_translated"] = True
                code = hit.get("lang") or lang
            else:
                row["title_translated"] = False
                code = lang
            row["title_lang"] = code
            row["title_lang_name"] = lang_name(code)
    return out


def status() -> dict:
    with _LOCK:
        return {**STATS, "cached": len(_load()), "queue": len(_QUEUE), "today": _DAY["n"], "per_day": PER_DAY,
                "enabled": ENABLED, "purpose": "enrich"}

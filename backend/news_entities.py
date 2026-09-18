"""
news_entities.py — turn reporting into edges in the entity graph.

WHAT THIS IS FOR. The graph now holds 37,936 Persons, 15,380 Organizations and
3,701 Vessels from OpenSanctions, and 6,066 news articles sit beside it
touching none of them: there are 79 `mention` links in the whole system. News
is how a static registry becomes a picture of what is happening — SOVCOMFLOT
is a node until an article says one of its tankers was detained, and then it
is an event with an actor.

HOW, AND WHY NOT NER FIRST. The obvious approach is named-entity recognition
over the headline, and it fails twice here. spaCy's en_core_web_sm is trained
on sentence-case prose, and a title-case headline makes every word look like a
proper noun — "Chad Blames Sudan's Army for Strikes on Convoy" comes back as a
single PERSON called "Chad Blames Sudan s". And it missed "Sovcomflot"
entirely.

But the deeper problem was that NER answers the wrong question. We are not
trying to DISCOVER these names; the graph already holds 102,409 of them,
Sovcomflot included. Matching known names against text is a gazetteer problem,
and a gazetteer has no casing trouble, no boundary trouble, and links with
certainty rather than inference.

So: a GAZETTEER pass links reporting to entities we already know, and NER runs
second, only to surface names the graph does NOT contain — candidates for
promotion, never auto-linked.

THE LIMIT, STATED. 5,900 of 6,066 articles have a usable title and only 178
have a summary. `body` is empty for every single row — the ingest does not
store article text. So this runs on HEADLINES, which are information-dense but
short: expect two or three entities per article, not the fifteen a body would
give. Storing bodies would multiply the yield of this module more than any
tuning of it.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time

from rapidfuzz import fuzz

_NLP = None

# spaCy labels worth keeping. PERSON/ORG/GPE/LOC/FAC/NORP are the ones that
# name actors and places; DATE, MONEY, CARDINAL and the rest are attributes of
# a story, not participants in it.
KEEP_LABELS = {"PERSON", "ORG", "GPE", "LOC", "FAC", "NORP", "EVENT"}

# Strings that are grammatically entities and analytically nothing.
_STOP = {
    "officials", "official", "authorities", "government", "the government",
    "police", "army", "military", "ministry", "state", "reuters", "ap", "afp",
    "bbc", "cnn", "the guardian", "bloomberg", "twitter", "x", "telegram",
    "eu", "un",   # too broad without qualification to be a useful link
}

_PUNCT = re.compile(r"[^\w\s\-&']", re.UNICODE)
_POSSESSIVE = re.compile(r"[\u2019']s\b", re.UNICODE)

# A vessel's name only means the vessel when the text is about shipping.
# Sanctioned hulls are genuinely called JUSTICE, TARGET, MARATHON and
# LEADERSHIP, so the match is textually right and the referent is wrong:
# "Company leadership may again send..." is not the tanker LEADERSHIP.
_MARITIME_CONTEXT = re.compile(
    r"\b(vessel|tanker|ship|shipping|cargo|freight|port|harbou?r|berth|"
    r"anchor|maritime|naval|navy|fleet|crew|voyage|convoy|sail|dock|"
    r"seized|detained|boarded|flagged|imo|mmsi|shadow fleet|oil transfer|"
    r"sts|bunker|draught|deadweight|strait|canal|offshore)\b", re.I)


def _nlp():
    global _NLP
    if _NLP is None:
        import spacy
        # Parser and lemmatiser are not needed for NER and cost most of the
        # runtime on 6,000 documents.
        _NLP = spacy.load("en_core_web_sm", disable=["parser", "lemmatizer", "tagger"])
    return _NLP


def normalise(text: str) -> str:
    # Strip possessives first: "Iran's" must not become the two-token name
    # "Iran s", which sailed straight through the multi-token gate.
    s = _POSSESSIVE.sub("", str(text or ""))
    s = _PUNCT.sub(" ", s).strip()
    return re.sub(r"\s+", " ", s)


def extract(text: str) -> list[dict]:
    """Named entities worth keeping from one piece of text."""
    if not text or len(text.strip()) < 12:
        return []
    doc = _nlp()(text)
    seen, out = set(), []
    for ent in doc.ents:
        if ent.label_ not in KEEP_LABELS:
            continue
        name = normalise(ent.text)
        low = name.lower()
        if len(name) < 3 or low in _STOP or low.isdigit():
            continue
        key = (low, ent.label_)
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": name, "label": ent.label_})
    return out


# ── linking extracted names into the FtM graph ───────────────────────────
# spaCy's labels and FtM's schemata are different vocabularies; this is the
# only place they are allowed to meet.
_LABEL_TO_SCHEMA = {
    "PERSON": ("Person",),
    "ORG": ("Organization", "Company", "LegalEntity", "PublicBody"),
    "NORP": ("Organization",),
    "FAC": ("Organization", "Company"),
}


# Names too generic to match on. A graph entity legitimately called "Diamond"
# or "Leo" would otherwise fire on every article using the word, and a single
# false link to a sanctioned entity is worse than a hundred missed true ones.
#
# THIS LIST IS A FLOOR, NOT THE MECHANISM. Hand-maintaining it is whack-a-mole:
# the first run produced "Across" as a Company, "LEADERSHIP" as a Vessel and
# "Israel" as a Person 109 times, because the graph really does contain
# entities with those names. The real gate is corpus frequency, below.
_TOO_GENERIC = {
    "diamond", "leo", "victory", "unity", "progress", "liberty", "atlantic",
    "pacific", "pioneer", "titan", "phoenix", "eagle", "falcon", "horizon",
    "mercury", "venus", "neptune", "orion", "vega", "sirius", "zeus", "apollo",
    "amber", "crystal", "harmony", "destiny", "spirit", "energy", "future",
    "star", "sun", "moon", "ocean", "sea", "river", "north", "south", "east",
    "west", "king", "queen", "prince", "captain", "general", "admiral",
    "gas", "oil", "shipping", "marine", "maritime", "group", "holding",
    "trading", "logistics", "international", "national", "global", "world",
}

MIN_GAZETTEER_LEN = 6   # characters; below this, a name is rarely distinctive

# A single-token name must be RARE in the reporting corpus to be usable. If a
# word turns up in many unrelated headlines it is a word, not an identifier —
# whatever the graph happens to call it. Multi-token names ("NATIONAL IRANIAN
# TANKER COMPANY") are specific by construction and skip this test.
COMMON_WORD_DOC_FREQ = 0.004     # appears in >0.4% of headlines


def corpus_common_words(conn: sqlite3.Connection, threshold: float = COMMON_WORD_DOC_FREQ) -> set[str]:
    """Words frequent enough in our own reporting to be meaningless as names.

    Derived from the corpus rather than hand-listed, so it adapts as coverage
    changes instead of needing a human to notice each new false positive.
    """
    import collections
    docs = 0
    df = collections.Counter()
    for (title,) in conn.execute("SELECT title FROM news_articles WHERE title IS NOT NULL"):
        docs += 1
        for w in set(normalise(title).upper().split()):
            if len(w) >= 3:
                df[w] += 1
    if not docs:
        return set()
    return {w for w, n in df.items() if n / docs >= threshold}


def gazetteer_usable(name: str, common: set[str] | None = None,
                     topics: list | None = None) -> bool:
    """Is this name specific enough to assert a link from?

    A SINGLE-WORD name additionally requires that the entity is one we
    actually care about — carrying a sanctions, PEP or crime topic. "Wagner"
    and "Sovcomflot" are both single words and both sanctioned, so the link is
    worth the risk; a vessel that happens to be called "Leadership" or
    "Justice" is not, and matching it against ordinary prose is how the first
    run produced "LEADERSHIP" as a Vessel out of "Company leadership may
    again send...". The payoff has to justify the exposure.
    """
    n = normalise(name).strip()
    if len(n) < MIN_GAZETTEER_LEN:
        return False
    low = n.lower()
    if low in _TOO_GENERIC:
        return False
    # NICKNAME ALIASES ARE NOT LINKING KEYS. OpenSanctions records aliases
    # like "the Nose", "The Youth" and "El Nino" — real, useful for a human
    # reading a profile, and indistinguishable from ordinary language in a
    # headline. They matched "the Nose Job of Tomorrow", "The youth film" and
    # a weather story about El Niño.
    if low.startswith(("the ", "a ", "an ")):
        return False
    tokens = n.upper().split()
    if len(tokens) == 1:
        # SINGLE-TOKEN NAMES ARE NOT MATCHED, and this was the hard-won part.
        #
        # Successive gates each removed one class of error and exposed the
        # next: corpus frequency killed "Israel" and "Across"; requiring a
        # sanctions topic killed some of the rest; requiring maritime context
        # killed the vessels. What survived was all single-token:
        #
        #   "Society"  <- "civil society"
        #   "League"   <- "Arab League", "Ligue 1"
        #   "Martin"   <- "Lockheed Martin", "Martin Hikel"
        #
        # These are irreducible on headline text. The graph legitimately
        # contains entities called Society, League and Martin; the string is
        # present; the referent is different. No amount of blocklisting fixes
        # a name that is genuinely both a company and a common noun.
        #
        # Multi-token names are specific by construction. Single-token
        # entities worth linking — Sovcomflot, Wagner — belong on a short
        # curated list where a human has accepted the risk by name, not
        # derived automatically from 102,409 of them.
        return False
    else:
        # A multi-token name made ENTIRELY of common words is still a phrase,
        # not an identifier — "UNITED NATIONS SUMMIT" should not link.
        if common is not None and all(t in common for t in tokens):
            return False
    return True


def find_known(text: str, index: dict) -> list[dict]:
    """Known graph entities named in this text, longest match first.

    Word-boundary matched and case-insensitive, so "Sovcomflot tanker
    detained" links and "the diamond trade" does not.
    """
    if not text:
        return []
    hay = " " + normalise(text).upper() + " "
    out, taken = [], []
    for key in index["sorted_keys"]:
        if key not in hay:
            continue
        pos = hay.find(key)
        # The key already carries its own boundary spaces (" SOVCOMFLOT "), so
        # finding it IS the word-boundary test. An extra check on the
        # characters either side reads the next word's first letter and
        # rejects every true match.
        if any(pos >= s and pos + len(key) <= e for s, e in taken):
            continue      # already covered by a longer match
        fid, schema, caption = index["by_name"][key][0]
        # A vessel name in a story with no maritime context is a coincidence.
        if schema == "Vessel" and not _MARITIME_CONTEXT.search(text):
            continue
        taken.append((pos, pos + len(key)))
        out.append({"name": caption or key, "matched": key.strip(),
                    "ftm_id": fid, "schema": schema,
                    "method": "gazetteer", "score": 0.95})
    return out


def build_name_index(conn: sqlite3.Connection) -> dict:
    """Every name in the graph, by schema, for matching against."""
    index: dict[str, list[tuple[str, str]]] = {}
    for fid, schema, names_json, caption in conn.execute(
            "SELECT id, schema, names_json, caption FROM ftm_things"
            " WHERE schema IN ('Person','Organization','Company','LegalEntity','PublicBody','Vessel')"):
        try:
            names = json.loads(names_json or "[]") or ([caption] if caption else [])
        except Exception:
            names = [caption] if caption else []
        for n in names:
            k = normalise(n).upper()
            if len(k) < 4:
                continue
            index.setdefault(k, []).append((fid, schema))
    return index


def build_gazetteer(conn: sqlite3.Connection) -> dict:
    common = corpus_common_words(conn)
    by_name: dict[str, list] = {}
    for fid, schema, names_json, caption, topics_json in conn.execute(
            "SELECT id, schema, names_json, caption, topics_json FROM ftm_things"
            " WHERE schema IN ('Person','Organization','Company','LegalEntity','PublicBody','Vessel')"):
        try:
            names = json.loads(names_json or "[]") or ([caption] if caption else [])
        except Exception:
            names = [caption] if caption else []
        try:
            topics = json.loads(topics_json or "[]")
        except Exception:
            topics = []
        for n in names:
            if not gazetteer_usable(n, common, topics):
                continue
            k = " " + normalise(n).upper() + " "
            by_name.setdefault(k, []).append((fid, schema, n))
    # longest first, so "NATIONAL IRANIAN TANKER COMPANY LLC" wins over
    # "NATIONAL IRANIAN TANKER COMPANY"
    return {"by_name": by_name, "common": common,
            "sorted_keys": sorted(by_name.keys(), key=len, reverse=True)}


def link(name: str, label: str, index: dict) -> dict | None:
    """Resolve one extracted name to a graph entity.

    Exact match only, and the SCHEMA MUST AGREE with the label. A PERSON
    matching an Organization's name is a coincidence, not a link — and this
    is the same discipline as vessel resolution: a wrong edge here puts a
    real person into a story they had nothing to do with.
    """
    key = normalise(name).upper()
    if len(key) < 4:
        return None
    allowed = _LABEL_TO_SCHEMA.get(label)
    for fid, schema in index.get(key, ()):
        if allowed and schema not in allowed:
            continue
        return {"ftm_id": fid, "schema": schema, "method": "name_exact", "score": 0.9}
    return None


def run(db_path: str, *, limit: int | None = None, since_id: int = 0) -> dict:
    """Extract entities from articles and write mention edges into the graph."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS news_mentions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            name       TEXT NOT NULL,
            label      TEXT NOT NULL,
            ftm_id     TEXT,
            method     TEXT,
            score      REAL,
            created_at REAL,
            UNIQUE(article_id, name, label)
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_news_mentions_ftm ON news_mentions(ftm_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_news_mentions_art ON news_mentions(article_id)")
    conn.commit()

    gaz = build_gazetteer(conn)
    sql = ("SELECT id, title, context_summary FROM news_articles"
           " WHERE id > ? ORDER BY id")
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql, (since_id,)).fetchall()

    stats = {"articles": 0, "entities": 0, "linked": 0, "unlinked": 0,
             "by_label": {}, "seconds": 0.0}
    t0 = time.time()
    now = time.time()
    for art_id, title, summary in rows:
        text = " ".join(x for x in (title, summary) if x)
        stats["articles"] += 1
        # Pass 1 — entities the graph already knows. High precision, no
        # inference: the name is in the text and the name is in the graph.
        for h in find_known(text, gaz):
            conn.execute(
                "INSERT OR IGNORE INTO news_mentions"
                " (article_id, name, label, ftm_id, method, score, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (art_id, h["name"], h["schema"], h["ftm_id"], h["method"], h["score"], now))
            stats["entities"] += 1
            stats["linked"] += 1
            stats["by_label"][h["schema"]] = stats["by_label"].get(h["schema"], 0) + 1
        if stats["articles"] % 1000 == 0:
            conn.commit()
    conn.commit()
    conn.close()
    stats["seconds"] = round(time.time() - t0, 1)
    return stats

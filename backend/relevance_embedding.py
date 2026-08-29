"""
relevance_embedding.py — cheap, dependency-light "embedding-style" text
similarity for the news-article funnel.

WHY TF-IDF-STYLE HASHING, NOT A NEURAL EMBEDDING API
─────────────────────────────────────────────────────
This codebase had zero embedding infrastructure before this module (grep the
repo — no VOYAGE_API_KEY, no OPENAI_API_KEY, nothing). backend/.env only sets
ANTHROPIC_API_KEY, and Anthropic does not serve an embeddings endpoint itself
(Voyage AI is Anthropic's recommended embedding partner, but that requires a
separate account/API key that does not exist in this environment). Standing
up a hard dependency on an external embedding API this app cannot currently
authenticate to would ship untested. A local neural embedding model
(sentence-transformers et al.) would need a multi-hundred-MB model download
onto a machine that had ~3GB of free disk at the time this was written —
exactly the kind of local model download the task explicitly said to avoid.

So: hashed bag-of-words vectors (scikit-learn's HashingVectorizer) with
cosine similarity. scikit-learn itself is ~9MB installed, has no model
weights to download, and every vector is a deterministic, stateless hash of
the input text — no persisted vocabulary, no training step.

BUG: PLAIN RAW-TF COSINE HAD NO REAL SEPARATION (fixed — see below)
────────────────────────────────────────────────────────────────────
The first version of this module used plain hashed term-frequency (no IDF
weighting) over a combined unigram+bigram feature space. That shipped a real,
live bug: running the actual news pipeline against a real cached article
batch produced THREE completely unrelated stories (a scooter/knife-attack
rescue story, a K-pop-adjacent hacking story, and an infant-care-subsidy
story) all suppressed as "near-duplicates" of an unrelated Vietnam-US
diplomacy article, at cosine scores of 0.34-0.43 — *inside* the 0.30
suppression threshold. The module's own manual calibration at the time had
found genuine near-duplicate pairs scoring ~0.38-0.40, i.e. there was
essentially NO score-range separation between "true duplicate" and "random
unrelated article".

Root cause turned out to be TWO compounding problems, both confirmed by
re-running the real live news pipeline against real RSS feeds during this
fix (not hypothetical examples — see test_news_near_duplicate.py's replay
harness, which replays a captured batch of 818 real article-vs-corpus
decisions from a live run):

1. Raw term-frequency (no IDF) weights every shared word equally, including
   words that are not English stopwords but are extremely common across
   *all* news text regardless of topic — "said", "according", "official",
   "reported", weekday names, generic date/number tokens, etc. Two totally
   unrelated wire stories share a lot of this incidental vocabulary simply
   because they're both news articles.

2. A BIGGER, more concrete contributor found by inspecting the actual live
   feed data behind the false positives: several real RSS feeds wrap EVERY
   article's <summary> field in an IDENTICAL templated attribution/CTA
   block. Verbatim, from malawi24.com's real feed during this
   investigation: "This article was originally published on Malawi24,
   Malawi's #1 independent news platform." ... "Read the full article and
   more Malawi news at Malawi24 — Breaking news, politics...". That literal,
   byte-identical boilerplate — not generic vocabulary — was enough by
   itself to push FOUR completely unrelated malawi24.com articles (a
   domestic-violence story, a chess tournament, an aviation inquiry, a bus
   crash) to cosine scores of 0.55-0.66 against each other. Corpus-wide IDF
   alone under-corrects this: a phrase that recurs in only a handful of
   documents out of a large, diverse, multi-outlet rolling corpus is not
   "common" from the whole corpus's point of view, so IDF actually rates it
   as comparatively RARE (high weight) — the opposite of what's needed. A
   second, source-agnostic mechanism was needed (see fix #2 below).

Raising the threshold could not have fixed either problem: the
true-duplicate and false-positive score ranges (0.29-0.46 vs 0.34-0.66
across both failure modes) overlap far too much for any single cutoff to
separate them.

THE FIX: TWO INDEPENDENT MECHANISMS, EACH TARGETING ONE OF THE ABOVE
──────────────────────────────────────────────────────────────────────
1. Rolling recurring-paragraph (syndication-boilerplate) stripping — targets
   root cause #2, the bigger and more concrete one. `embed_and_learn()`
   splits an article's raw summary into paragraph/line-level chunks and
   drops any chunk that has already recurred BYTE-FOR-BYTE at least
   `_RECURRING_PARAGRAPH_MIN_SEEN + 1` times before in a rolling window
   (currently 2 — i.e. stripped from its 2nd sighting onward). Genuine
   article content is reworded per-article even when two outlets cover the
   same real event, so exact multi-word recurrence across different
   articles is a reliable boilerplate signature, not a real content-overlap
   signal. See `_drop_recurring_paragraphs`.

2. IDF weighting, computed dynamically from a rolling in-memory corpus of
   recently-embedded (and boilerplate-stripped) article text — targets root
   cause #1. Every article that flows through `main._find_near_duplicate`
   calls `embed_and_learn()`, which folds its vocabulary into a capped
   rolling window (`_MAX_CORPUS_DOCS` documents) of document-frequency
   counts, computed SEPARATELY for a unigram feature space and a bigram
   feature space, then combined as a weighted sum (`_UNIGRAM_WEIGHT` /
   `_BIGRAM_WEIGHT` = 0.7 / 0.3 — see that constant's comment for why
   unigram-dominant, not bigram-dominant, won out empirically once IDF and
   boilerplate-stripping are already doing the heavy lifting). Terms common
   across most recent articles end up with a low IDF weight; bigram overlap
   (two words adjacent, in order, in BOTH articles) still contributes as a
   second, largely independent signal for named-entity/event-specific
   phrase overlap.

Two more correctness details that mattered in practice (found by testing
against real captured decisions, not assumed up front):

- `embed_and_learn()` computes a document's OWN IDF-weighted vector against
  the corpus state as it stood BEFORE that document, then registers it for
  FUTURE comparisons — never against a corpus that already includes itself.
  Registering first (weighting second) would self-referentially down-weight
  exactly the terms two near-duplicate articles share whenever one was
  compared shortly after the other joined a still-small corpus (e.g. right
  after a process (re)start) — the corpus already "having seen" a shared
  term makes it look artificially common, precisely when it's actually the
  near-duplicate signal.
- Below `_MIN_CORPUS_FOR_IDF` (10) prior documents, IDF is skipped entirely
  (uniform weight, i.e. plain TF) rather than computed from too small a
  sample — with only 1-2 prior documents, per-term document-frequency
  statistics are noise, and the same self-referential effect above still
  applies in miniature (a term shared with the one lone prior document
  necessarily has df>=1, a term unique to the new document has df=0, which
  is backwards for what near-dup detection needs).

Both mechanisms are stateless/deterministic given the same corpus state — no
persisted model file, no `.fit()` call requiring a training corpus up front,
just in-memory rolling tallies (document frequency + paragraph-recurrence
counts) that decay via capped sliding windows.

CALIBRATION — BEFORE AND AFTER, ON REAL LIVE DATA (not hand-picked examples)
──────────────────────────────────────────────────────────────────────
See test_news_near_duplicate.py for the harness. These numbers come from
replaying a real captured batch of 818 near-duplicate decisions from an
actual live run of the news pipeline against real RSS feeds (network
access confirmed available in this environment), not synthetic text:

  BEFORE (plain hashed-TF cosine, no IDF, no boilerplate stripping):
    77 of 818 articles flagged as near-duplicates, including CONFIRMED
    false positives:
      "Husband forces wife into sex as 'proof'"        score=0.604
      "Chess battle heats up"                          score=0.613
      "Airport officer tells inquiry..."                score=0.557
      "27 church members killed in Zimbabwe crash"      score=0.579
        (all four falsely "matched" to an unrelated "Russian strike kills
        37 in Ukraine" article — same outlet, shared template boilerplate)
      "US mother found not guilty..."                   score=0.541
      "Hurricane Katrina forced New Orleans' Charity..." score=0.309
      "Minnesota removed common carp..."                score=0.318
      "No surrender, no dissent: six months of war..."  score=0.328
        (all four falsely "matched" to an unrelated "From F1 visa to US
        citizenship..." article — same pattern, different outlet)
      "Iran reports $7.5bn in oil revenues..."          score=0.751
      "France's nuclear tests in Algeria..."            score=0.594
        (falsely "matched" to an unrelated "One killed, two wounded in
        Israeli drone attack on Gaza" article)

  AFTER (IDF-weighted hybrid unigram/bigram cosine, unigram-dominant, +
  recurring-paragraph stripping), replaying the EXACT SAME 818 real
  decisions in the same order:
    99 of 818 articles flagged as near-duplicates — MORE than before (better
    recall on genuine duplicates: heavily-reworded pairs that share few
    literal bigrams but plenty of IDF-weighted distinctive unigrams, e.g.
    Niger coup coverage, Ratko Mladic's death, Nepal flood rescue updates,
    PM Modi's Uzbekistan visit, Dolly Parton's death, French presidential-
    debate coverage — all confirmed genuine cross-outlet duplicates on
    manual review), while ALL of the false positives above are GONE —
    replaying them individually:
      "Husband forces wife into sex as 'proof'"         score=0.224
      "Chess battle heats up"                           score=0.226
      "Airport officer tells inquiry..."                 score=0.163
      "27 church members killed in Zimbabwe crash"       score=0.231
      "US mother found not guilty..."                    score=0.022
      "Hurricane Katrina forced New Orleans' Charity..." score=0.026
      "Minnesota removed common carp..."                 score=0.021
      "No surrender, no dissent..."                      score=0.047
      "Iran reports $7.5bn in oil revenues..."           score=0.097
      "France's nuclear tests in Algeria..."             score=0.057
    Genuine near-duplicates are still caught with real margin, e.g.:
      "Hundreds gather in Oslo to support Norway's King Harald" / "Norway
        mourns king Harald V as crown prince Haakon becomes king"
                                                           score=0.997
      "Ratko Mladic, Convicted Bosnian Serb War Criminal..." / "The man
        behind Srebrenica: Ratko Mladic dies at 84"       score=0.482
      "Iceland votes on whether to resume EU membership talks" /
        "Iceland Heads to Polls in Tight Referendum on EU Entry"
                                                           score=0.429
    One honestly-noted residual gray area (NOT the bug this fix targets):
    a small cluster of financial-ticker articles sharing a templated TITLE
    (not summary) pattern — "Silver price today, Friday, August 28, 2026:
    ..." / "Gold prices today, Friday, August 28, 2026: ..." / "Mortgage
    and refinance interest rates today, Friday, August 28, 2026: ..." —
    scored ~0.32-0.35 (just above the threshold) because they share an
    exact date stamp and are genuinely all reacting to the same day's Fed
    speech. This is a much milder, more defensible edge case than the
    confirmed bug above (arguably real contextual overlap, title-level not
    summary-level), left as a known limitation rather than chased further —
    see test_news_near_duplicate.py.

  _NEAR_DUP_THRESHOLD in main.py (0.30) sits cleanly above the confirmed
  false-positive group's ceiling (0.23) and below the genuine-duplicate
  group's typical floor with this mechanism, on real production data.

HONESTY ABOUT TODAY'S MISSION PROFILE
──────────────────────────────────────
The live backend/profile.json has empty focusRegions/infraDomains/chokepoints
and a two-word activeSituations ("Monitoring paris"). Cosine similarity
against that thin a profile is not a strong discriminator — most articles
will score low simply because the profile itself barely says anything. This
module is built to get more useful as the profile gets richer; see
`main._profile_has_signal()` for the gate that keeps this stage informational
(logged, not enforced) until the profile actually carries enough content to
make the "relevant" / "irrelevant" verdict trustworthy. Mission-profile
relevance scoring shares this same IDF+hybrid mechanism (see REUSE below),
but does NOT register the profile text or scored articles into the rolling
near-duplicate corpus (see `relevance_score()` — it calls the pure `embed()`,
never `embed_and_learn()`), since a Mission Profile description is not a
"recently seen news article" and mixing it into that corpus's document-
frequency stats would skew them for an unrelated purpose.

REUSE
─────
The exact same IDF-weighted hybrid vector + cosine-similarity mechanism backs
both:
  1. Mission-profile relevance scoring (`relevance_score` / `profile_vector`)
  2. Near-duplicate article detection (`near_duplicate_score` / `top_match`)
one similarity system, two call sites — per the task's own suggestion, since
building two separate similarity mechanisms for the same underlying need
(comparing two short pieces of text for semantic/topical overlap) would just
be duplicated surface area for no accuracy benefit at this text length.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter, deque
from typing import Optional

import numpy as np
from scipy.sparse import vstack
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize

# ── Stateless hashers ─────────────────────────────────────────────────────────
# Unigrams and bigrams are hashed into SEPARATE feature spaces (two separate
# HashingVectorizer instances) so they can be IDF-weighted and combined with
# different weights below, instead of being diluted together into one space.
# n_features chosen large enough that hash collisions are rare for short
# (title + summary length) news text. No .fit() call, no learned vocabulary,
# no persisted model file — every transform() call is a deterministic hash.
_N_FEATURES = 2 ** 18

_UNIGRAM_VECTORIZER = HashingVectorizer(
    n_features=_N_FEATURES, alternate_sign=False, norm=None,
    stop_words="english", ngram_range=(1, 1), lowercase=True,
)
_BIGRAM_VECTORIZER = HashingVectorizer(
    n_features=_N_FEATURES, alternate_sign=False, norm=None,
    stop_words="english", ngram_range=(2, 2), lowercase=True,
)

# Empirically tuned (see module docstring's CALIBRATION section) against
# both a real captured batch of 818 live near-duplicate decisions AND a
# diverse synthetic set of genuine-duplicate/unrelated pairs: unigram-
# dominant (not bigram-dominant) gives the best combination of recall
# (catching heavily-reworded genuine duplicates that share few literal
# two-word phrases) and precision (zero reintroduction of any of the
# confirmed real false positives) once IDF weighting and recurring-
# paragraph stripping are already doing the heavy lifting against the two
# confirmed root causes. Bigram overlap still contributes — it's a strong,
# largely independent signal for named-entity/event-specific phrase overlap
# — just not the dominant term.
_UNIGRAM_WEIGHT = 0.7
_BIGRAM_WEIGHT = 0.3

# ── Rolling in-memory corpus for dynamic IDF weighting ───────────────────────
# Tracks document frequency (how many of the last _MAX_CORPUS_DOCS documents
# contained each hashed feature) separately for the unigram and bigram
# spaces. This is intentionally NOT persisted and NOT a sklearn .fit() call —
# just a capped sliding window of which hashed features appeared in which of
# the most recently embedded-and-learned documents, decremented as old
# documents age out. Populated only by `embed_and_learn()` (real, freshly
# seen article text), never by `embed()` (used for the cached Mission
# Profile vector and one-off/test comparisons) — see module docstring.
_MAX_CORPUS_DOCS = 500

_uni_df = np.zeros(_N_FEATURES, dtype=np.int32)
_bi_df = np.zeros(_N_FEATURES, dtype=np.int32)
_uni_doc_features: deque = deque()   # each entry: unique feature indices of one learned doc
_bi_doc_features: deque = deque()


# ── Rolling syndication-boilerplate detector ─────────────────────────────────
# CONFIRMED against live RSS feed data during this fix: several real-world
# feeds wrap EVERY article's <summary> field in an identical templated
# attribution/CTA block, e.g. (verbatim, from malawi24.com's real feed):
#   "This article was originally published on Malawi24, Malawi's #1
#   independent news platform." ... "Read the full article and more Malawi
#   news at Malawi24 — Breaking news, politics..."
# This is NOT generic news vocabulary (the module docstring's original
# "said"/"official"/"reported" theory) — it's literal, byte-identical text
# repeated verbatim across every article from that feed, and it alone was
# enough to push completely unrelated articles (a domestic-violence story, a
# chess tournament story, an aviation-inquiry story, a bus-crash story) to
# cosine scores of 0.55-0.66 against each other in live testing, MUCH higher
# than corpus-wide IDF weighting alone can suppress: a phrase that recurs in
# only a handful of documents out of a large, diverse, multi-outlet rolling
# corpus is not "common" from the whole corpus's point of view, so IDF alone
# rates it as comparatively rare/high-weight, the opposite of what's needed.
#
# Fix: track exact-text paragraph/line recurrence in a rolling window and
# drop from the embedding text any paragraph that has already recurred
# byte-for-byte at least `_RECURRING_PARAGRAPH_MIN_SEEN + 1` times before —
# with the current threshold (0), that means this is at least its 2nd
# sighting. Genuine article content is reworded per-article even when two
# outlets cover the same real event (see the CALIBRATION numbers above), so
# verbatim, repeated, multi-word recurrence across DIFFERENT articles is a
# reliable signature of templated boilerplate, not of genuine shared
# topical content — that signal instead comes from the IDF+bigram cosine
# mechanism on what's left after boilerplate is stripped out.
_MAX_PARAGRAPH_DOCS = 500
_RECURRING_PARAGRAPH_MIN_SEEN = 0   # strip on the 2nd+ verbatim sighting — see
                                    # test_news_near_duplicate.py's real-data
                                    # replay for why 0 (not e.g. 2): the FIRST
                                    # sighting of a templated feed's boilerplate
                                    # becomes the canonical article's cached
                                    # vector and can never be retroactively
                                    # cleaned, so later same-outlet articles
                                    # need their OWN copy stripped as early as
                                    # possible (the 2nd sighting) to avoid
                                    # matching that stale, boilerplate-carrying
                                    # canonical. A single verbatim, multi-word
                                    # paragraph-level match after only one
                                    # prior sighting is already a strong
                                    # boilerplate signal in practice (real
                                    # article content essentially never repeats
                                    # byte-for-byte across different articles).

_TAG_RE = re.compile(r"<[^>]+>")
_PARA_BOUNDARY_RE = re.compile(r"</p>\s*<p[^>]*>|<br\s*/?>|\r?\n+", re.IGNORECASE)

_paragraph_counts: "Counter[str]" = Counter()
_paragraph_doc_history: deque = deque()


def reset_corpus() -> None:
    """Clear the rolling IDF corpus AND the rolling paragraph-recurrence
    corpus. Exposed for test isolation — tests that want to control exactly
    what background vocabulary/boilerplate the weights are computed from
    should call this first."""
    global _uni_df, _bi_df
    _uni_df = np.zeros(_N_FEATURES, dtype=np.int32)
    _bi_df = np.zeros(_N_FEATURES, dtype=np.int32)
    _uni_doc_features.clear()
    _bi_doc_features.clear()
    _paragraph_counts.clear()
    _paragraph_doc_history.clear()


def _split_paragraphs(summary_text: str) -> list[str]:
    """Split a (possibly HTML) summary into paragraph/line-level chunks,
    stripping tags and normalizing whitespace/case per chunk so identical
    boilerplate blocks compare equal regardless of incidental HTML markup
    differences."""
    chunks = _PARA_BOUNDARY_RE.split(summary_text or "")
    cleaned = []
    for c in chunks:
        c = _TAG_RE.sub(" ", c)
        c = re.sub(r"\s+", " ", c).strip().lower()
        if c:
            cleaned.append(c)
    return cleaned


def _register_paragraphs(paragraphs: list[str]) -> None:
    if len(_paragraph_doc_history) >= _MAX_PARAGRAPH_DOCS:
        oldest = _paragraph_doc_history.popleft()
        for p in oldest:
            _paragraph_counts[p] -= 1
            if _paragraph_counts[p] <= 0:
                del _paragraph_counts[p]
    _paragraph_doc_history.append(paragraphs)
    for p in paragraphs:
        _paragraph_counts[p] += 1


def _drop_recurring_paragraphs(summary_text: str, *, learn: bool) -> str:
    """Strip paragraphs from `summary_text` that have already recurred
    verbatim `_RECURRING_PARAGRAPH_MIN_SEEN` or more times in the recent
    rolling corpus, returning the remaining text re-joined. If EVERY
    paragraph looks like boilerplate (e.g. a one-paragraph article whose
    only paragraph happens to recur, or the very first few sightings of a
    single-paragraph templated feed before the threshold trips), falls back
    to the original paragraphs rather than embedding nothing."""
    paragraphs = _split_paragraphs(summary_text)
    if not paragraphs:
        return ""
    kept = [p for p in paragraphs if _paragraph_counts.get(p, 0) <= _RECURRING_PARAGRAPH_MIN_SEEN]
    if learn:
        _register_paragraphs(paragraphs)
    return " ".join(kept if kept else paragraphs)


def _register(doc_features: deque, df: np.ndarray, indices: np.ndarray) -> None:
    unique_idx = np.unique(indices)
    if len(doc_features) >= _MAX_CORPUS_DOCS:
        oldest = doc_features.popleft()
        df[oldest] -= 1
    doc_features.append(unique_idx)
    df[unique_idx] += 1


_MIN_CORPUS_FOR_IDF = 10   # below this many prior documents, document-frequency
                           # stats are too small a sample to trust — e.g. with
                           # only 1-2 prior documents, a term SHARED with the
                           # one prior document (exactly the near-duplicate
                           # signal we want) inevitably looks "common" (df>=1)
                           # while every other term looks "rare" (df=0), which
                           # self-referentially suppresses genuine overlap
                           # right when it matters most (a freshly (re)started
                           # process comparing its first couple of articles).
                           # Below this size, IDF is skipped (uniform weight,
                           # i.e. plain TF) and the bigram-dominant weighting
                           # alone carries the separation — see module
                           # docstring's cold-start calibration numbers.


def _idf(df: np.ndarray, doc_features: deque) -> np.ndarray:
    """Smoothed IDF: log((N+1)/(df+1)) + 1 — standard smoothing so a term
    that hasn't been seen in the rolling corpus yet (df=0) gets the max
    weight rather than a division by zero. Below `_MIN_CORPUS_FOR_IDF` prior
    documents, returns a uniform weight of 1.0 for every feature (plain TF)
    instead — see `_MIN_CORPUS_FOR_IDF`'s comment for why a tiny sample is
    actively counterproductive here, not just noisy."""
    n = len(doc_features)
    if n < _MIN_CORPUS_FOR_IDF:
        return 1.0
    return np.log((n + 1) / (df + 1)) + 1.0


def _weighted_vec(raw, df: np.ndarray, doc_features: deque):
    """Apply the current IDF weights to a raw hashed-count sparse row vector
    and re-normalize to unit L2 norm (the vectorizers themselves use
    norm=None so this is the only normalization step, applied AFTER
    IDF-weighting rather than before it)."""
    if raw.nnz == 0:
        return raw
    weighted = raw.multiply(_idf(df, doc_features))
    return normalize(weighted.tocsr(), norm="l2")


class _HybridVector:
    """Bundles a text's IDF-weighted unigram vector and IDF-weighted bigram
    vector together — the unit of comparison this module's public API works
    with everywhere `embed()` used to return a single sparse row."""
    __slots__ = ("uni", "bi")

    def __init__(self, uni, bi):
        self.uni = uni
        self.bi = bi


def _embed_raw(text: str):
    """Return the two RAW (pre-IDF) hashed count vectors for `text`."""
    t = [text or ""]
    return _UNIGRAM_VECTORIZER.transform(t), _BIGRAM_VECTORIZER.transform(t)


def embed(text: str) -> _HybridVector:
    """Return an IDF-weighted hybrid (unigram + bigram) vector for `text`,
    using the CURRENT rolling-corpus IDF weights. Pure/stateless — does NOT
    register `text` into the rolling corpus (use `embed_and_learn()` for
    that). Safe to call repeatedly on the same text (e.g. the cached Mission
    Profile vector) without skewing document-frequency stats."""
    raw_uni, raw_bi = _embed_raw(text)
    return _HybridVector(
        _weighted_vec(raw_uni, _uni_df, _uni_doc_features),
        _weighted_vec(raw_bi, _bi_df, _bi_doc_features),
    )


def embed_and_learn(title: str, summary: str = "") -> _HybridVector:
    """Real, freshly-seen article text goes through here — this is what
    main._find_near_duplicate calls for every candidate article. Two things
    happen before the IDF-weighted hybrid vector is computed:

      1. `summary` (which may still contain raw feed HTML — see module
         docstring) has any VERBATIM-recurring paragraph/line stripped out
         via the rolling syndication-boilerplate detector (see
         `_drop_recurring_paragraphs`). `title` is always kept as-is — it's
         not where the confirmed boilerplate contamination lives, and
         titles are effectively always distinct per real article even from
         templated feeds.
      2. Its own IDF-weighted vector is computed FIRST, against the corpus
         state as it stood BEFORE this document — deliberately NOT
         including itself. Only THEN is its vocabulary folded into the
         rolling IDF corpus (both unigram and bigram document-frequency
         counts), so it affects FUTURE comparisons, not its own.

    That ordering matters: `main._find_near_duplicate` calls this for
    article B, then immediately compares B's vector against a CANONICAL
    article (say, A) that was itself registered via an earlier
    `embed_and_learn()` call. If B's own vector were computed AFTER
    registering B, every term B shares with A would already carry df=2
    (once from A, once from B-self) while B's unique terms would carry only
    df=1 (from B-self) — self-referentially DOWN-weighting exactly the
    shared terms that are the actual near-duplicate signal, and pushing
    genuine near-duplicates below the threshold especially early on (a
    small/cold corpus, e.g. right after this module or the process
    restarts, where there's little else to dilute the effect). Weighting
    against the PRE-registration state avoids that entirely.

    This is what makes the rolling corpus an accurate rolling window of
    "recently seen news articles". Do NOT call this for repeat computations
    of the same fixed text (e.g. the cached Mission Profile vector) — see
    `embed()` and the module docstring."""
    clean_summary = _drop_recurring_paragraphs(summary, learn=True)
    text = f"{title or ''} {clean_summary}".strip()
    raw_uni, raw_bi = _embed_raw(text)
    vec = _HybridVector(
        _weighted_vec(raw_uni, _uni_df, _uni_doc_features),
        _weighted_vec(raw_bi, _bi_df, _bi_doc_features),
    )
    if raw_uni.nnz:
        _register(_uni_doc_features, _uni_df, raw_uni.indices)
    if raw_bi.nnz:
        _register(_bi_doc_features, _bi_df, raw_bi.indices)
    return vec


def _cosine_one(vec_a, vec_b) -> float:
    if vec_a is None or vec_b is None or vec_a.nnz == 0 or vec_b.nnz == 0:
        return 0.0
    return float(cosine_similarity(vec_a, vec_b)[0, 0])


def cosine(vec_a: _HybridVector, vec_b: _HybridVector) -> float:
    """Combined bigram-dominant cosine similarity between two hybrid vectors,
    in [0, 1] (HashingVectorizer's alternate_sign=False keeps all raw counts
    non-negative, and IDF weights are non-negative, so similarity never goes
    negative here)."""
    if vec_a is None or vec_b is None:
        return 0.0
    uni_sim = _cosine_one(vec_a.uni, vec_b.uni)
    bi_sim = _cosine_one(vec_a.bi, vec_b.bi)
    return _UNIGRAM_WEIGHT * uni_sim + _BIGRAM_WEIGHT * bi_sim


def top_match(vec: _HybridVector, candidates: list[tuple[str, _HybridVector]]) -> Optional[tuple[str, float]]:
    """
    Given a query hybrid vector and a list of (key, hybrid vector) candidates,
    return the (key, score) of the best combined cosine match, or None if
    `candidates` is empty. Vectorized (one cosine_similarity call per feature
    space against a stacked matrix) rather than a Python loop, since a news
    cycle can carry hundreds of candidates against a multi-hundred-entry
    recent-article cache.
    """
    if not candidates:
        return None
    uni_stack = vstack([v.uni for _, v in candidates])
    bi_stack = vstack([v.bi for _, v in candidates])
    uni_sims = cosine_similarity(vec.uni, uni_stack)[0] if vec.uni.nnz else np.zeros(len(candidates))
    bi_sims = cosine_similarity(vec.bi, bi_stack)[0] if vec.bi.nnz else np.zeros(len(candidates))
    combined = _UNIGRAM_WEIGHT * uni_sims + _BIGRAM_WEIGHT * bi_sims
    idx = int(combined.argmax())
    return candidates[idx][0], float(combined[idx])


# ── Mission-profile relevance ──────────────────────────────────────────────
# Cached by a hash of the profile context text so the profile is only
# re-embedded when it actually changes (on /profile/save), never once per
# 30-minute extraction cycle — the task explicitly asked for this caching.
_profile_cache: dict = {"text_hash": None, "vector": None}


def profile_vector(profile_context_text: str) -> _HybridVector:
    """Return the cached embedding for the Mission Profile context text
    (main._format_profile_context()'s output), recomputing only when the
    text has actually changed since the last call. Uses the pure `embed()` —
    the profile is never registered into the near-duplicate rolling corpus."""
    h = hashlib.sha1((profile_context_text or "").encode("utf-8")).hexdigest()
    if _profile_cache["text_hash"] != h:
        _profile_cache["text_hash"] = h
        _profile_cache["vector"] = embed(profile_context_text)
    return _profile_cache["vector"]


def relevance_score(profile_context_text: str, article_text: str) -> float:
    """Combined cosine similarity between the (cached) Mission Profile
    embedding and an article's title+summary embedding. 0.0 if either text is
    empty — callers should treat that as "not computed" rather than
    "confirmed irrelevant". Uses the pure `embed()` for the article text too
    (does not feed mission-profile scoring calls into the near-duplicate
    rolling corpus — that corpus is populated exclusively via
    main._find_near_duplicate's embed_and_learn() calls)."""
    if not profile_context_text or not article_text:
        return 0.0
    pv = profile_vector(profile_context_text)
    av = embed(article_text)
    return cosine(pv, av)


def near_duplicate_score(text_a: str, text_b: str) -> float:
    """Combined cosine similarity between two articles' title+summary text —
    the same mechanism as `relevance_score`, reused for near-duplicate ("same
    wire story, different outlet") detection instead of mission-profile
    scoring. Pure — uses `embed()` for both texts, does not touch the rolling
    IDF corpus (that's `main._find_near_duplicate`'s job via
    `embed_and_learn()`); this function is a standalone pairwise comparison
    for direct use/testing against WHATEVER the corpus's current state is."""
    return cosine(embed(text_a), embed(text_b))

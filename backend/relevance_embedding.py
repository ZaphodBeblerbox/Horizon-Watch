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

So: TF-hashed bag-of-words vectors (scikit-learn's HashingVectorizer) with
cosine similarity. This is a real, working "cheap vector-space relevance
scoring" technique — not a neural embedding, but a legitimate fallback the
task spec explicitly sanctions when no practical embedding API is available.
scikit-learn itself is ~9MB installed, has no model weights to download, and
every vector it produces is a deterministic, stateless hash of the input
text — no corpus fitting, no persisted vocabulary, no training step.

If VOYAGE_API_KEY or OPENAI_API_KEY is ever added to backend/.env, this
module is the place to swap in a real embedding call — every call site in
main.py only depends on `relevance_score()`, `near_duplicate_score()`, and
`top_match()`, never on how the underlying vectors are produced.

REUSE
─────
The exact same hashed vector + cosine-similarity mechanism backs both:
  1. Mission-profile relevance scoring (`relevance_score` / `profile_vector`)
  2. Near-duplicate article detection (`near_duplicate_score` / `top_match`)
one similarity system, two call sites — per the task's own suggestion, since
building two separate similarity mechanisms for the same underlying need
(comparing two short pieces of text for semantic/topical overlap) would just
be duplicated surface area for no accuracy benefit at this text length.

HONESTY ABOUT TODAY'S MISSION PROFILE
──────────────────────────────────────
The live backend/profile.json has empty focusRegions/infraDomains/chokepoints
and a two-word activeSituations ("Monitoring paris"). Cosine similarity
against that thin a profile is not a strong discriminator — most articles
will score low simply because the profile itself barely says anything. This
module is built to get more useful as the profile gets richer; see
`main._profile_has_signal()` for the gate that keeps this stage informational
(logged, not enforced) until the profile actually carries enough content to
make the "relevant" / "irrelevant" verdict trustworthy.
"""
from __future__ import annotations

import hashlib
from typing import Iterable, Optional

from scipy.sparse import vstack
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Stateless — no .fit() call, no learned vocabulary, no persisted model file.
# n_features chosen large enough that hash collisions are rare for short
# (title + summary length) news text; ngram_range=(1, 2) so multi-word named
# entities ("Strait of Hormuz", "Bab el-Mandeb") contribute distinctive
# bigram features rather than being diluted into generic unigrams.
_VECTORIZER = HashingVectorizer(
    n_features=2 ** 18,
    alternate_sign=False,
    norm="l2",
    stop_words="english",
    ngram_range=(1, 2),
    lowercase=True,
)


def embed(text: str):
    """Return a stateless hashed TF vector (1 x n_features sparse row) for `text`."""
    return _VECTORIZER.transform([text or ""])


def cosine(vec_a, vec_b) -> float:
    """Cosine similarity between two single-row sparse vectors, in [0, 1]
    (HashingVectorizer's default alternate_sign=False keeps all entries
    non-negative, so similarity never goes negative here)."""
    if vec_a is None or vec_b is None:
        return 0.0
    if vec_a.nnz == 0 or vec_b.nnz == 0:
        return 0.0
    return float(cosine_similarity(vec_a, vec_b)[0, 0])


def top_match(vec, candidates: list[tuple[str, "object"]]) -> Optional[tuple[str, float]]:
    """
    Given a query vector and a list of (key, vector) candidates, return the
    (key, score) of the best cosine match, or None if `candidates` is empty.
    Vectorized (one cosine_similarity call against a stacked matrix) rather
    than a Python loop, since a news cycle can carry hundreds of candidates
    against a multi-hundred-entry recent-article cache.
    """
    if not candidates:
        return None
    stacked = vstack([v for _, v in candidates])
    sims = cosine_similarity(vec, stacked)[0]
    idx = int(sims.argmax())
    return candidates[idx][0], float(sims[idx])


# ── Mission-profile relevance ──────────────────────────────────────────────
# Cached by a hash of the profile context text so the profile is only
# re-embedded when it actually changes (on /profile/save), never once per
# 30-minute extraction cycle — the task explicitly asked for this caching.
_profile_cache: dict = {"text_hash": None, "vector": None}


def profile_vector(profile_context_text: str):
    """Return the cached embedding for the Mission Profile context text
    (main._format_profile_context()'s output), recomputing only when the
    text has actually changed since the last call."""
    h = hashlib.sha1((profile_context_text or "").encode("utf-8")).hexdigest()
    if _profile_cache["text_hash"] != h:
        _profile_cache["text_hash"] = h
        _profile_cache["vector"] = embed(profile_context_text)
    return _profile_cache["vector"]


def relevance_score(profile_context_text: str, article_text: str) -> float:
    """Cosine similarity between the (cached) Mission Profile embedding and an
    article's title+summary embedding. 0.0 if either text is empty — callers
    should treat that as "not computed" rather than "confirmed irrelevant"."""
    if not profile_context_text or not article_text:
        return 0.0
    pv = profile_vector(profile_context_text)
    av = embed(article_text)
    return cosine(pv, av)


def near_duplicate_score(text_a: str, text_b: str) -> float:
    """Cosine similarity between two articles' title+summary text — the same
    mechanism as `relevance_score`, reused for near-duplicate ("same wire
    story, different outlet") detection instead of mission-profile scoring."""
    return cosine(embed(text_a), embed(text_b))

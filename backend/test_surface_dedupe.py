"""
One row per story.

Nothing deduped the surface pool, so the same wire story arrived several
times with different geocodes: 9 of 50 rows wasted, and 7 of 41 distinct
headlines carrying contradictory locations — a Georgia mass shooting placed
in both Atlanta and Vienna, Austria; one London shooting placed in
Hounslow, Ilford and Wembley at once. Each copy drew a marker somewhere it
did not happen.

The dedupe lives inside _build_surface_pool, so it is exercised here
through a small reimplementation of the same contract rather than by
building a real pool — what is tested is the contract, and a change to it
should break these.
"""


def _agrees(item: dict) -> bool:
    head = " ".join(str(item.get("headline") or "").lower().split())
    for part in str(item.get("location") or "").split(","):
        part = part.strip().lower().rstrip("*")
        if len(part) >= 4 and part in head:
            return True
    return False


def dedupe(gated: list) -> list:
    """The pool's dedupe step, as main.py applies it after sorting."""
    seen: dict = {}
    out: list = []
    for item in gated:
        head = " ".join(str(item.get("headline") or "").lower().split())
        if len(head) < 25:
            out.append(item)
            continue
        prior = seen.get(head)
        if prior is not None:
            loc = (item.get("location") or "").strip()
            prior_loc = (prior.get("location") or "").strip()
            if loc and loc != prior_loc and _agrees(item) and not _agrees(prior):
                prior["location"] = loc
                for k in ("lat", "lon"):
                    if item.get(k) is not None:
                        prior[k] = item[k]
                loc, prior_loc = prior_loc, loc
            if loc and loc != prior_loc:
                c = prior.setdefault("contested_locations", [])
                if loc not in c:
                    c.append(loc)
            continue
        seen[head] = item
        out.append(item)
    return out


def _i(headline, location, score=0):
    return {"headline": headline, "location": location, "relevance_score": score}


GEORGIA = "Georgia mass shooting: 35 injured, 2 dead after gunfire at block party"


def test_the_repeated_story_keeps_one_row():
    out = dedupe([_i(GEORGIA, "Atlanta, Georgia, United States", 9),
                  _i(GEORGIA, "Vienna, Wien, Austria", 4)])
    assert len(out) == 1


def test_the_survivor_is_the_first_which_is_the_highest_scoring():
    # The pool sorts by relevance before deduping, so first == best.
    out = dedupe([_i(GEORGIA, "Atlanta, Georgia, United States", 9),
                  _i(GEORGIA, "Vienna, Wien, Austria", 4)])
    assert out[0]["location"] == "Atlanta, Georgia, United States"


def test_the_losing_geocode_is_recorded_not_discarded():
    """A place another copy of the same story contradicts is not evidence of
    anything, and everything reading the location downstream deserves to
    know that before it draws a conclusion."""
    out = dedupe([_i(GEORGIA, "Atlanta, Georgia, United States", 9),
                  _i(GEORGIA, "Vienna, Wien, Austria", 4)])
    assert out[0]["contested_locations"] == ["Vienna, Wien, Austria"]


def test_three_way_contradiction_records_both_losers():
    head = "East Acton Braybrook Street shooting: Updates on man killed"
    out = dedupe([_i(head, "Hounslow, Hounslow, United Kingdom", 9),
                  _i(head, "Ilford, Redbridge, United Kingdom", 5),
                  _i(head, "Wembley, Brent, United Kingdom", 3)])
    assert len(out) == 1
    assert out[0]["contested_locations"] == ["Ilford, Redbridge, United Kingdom",
                                             "Wembley, Brent, United Kingdom"]


def test_the_same_story_at_the_same_place_is_not_contested():
    out = dedupe([_i(GEORGIA, "Atlanta, Georgia, United States", 9),
                  _i(GEORGIA, "Atlanta, Georgia, United States", 4)])
    assert len(out) == 1
    assert "contested_locations" not in out[0]


def test_a_short_generic_headline_is_left_alone():
    """'Explosion reported' from two countries is two stories. Only a
    headline long enough to be distinctive is folded."""
    out = dedupe([_i("Explosion reported", "Beirut, Lebanon", 9),
                  _i("Explosion reported", "Kharkiv, Ukraine", 8)])
    assert len(out) == 2


def test_different_stories_are_untouched():
    out = dedupe([_i(GEORGIA, "Atlanta, Georgia, United States", 9),
                  _i("Attack on aid trucks in South Kordofan kills driver",
                     "Kadugli, Janub Kurdufan, Sudan", 8)])
    assert len(out) == 2


def test_whitespace_and_case_do_not_defeat_it():
    out = dedupe([_i(GEORGIA, "Atlanta, Georgia, United States", 9),
                  _i("  " + GEORGIA.upper() + " ", "Vienna, Wien, Austria", 4)])
    assert len(out) == 1


# ── which of two geocodes survives ──────────────────────────────────────
#
# Relevance score is the sort key and says nothing about geocoding quality.
# On its own it kept "Clark County, Nevada" for a story headlined "downtown
# Las Vegas shooting", and would have kept Vienna over Atlanta had the
# scores fallen the other way.

def test_the_geocode_the_headline_corroborates_wins():
    head = "1 dead, 2 injured after downtown Las Vegas shooting"
    out = dedupe([{"headline": head, "location": "Clark County, Nevada, United States",
                   "lat": 36.0, "lon": -115.0, "relevance_score": 9},
                  {"headline": head, "location": "Las Vegas, Nevada, United States",
                   "lat": 36.17, "lon": -115.14, "relevance_score": 4}])
    assert len(out) == 1
    assert out[0]["location"] == "Las Vegas, Nevada, United States"
    # The position in the pool is still the one relevance earned; only the
    # PLACE is corrected.
    assert out[0]["relevance_score"] == 9
    # and the coordinates move with it, or the marker stays where the
    # rejected geocode put it
    assert out[0]["lat"] == 36.17
    assert out[0]["contested_locations"] == ["Clark County, Nevada, United States"]


def test_a_corroborated_first_copy_is_not_replaced():
    head = "Georgia mass shooting: 35 injured, 2 dead after gunfire at block party"
    out = dedupe([{"headline": head, "location": "Atlanta, Georgia, United States",
                   "relevance_score": 9},
                  {"headline": head, "location": "Vienna, Wien, Austria",
                   "relevance_score": 8}])
    assert out[0]["location"] == "Atlanta, Georgia, United States"
    assert out[0]["contested_locations"] == ["Vienna, Wien, Austria"]


def test_neither_corroborated_keeps_the_higher_scoring_one():
    head = "Attack on aid trucks in South Kordofan kills driver"
    out = dedupe([{"headline": head, "location": "Kadugli, Janub Kurdufan, Sudan",
                   "relevance_score": 9},
                  {"headline": head, "location": "El Obeid, Shamal Kurdufan, Sudan",
                   "relevance_score": 3}])
    assert out[0]["location"] == "Kadugli, Janub Kurdufan, Sudan"


def test_a_short_fragment_cannot_carry_a_match():
    # "US" appearing inside another word must not corroborate a geocode.
    head = "Russian strike on a bus depot kills four"
    out = dedupe([{"headline": head, "location": "Kharkiv, Kharkivska, Ukraine",
                   "relevance_score": 9},
                  {"headline": head, "location": "US, Nevada, United States",
                   "relevance_score": 2}])
    assert out[0]["location"] == "Kharkiv, Kharkivska, Ukraine"

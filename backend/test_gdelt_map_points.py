"""
test_gdelt_map_points.py — which GDELT events may be drawn, and what a pin
has to be able to say.

The failure being prevented has happened here before: the old news layer was
removed because 620 articles landed on Berlin and 213 on the US centroid.
GDELT's ActionGeo is A PLACE NAMED IN THE ARTICLE, not where anything
occurred. Observed live: "ANTONIO GUTERRES (PRT) disapproves of THE US"
placed at Tehran, Iran — at city precision — because the piece was about
Iran.

    cd backend && python3 -m pytest test_gdelt_map_points.py -q
"""
import gdelt_events as g

ARTICLE = "https://example.com/news/2026/09/20/clashes-in-lahij"
TAG_PAGE = "https://freerepublic.com/tag/*/index?more=4396171"
TITLE = "At least 48 people died in clashes in southern Yemen"


def ev(**kw):
    base = {
        "id": "1", "pinnable": True, "source_url": ARTICLE, "headline": TITLE,
        "lat": 13.0567, "lon": 44.8819, "location": "Lahij, Yemen",
        "event_type": "Fight", "event_root_code": "19", "goldstein": -10.0,
        "avg_tone": -7.3, "mentions": 5, "actor1": "MILITANT", "actor2": "GOVERNMENT",
    }
    base.update(kw)
    return base


# ── the gate ──────────────────────────────────────────────────────────────

def test_a_kinetic_city_level_event_with_a_real_article_is_drawn():
    p = g.map_point(ev())
    assert p is not None
    assert p["title"] == TITLE
    assert p["source_url"] == ARTICLE


def test_an_event_without_a_precise_location_is_not_drawn():
    """A country centroid is the middle of a polygon, not a place."""
    assert g.map_point(ev(pinnable=False)) is None


def test_a_tag_or_index_page_is_not_a_source():
    """It is a rotating list, so it cannot be cited as the source of one
    event — observed live on a freerepublic tag index."""
    assert g.map_point(ev(source_url=TAG_PAGE)) is None
    for bad in ("https://x.com/category/world", "https://x.com/search?q=a",
                "https://x.com/author/jane", "https://x.com/feed"):
        assert g.map_point(ev(source_url=bad)) is None, bad


def test_a_fragment_is_not_a_title():
    """A pin is read at a glance; half a sentence is worse than none."""
    assert g.map_point(ev(headline="Police ID Kansas double")) is None
    assert g.map_point(ev(headline="")) is None
    assert g.map_point(ev(headline="averylongsingletokenwithnospacesatall")) is None


def test_an_event_with_no_coordinates_is_not_drawn():
    assert g.map_point(ev(lat=None)) is None
    assert g.map_point(ev(lon=None)) is None


# ── what the pin says ─────────────────────────────────────────────────────

def test_the_pin_carries_a_title_a_context_and_a_place():
    p = g.map_point(ev())
    assert p["title"]
    assert p["context"]
    assert p["location_name"] and p["lat"] and p["lon"]


def test_the_context_is_words_not_a_cameo_number():
    """The reader must never be asked to know the codebook."""
    c = g.map_point(ev())["context"]
    assert "Fight" in c
    assert "19" not in c and "190" not in c


def test_the_pin_admits_it_is_machine_coded():
    """A GeoConfirmed square is a human who found the building in the video.
    This is a machine that read a wire story. The map must be able to
    render that difference."""
    p = g.map_point(ev())
    assert p["confidence"] == "machine-coded"
    assert p["source"] == "GDELT"


# ── one story, one pin ────────────────────────────────────────────────────

def test_one_article_coded_twice_becomes_one_pin():
    """GDELT codes a single shooting report as both Fight and Coerce at
    identical coordinates. Two pins on one spot reads as two incidents."""
    pts = g.map_points([ev(id="1", event_type="Fight", goldstein=-10.0),
                        ev(id="2", event_type="Coerce", goldstein=-7.0)])
    assert len(pts) == 1
    assert "Fight" in pts[0]["context"] and "Coerce" in pts[0]["context"]


def test_the_merged_pin_keeps_the_most_conflictual_coding():
    pts = g.map_points([ev(id="1", event_type="Coerce", goldstein=-7.0),
                        ev(id="2", event_type="Fight", goldstein=-10.0)])
    assert pts[0]["event_type"] == "Fight"
    assert pts[0]["goldstein"] == -10.0


def test_two_genuinely_different_stories_stay_separate():
    a = ev(id="1", source_url="https://a.com/news/one-thing-happened-today")
    b = ev(id="2", source_url="https://b.com/news/another-thing-happened",
           lat=15.3, lon=44.2)
    assert len(g.map_points([a, b])) == 2


def test_nothing_drawable_produces_nothing():
    assert g.map_points([]) == []
    assert g.map_points([ev(pinnable=False)]) == []


# ── the headline fix ──────────────────────────────────────────────────────

def test_a_hyphenated_word_is_not_mistaken_for_a_site_name():
    """The site-name stripper required no whitespace before the separator,
    so any hyphenated word near the end truncated the headline — 10 of 47
    cached titles, several mid-word."""
    assert g._clean_html_title(
        "Mecca Alliance will be 'game-changer' for regional security"
    ) == "Mecca Alliance will be 'game-changer' for regional security"
    assert g._clean_html_title(
        "Police ID Kansas double-homicide suspect"
    ) == "Police ID Kansas double-homicide suspect"


def test_a_real_site_name_is_still_stripped():
    assert g._clean_html_title("Israeli strike hits Gaza hospital | Al Jazeera") \
        == "Israeli strike hits Gaza hospital"
    assert g._clean_html_title("Anti-government protests spread - Reuters") \
        == "Anti-government protests spread"

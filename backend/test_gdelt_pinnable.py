"""
test_gdelt_pinnable.py — which GDELT events may be drawn on a map.

Two failures are being prevented here, and both have actually happened.

THE OLD ONE. The previous news layer was removed because 620 articles
landed on Berlin and 213 on the US centroid. GDELT's ActionGeo is A PLACE
NAMED IN THE ARTICLE, not where anything occurred.

THE ONE THAT SHIPPED. The kinetic path required NumSources >= 2. Measured
against the live 15-minute export, NumSources is 1 for 66 of 66 kinetic
rows — the field is structurally constant in this feed. The filter
therefore rejected 100% of kinetic events and the layer drew nothing,
quietly, for as long as it existed. A threshold on a field that never
varies is not a strict filter, it is an off switch.

    cd backend && python3 -m pytest test_gdelt_pinnable.py -q
"""
import gdelt_events as ge


def ev(**kw):
    """A kinetic, drawable event. Tests override one thing at a time."""
    base = {
        "id": "1", "event_root_code": "19", "goldstein": -9.0,
        "sources": 1, "mentions": 5,
        "action_geo_type": "4", "lat": 35.7, "lon": 51.4,
        "location": "Tehran, Iran",
        "source_url": "https://apnews.com/article/tehran-strike-9f2",
        "headline": "Explosion at Tehran refinery kills at least four, state media says",
        "headline_is_article": True,
        "event_type": "Assault", "event_date": "2026-09-20",
    }
    base.update(kw)
    base["pinnable"] = (str(base["action_geo_type"]) in ge.PINNABLE_GEO_TYPES
                        and str(base["event_root_code"]) not in ge.VERBAL_ROOT_CODES)
    return base


# ── the threshold that was an off switch ──────────────────────────────────

def test_a_single_source_kinetic_event_is_not_rejected():
    """THE REGRESSION. Every kinetic row in this feed reports NumSources=1,
    so requiring two rejected all of them and the layer never drew."""
    assert ge._passes_filter(ev(sources=1, mentions=5))


def test_corroboration_is_read_from_mentions_which_actually_varies():
    assert not ge._passes_filter(ev(mentions=1))
    assert not ge._passes_filter(ev(mentions=2))
    assert ge._passes_filter(ev(mentions=3))


def test_a_single_wire_item_is_still_not_enough():
    """Relaxing the source test must not turn the filter off entirely."""
    assert not ge._passes_filter(ev(mentions=1, sources=1))


# ── where a pin may be placed ─────────────────────────────────────────────

def test_a_country_level_coordinate_is_never_a_pin():
    """Geo type 1 is a country centroid — the Berlin failure, exactly."""
    assert ge.map_point(ev(action_geo_type="1")) is None


def test_city_and_landmark_coordinates_may_be_pinned():
    assert ge.map_point(ev(action_geo_type="3")) is not None
    assert ge.map_point(ev(action_geo_type="4")) is not None


def test_a_verbal_event_is_never_pinned_however_well_geocoded():
    """"Guterres disapproves of the US" was placed in Tehran because the
    article was about Iran. That is a coincidence of vocabulary, not a
    location. Verbal events earn their place in the tone trend instead."""
    for root in sorted(ge.VERBAL_ROOT_CODES):
        assert ge.map_point(ev(event_root_code=root, action_geo_type="4")) is None


# ── a pin must quote a journalist ─────────────────────────────────────────

def test_a_generated_headline_is_not_drawable_however_readable():
    """The gate that length cannot enforce. "Armed clashes reported
    involving Police and Cartel in Sydney" is generated from CAMEO codes,
    reads like a headline and clears every readability test. Drawing it
    puts a machine's paraphrase on the map in the voice of a news report."""
    generated = "Armed clashes reported involving Police and Cartel in Sydney"
    assert ge.has_readable_title(generated)          # it passes on length
    assert ge.map_point(ev(headline=generated,
                           headline_is_article=False)) is None


def test_a_real_article_headline_is_drawable():
    assert ge.map_point(ev())["title"].startswith("Explosion at Tehran")


def test_a_fragment_is_not_a_headline():
    assert ge.map_point(ev(headline="Iran")) is None


def test_an_index_page_is_not_a_source():
    """A tag or category URL is a rotating list, so it cannot be cited as
    the source of one event."""
    for u in ("https://bbc.co.uk/news/topics/c2vdnvdg6xxt",
              "https://reuters.com/tag/iran/",
              "https://apnews.com/search?q=tehran"):
        assert ge.map_point(ev(source_url=u)) is None, u


def test_an_event_with_no_coordinate_is_not_a_pin():
    assert ge.map_point(ev(lat=None)) is None


# ── one story is one pin ──────────────────────────────────────────────────

def test_the_same_article_at_one_place_becomes_a_single_pin():
    """GDELT codes one article into several events — a report of a shooting
    yields "Fight" and "Coerce" at identical coordinates, which would stack
    two pins on one spot and read as two incidents."""
    a = ev(id="1", event_type="Fight", goldstein=-9.0)
    b = ev(id="2", event_type="Coerce", goldstein=-6.0)
    pins = ge.map_points([a, b])
    assert len(pins) == 1
    assert set(pins[0]["event_types"]) == {"Fight", "Coerce"}


def test_the_most_conflictual_coding_is_the_one_shown():
    """"Fight" is the fact, "Coerce" is the framing."""
    pins = ge.map_points([ev(id="1", event_type="Coerce", goldstein=-6.0),
                          ev(id="2", event_type="Fight", goldstein=-9.0)])
    assert pins[0]["event_type"] == "Fight"


def test_the_same_story_at_two_places_stays_two_pins():
    """Different coordinates are different claims, even from one article."""
    pins = ge.map_points([ev(id="1", lat=35.7, lon=51.4),
                          ev(id="2", lat=32.6, lon=51.7)])
    assert len(pins) == 2


# ── what a pin tells the reader ───────────────────────────────────────────

def test_a_pin_names_its_source_and_says_it_is_machine_coded():
    """Presented at the same weight as a human-verified GeoConfirmed square,
    this would be the lie."""
    p = ge.map_point(ev())
    assert p["source_url"].startswith("https://apnews.com/")
    assert p["confidence"] == "machine-coded"
    assert p["geo_precision"] == "city"


def test_the_context_line_avoids_the_cameo_codebook():
    """A reader should never need to know that 19 means Assault."""
    c = ge.map_point(ev())["context"]
    assert "Assault" in c and "19" not in c

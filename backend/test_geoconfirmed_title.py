"""Tests for PARALLAX addendum §A3 — the composed title.

Every case here is a real shape taken from the live archive (74,675 active
placemarks), not an invented one."""
import geoconfirmed_title as T
import notification_context as nc


def title(**kw):
    kw.setdefault("location", "Kup'yans'k, Kharkiv Oblast, Ukraine")
    kw.setdefault("category", T.derive_category(kw.get("description"), kw.get("name")))
    return T.compose_title(**kw)


# ── §A13 #1 · no alert anywhere is titled with a date ────────────────────

def test_the_publication_date_is_never_the_title():
    """GeoConfirmed names a placemark by its date. Every active placemark in
    this database is named that way."""
    out = title(name="17 SEP 2026",
                description="Artillery shelling from the 57th Motorized Brigade in Vovchans'k.")
    assert "17 SEP 2026" not in out
    assert "Artillery shelling" in out


def test_archive_filing_prefixes_are_stripped_from_the_name():
    """6,511 older placemarks are named '01 SEP 2022 - PIC - <the real
    sentence>'. The sentence is the best text on the record; the date in
    front of it is the defect."""
    out = title(name="01 SEP 2022 - PIC - A downed Ukrainian kamikaze drone fell on a roof",
                description="https://twitter.com/x/status/1 <br><br>Geo: <br>https://t.co/2")
    assert not out.startswith("01 SEP 2022")
    assert "downed Ukrainian kamikaze drone" in out


def test_a_colon_separated_filing_prefix_is_also_stripped():
    out = title(name="23 FEB 2022 : State of Emergency from midnight", description=None)
    assert not out.startswith("23 FEB 2022")
    assert "State of Emergency" in out


# ── the citation is not prose ────────────────────────────────────────────

def test_a_citation_only_description_never_becomes_the_title():
    """6,109 placemarks carry only source links. A URL on an analyst's screen
    is strictly worse than the date it replaced."""
    out = title(name="02 SEP 2026",
                description="https://twitter.com/a/status/1 <br><br>Geo: <br>https://t.co/b",
                category="maritime")
    assert "http" not in out
    assert out.startswith("Maritime incident")


def test_strip_citation_keeps_prose_that_merely_contains_a_link():
    kept = nc.strip_citation("A ferry was attacked near Odesa. https://t.co/x")
    assert kept == "A ferry was attacked near Odesa."


# ── video timecodes ──────────────────────────────────────────────────────

def test_all_three_real_timecode_shapes_are_stripped():
    for raw in ("0:13 - A vehicle is struck by a drone",
                "1:35-1:41 - A vehicle is struck by a drone",
                "0:32-end - A vehicle is struck by a drone",
                "3:02-End - A vehicle is struck by a drone"):
        out = title(name="17 SEP 2026", description=raw)
        assert out.startswith("A vehicle is struck"), out
        assert "end" not in out.split(" — ")[0].lower().split("drone")[0]


# ── §A3 category · the subject, not the actor ────────────────────────────

def test_artillery_that_is_firing_is_conflict_not_equipment():
    """§A3's equipment subjects are all losses ('Launcher struck'). A brigade
    shelling with artillery has lost nothing."""
    assert T.derive_category("Artillery shelling from the 57th Motorized Brigade") == "conflict"


def test_artillery_that_was_hit_is_equipment():
    assert T.derive_category("A Russian howitzer is destroyed by a drone strike") == "equipment"


def test_a_drone_as_the_weapon_is_not_an_air_event():
    """'drone' appears in a third of this corpus as the delivery method.
    Treating it as a subject noun put 29.8% of the archive in `air`."""
    assert T.derive_category("A Russian checkpoint is hit with a drone") != "air"


def test_a_drone_as_the_subject_is_an_air_event():
    assert T.derive_category("Russian Chernika drone intercepted by an FPV") == "air"


def test_a_unit_credited_for_an_action_is_not_an_orbat_sighting():
    """GeoConfirmed credits a unit in most descriptions. Ungated, orbat
    swallowed the archive."""
    assert T.derive_category(
        "The 414th Unmanned Strike Aviation Brigade attacks a gas distribution station") != "orbat"


def test_a_formation_that_was_observed_is_an_orbat_sighting():
    assert T.derive_category("Russian convoy identified moving west of Luhansk") == "orbat"
    assert T.derive_category("Russian fortifications, Crimea") == "orbat"


def test_the_target_decides_the_category_not_the_weapon():
    """A residential building struck by a missile is a civil harm event."""
    assert T.derive_category(
        "Ukrainian residential building hit by a Russian cruise missile") == "civil"


def test_an_uncategorisable_record_is_none_not_conflict():
    """None is a real answer. A guessed category does not mislabel one pin,
    it manufactures a trend (§A5 baselines are per category)."""
    assert T.derive_category("A Ukrainian flag was raised in Lebedevka.") is None
    assert T.derive_category("") is None
    assert T.derive_category(None) is None


def test_a_category_is_never_derived_from_a_url():
    assert T.derive_category("https://twitter.com/navy_ship_strike/status/1") is None


# ── the fallback is a noun, not a guessed verb ───────────────────────────

def test_the_fallback_names_the_category_and_claims_nothing_else():
    """§A3 rotates a vocabulary pool here ('Strike'/'Shelling'/'Explosion'),
    which asserts an event the record does not support. See the module
    docstring — this is a deliberate deviation."""
    for cat, noun in [("maritime", "Maritime incident"),
                      ("infrastructure", "Infrastructure incident"),
                      ("equipment", "Equipment loss")]:
        assert T.category_noun(cat) == noun
    out = title(name="02 SEP 2026", description=None, category="infrastructure")
    assert out.startswith("Infrastructure incident")
    for invented in ("Strike", "Shelling", "Explosion", "Armed clash"):
        assert invented not in out


# ── §A3 the date survives as metadata ────────────────────────────────────

def test_the_date_is_demoted_to_metadata_not_discarded():
    import datetime
    assert T.date_label(datetime.datetime(2026, 9, 17, 14, 30)) == "2026-09-17"
    assert T.date_label(None) is None

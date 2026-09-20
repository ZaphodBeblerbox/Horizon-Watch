"""
test_ucdp_ingest.py — the free conflict baseline.

ACLED is not free (confirmed with them). UCDP's API now needs a token but
its bulk CSVs stay open, and one monthly file carries 176 Yemen events
where GeoConfirmed managed 38 in ninety days.

The properties that matter are about HONESTY, not parsing: that a
province-level coordinate is never drawn as a place, and that the two-month
lag is reported rather than assumed known — putting a two-month-old event
beside a three-hour-old hotspot without saying so would be a quiet lie.

    cd backend && python3 -m pytest test_ucdp_ingest.py -q
"""
import ucdp_ingest as u


def row(**kw):
    base = {
        "id": "555", "latitude": "13.5795", "longitude": "44.0209",
        "date_start": "2026-07-20", "country": "Yemen (North Yemen)",
        "adm_1": "Taiz governorate", "best": "3", "where_prec": "2",
        "type_of_violence": "1", "side_a": "Government of Yemen",
        "side_b": "Forces of the Houthi movement", "conflict_name": "Yemen",
    }
    base.update(kw)
    return base


# ── precision ─────────────────────────────────────────────────────────────

def test_a_site_or_village_coordinate_is_drawable():
    for prec in ("1", "2", "3"):
        assert u.normalise(row(where_prec=prec))["pinnable"] is True


def test_a_province_level_coordinate_is_not_drawable():
    """'Somewhere in this province' is the country-centroid failure in
    another costume."""
    for prec in ("4", "5", "6", "7"):
        assert u.normalise(row(where_prec=prec))["pinnable"] is False


def test_an_unlocated_row_is_dropped_not_guessed():
    assert u.normalise(row(latitude="")) is None
    assert u.normalise(row(longitude="not-a-number")) is None


def test_a_row_with_no_date_is_dropped():
    """Corroboration is a claim about coincidence in time as well as
    space, so a dateless event cannot participate."""
    assert u.normalise(row(date_start="")) is None


# ── what it says ──────────────────────────────────────────────────────────

def test_the_label_is_a_sentence_not_a_row_of_codes():
    lab = u.normalise(row())["label"]
    assert "3 killed" in lab
    assert "State-based" in lab
    assert "type_of_violence" not in lab and "1" != lab


def test_violence_type_is_named_in_words():
    assert "one-sided" in u.normalise(row(type_of_violence="3"))["violence_type"]
    assert "non-state" in u.normalise(row(type_of_violence="2"))["violence_type"]


def test_zero_deaths_is_stated_rather_than_omitted():
    """An event with no recorded deaths is still an event; leaving the
    figure blank reads as missing data."""
    assert "no recorded deaths" in u.normalise(row(best="0"))["label"]


def test_placeholder_actor_codes_are_not_shown_to_a_reader():
    """UCDP uses XXX-prefixed placeholders for unidentified actors."""
    lab = u.normalise(row(side_a="XXX678", side_b="XXX678"))["label"]
    assert "XXX" not in lab


def test_the_worst_available_death_count_is_used():
    r = row(best="0", deaths_civilians="7")
    assert u.normalise(r)["deaths"] == 7


# ── the lag, stated ───────────────────────────────────────────────────────

def test_the_baseline_is_per_month_not_a_raw_total():
    """UCDP's real job is answering 'is this district unusually active for
    itself', which needs a rate."""
    events = [u.normalise(row(id=str(i))) for i in range(60)]
    b = u.baseline_rate(events, "Yemen (North Yemen)", months=6)
    assert b["events"] == 60
    assert b["per_month"] == 10.0


def test_baseline_can_narrow_to_a_province():
    events = ([u.normalise(row(id=str(i), adm_1="Taiz governorate")) for i in range(10)]
              + [u.normalise(row(id=f"b{i}", adm_1="Bayda governorate")) for i in range(4)])
    assert u.baseline_rate(events, "Yemen (North Yemen)", "Taiz governorate")["events"] == 10


def test_pinnable_precision_set_is_explicit():
    """If this ever widens silently, province centroids start appearing on
    the map again."""
    assert u.PINNABLE_PRECISION == {"1", "2", "3"}


def test_the_file_chooser_orders_by_version_not_alphabetically():
    """'v26_0_7' and 'v26_01_26_06' do not sort correctly as strings, and
    picking the wrong one silently ingests an older month."""
    import re
    names = ["GEDEvent_v26_0_7.csv", "GEDEvent_v26_01_26_06.csv"]
    key = lambda n: [int(x) for x in re.findall(r"\d+", n)] or [0]
    assert sorted(names, key=key)[-1] == "GEDEvent_v26_01_26_06.csv"


# ── the baseline is the point ─────────────────────────────────────────────

def test_the_baseline_words_separate_a_finding_from_a_tuesday():
    """A reader should not have to hold a distribution in their head to
    interpret a float. Measured on real data: Khor Fakkan 0.08/month,
    Sana'a 1.25, Kharkiv 15.17 — a 190x spread, so the bands have to fall
    in sensible places."""
    def band(per_month):
        return ("routinely violent" if per_month >= 5
                else "periodically violent" if per_month >= 1
                else "rarely violent" if per_month > 0
                else "no recorded conflict activity")

    assert band(15.17) == "routinely violent"      # Kharkiv
    assert band(1.25) == "periodically violent"    # Sana'a
    assert band(0.08) == "rarely violent"          # Khor Fakkan
    assert band(0.0) == "no recorded conflict activity"

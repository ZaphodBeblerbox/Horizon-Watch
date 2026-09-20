"""
test_corroborate.py — several weak sources agreeing on a place and a time.

The property that matters is not "did it group things", it is "does it know
what agreement is worth". Two machine readings of one wire story agree by
construction and are worth almost nothing; a thermal satellite and a human
watching a video are two genuinely different ways of looking at the same
ground. A system that cannot tell those apart talks itself into confidence
it has not earned.

    cd backend && python3 -m pytest test_corroborate.py -q
"""
from datetime import datetime, timedelta, timezone

import corroborate as co

T0 = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
LAHIJ = (13.0567, 44.8819)


def obs(source, lat=LAHIJ[0], lon=LAHIJ[1], hours=0.0, **kw):
    return {"source": source, "lat": lat, "lon": lon,
            "ts": (T0 + timedelta(hours=hours)).isoformat(), **kw}


# ── grouping ──────────────────────────────────────────────────────────────

def test_two_sources_at_one_place_and_time_become_one_cluster():
    cl = co.cluster([obs("firms"), obs("geoconfirmed", hours=2)])
    assert len(cl) == 1
    assert cl[0]["members"] == 2


def test_the_same_place_months_apart_is_not_one_event():
    cl = co.cluster([obs("firms"), obs("geoconfirmed", hours=24 * 60)])
    assert len(cl) == 2


def test_the_same_time_in_two_countries_is_not_one_event():
    cl = co.cluster([obs("firms"), obs("geoconfirmed", lat=50.4, lon=30.5)])
    assert len(cl) == 2


def test_a_chain_of_nearby_sightings_stays_one_cluster():
    """Single-link on purpose: two sightings on opposite sides of a growing
    cluster belong together, and centroid linkage would split them."""
    cl = co.cluster([
        obs("firms", lat=13.0567),
        obs("sar_change", lat=13.0867, hours=1),     # ~3km from the first
        obs("imagery", lat=13.1167, hours=2),        # ~3km from the second
    ], radius_km=5.0)
    assert len(cl) == 1
    assert cl[0]["members"] == 3


# ── what agreement is worth ───────────────────────────────────────────────

def test_independence_is_counted_by_modality_not_by_source():
    """GDELT and a news feed reporting the same wire story are one witness
    counted twice."""
    cl = co.cluster([obs("gdelt"), obs("news", hours=1)])
    assert cl[0]["members"] == 2
    assert cl[0]["independent_modalities"] == 1
    assert cl[0]["corroborated"] is False


def test_genuinely_different_instruments_do_corroborate():
    """Thermal and human-verified media are different ways of looking."""
    cl = co.cluster([obs("firms"), obs("geoconfirmed", hours=2)])
    assert cl[0]["independent_modalities"] == 2
    assert cl[0]["corroborated"] is True


def test_two_satellites_of_the_same_kind_are_one_witness():
    """FIRMS and VIIRS are both thermal — largely the same instrument
    family looking the same way."""
    cl = co.cluster([obs("firms"), obs("viirs", hours=1)])
    assert cl[0]["independent_modalities"] == 1


def test_volume_of_weak_sources_cannot_outrank_one_strong_one():
    """Ten machine-coded rows about one story must not beat a human who
    found the building in the video."""
    many_weak = co.cluster([obs("gdelt", hours=i * 0.1) for i in range(10)])[0]
    one_strong = co.cluster([obs("geoconfirmed")])[0]
    assert one_strong["confidence"] >= many_weak["confidence"]


def test_confidence_rises_with_independence_not_with_count():
    two_kinds = co.cluster([obs("firms"), obs("geoconfirmed", hours=1)])[0]
    same_kind = co.cluster([obs("gdelt"), obs("news", hours=1),
                            obs("gdelt", hours=2)])[0]
    assert two_kinds["confidence"] > same_kind["confidence"]


# ── the yemen case ────────────────────────────────────────────────────────

def test_the_cued_location_is_surfaced_and_the_noise_is_not():
    """The scenario this exists for: a thermal hotspot that nothing else
    saw is a maybe; one that a geolocated report and a radar change agree
    with is somewhere to point a satellite."""
    observations = [
        obs("firms", lat=13.05, lon=44.88),
        obs("geoconfirmed", lat=13.052, lon=44.881, hours=3),
        obs("sar_change", lat=13.051, lon=44.879, hours=20),
        # elsewhere, alone
        obs("firms", lat=15.30, lon=44.20, hours=1),
        obs("gdelt", lat=16.00, lon=43.00, hours=5),
    ]
    good = co.corroborated_only(co.cluster(observations))
    assert len(good) == 1
    top = good[0]
    assert top["independent_modalities"] == 3
    assert abs(top["lat"] - 13.051) < 0.01


def test_an_uncorroborated_hotspot_is_kept_but_not_promoted():
    """Not corroborated is not the same as not real — it stays available,
    it simply does not raise an alarm."""
    clusters = co.cluster([obs("firms", lat=15.3, lon=44.2)])
    assert len(clusters) == 1
    assert clusters[0]["corroborated"] is False
    assert co.corroborated_only(clusters) == []


# ── what it says ──────────────────────────────────────────────────────────

def test_the_headline_names_the_sources_not_a_score():
    """'confidence 0.8' is not something a reader can act on."""
    line = co.cluster([obs("firms"), obs("geoconfirmed", hours=2)])[0]["headline"]
    assert "thermal" in line.lower()
    assert "verified" in line.lower() or "report" in line.lower()
    assert "0." not in line.split("within")[0]


def test_the_headline_says_when_a_pair_is_not_independent():
    line = co.cluster([obs("gdelt"), obs("news", hours=1)])[0]["headline"]
    assert "same kind" in line


def test_a_lone_source_is_labelled_uncorroborated():
    assert "uncorroborated" in co.cluster([obs("firms")])[0]["headline"]


def test_every_cluster_can_show_its_working():
    cl = co.cluster([obs("firms"), obs("geoconfirmed", hours=2,
                                       source_url="https://example.com/a")])[0]
    assert len(cl["detail"]) == 2
    assert all("ts" in d and "source" in d for d in cl["detail"])
    assert cl["urls"] == ["https://example.com/a"]


# ── refusing to guess ─────────────────────────────────────────────────────

def test_an_observation_without_a_place_cannot_corroborate():
    assert co.normalise({"source": "gdelt", "ts": T0.isoformat()}) is None


def test_an_observation_without_a_time_cannot_corroborate():
    """Corroboration is a claim about coincidence in time as well as space."""
    assert co.normalise({"source": "firms", "lat": 1.0, "lon": 2.0}) is None


def test_mixed_timestamp_formats_are_all_understood():
    """Each feed states time its own way; a parse failure would silently
    drop that source out of every cluster."""
    for ts in ("20260919", "2026-09-19", "2026-09-19T12:00:00Z",
               "2026-09-19T12:00:00+00:00"):
        assert co.normalise({"source": "firms", "lat": 1.0, "lon": 2.0, "ts": ts})


def test_nothing_in_nothing_out():
    assert co.cluster([]) == []
    assert co.corroborated_only([]) == []

"""The prior for a pairing. Every constant is measured; these pin it."""
import sqlite3

import dyad_risk as dr


def _db(rows=()):
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE ucdp_history (event_id INTEGER PRIMARY KEY, date TEXT,"
              " violence TEXT, dyad TEXT)")
    for i, (date, dyad) in enumerate(rows):
        c.execute("INSERT INTO ucdp_history VALUES (?,?,?,?)",
                  (i + 1, date, "state-based conflict", dyad))
    c.commit()
    return c


def test_only_government_versus_government_counts_as_interstate():
    # "Government of Sudan - SPLM/A" is a civil war, not an interstate
    # dyad, and counting it would put every insurgency into the prior.
    assert dr._sides("Government of India - Government of Pakistan")
    assert dr._sides("Government of Sudan - SPLM/A") is None
    assert dr._sides("nonsense") is None


def test_a_coalition_expands_to_every_pair():
    g = dr._sides("Government of United Kingdom, Government of United States of "
                  "America - Government of Iraq")
    assert g[0] == ["United Kingdom", "United States of America"]
    assert g[1] == ["Iraq"]


def test_a_pairing_with_no_border_and_no_history_is_almost_nothing():
    # The whole point: Russia attacking Burundi must not render with the
    # same confidence as Russia attacking Estonia.
    far = dr.annual_probability(contiguous=False, years_since_conflict=None)
    near = dr.annual_probability(contiguous=True, years_since_conflict=None)
    assert far["annual"] < 0.001
    assert near["annual"] / far["annual"] > 30


def test_having_fought_dominates_everything_else():
    # Interstate conflict is sticky: a dyad with history is three orders
    # of magnitude more likely to fight than one without.
    fought = dr.annual_probability(contiguous=True, years_since_conflict=1)
    never = dr.annual_probability(contiguous=True, years_since_conflict=None)
    assert fought["annual"] > 0.5
    assert fought["annual"] / never["annual"] > 30


def test_recurrence_decays_slowly_and_never_to_zero():
    a = dr.annual_probability(contiguous=True, years_since_conflict=1)["annual"]
    b = dr.annual_probability(contiguous=True, years_since_conflict=5)["annual"]
    c = dr.annual_probability(contiguous=True, years_since_conflict=40)["annual"]
    assert a > b > 0.3
    assert c >= 0.35          # shallow: still 40% after a decade


def test_tension_moves_the_prior_but_never_decides_it():
    # The risk index is a nowcast of unrest, not a measure of interstate
    # intent; letting it dominate turns a busy news week into a warning.
    calm = dr.annual_probability(contiguous=True, years_since_conflict=None,
                                 tension=0.0)["annual"]
    hot = dr.annual_probability(contiguous=True, years_since_conflict=None,
                                tension=1.0)["annual"]
    assert hot / calm <= dr.TENSION_MAX_LIFT + 1e-9
    assert hot < 0.1          # tension alone cannot manufacture a war


def test_nothing_is_certain_and_nothing_is_zero():
    hi = dr.annual_probability(contiguous=True, years_since_conflict=1,
                               tension=1.0)["annual"]
    lo = dr.annual_probability(contiguous=False, years_since_conflict=None)["annual"]
    assert hi <= dr.P_CEILING
    assert lo >= dr.P_FLOOR


def test_a_shorter_window_is_a_smaller_probability():
    assert dr.over_months(0.6, 3) < dr.over_months(0.6, 12)
    assert abs(dr.over_months(0.6, 12) - 0.6) < 1e-9
    assert dr.over_months(0, 3) == 0


def test_assess_reads_history_from_the_corpus():
    c = _db([("2024-05-01", "Government of Ruritania - Government of Syldavia")])
    out = dr.assess(c, "Ruritania", "Syldavia", contiguous=True, months=3,
                    now_year=2026)
    assert out["ever_fought"] is True
    assert out["last_year"] == 2024
    assert out["p"] > 0.1
    c.close()


def test_assess_reports_an_unfought_pairing_as_such():
    c = _db([("2024-05-01", "Government of Ruritania - Government of Syldavia")])
    out = dr.assess(c, "Ruritania", "Borduria", contiguous=False, months=3,
                    now_year=2026)
    assert out["ever_fought"] is False
    assert out["p"] < 0.01
    assert any("no interstate fighting" in w for w in out["why"])
    c.close()


def test_it_survives_a_database_with_no_corpus():
    c = sqlite3.connect(":memory:")
    assert dr.interstate_years(c) == {}
    out = dr.assess(c, "A", "B", contiguous=True, months=3)
    assert out["ever_fought"] is False
    c.close()

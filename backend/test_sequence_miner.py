"""Sequence rules: what has followed what, and the discipline that
stops the miner reporting something true and useless.

The central test is the lift one. A miner that only counts "B followed
A" discovers that violence follows violence — perfect support, no
information — and that is the failure mode this has to be proof against.
"""
import sequence_miner as sm


import datetime as _dt


def _ev(t, locale, kind):
    return {"t": t, "locale": locale, "kind": kind}


def _d(offset_days):
    return (_dt.date(2026, 1, 1) + _dt.timedelta(days=offset_days)).isoformat()


def sparse_signal(pairs=10, locale="sudan"):
    """A genuine signal: b follows a, and b is otherwise uncommon.

    Dense fixtures do not test anything. If b appears in every window,
    then "a is followed by b" is true and worthless, the baseline is
    ~1.0, and the miner correctly refuses to report it — which is the
    whole point of lift. A real signal needs b to be RARE except after
    a, and the filler events below are what make the baseline mean
    something.
    """
    evs = []
    for k in range(pairs):
        base = k * 30
        evs.append(_ev(_d(base), locale, "a"))
        evs.append(_ev(_d(base + 1), locale, "b"))
        # Filler, deliberately far from any b.
        for gap in (10, 15, 20):
            evs.append(_ev(_d(base + gap), locale, "c"))
    return evs


class TestFindsARealSequence:
    def test_a_reliable_follower_is_found_with_high_lift(self):
        out = sm.mine(sparse_signal(), window_days=7, min_support=3, min_consequent=1)
        rule = next(r for r in out["rules"]
                    if r["if_this"] == "a" and r["then_this"] == "b")
        assert rule["support"] == 10
        assert rule["confidence"] == 1.0
        assert rule["lift"] > 2.0

    def test_the_basis_states_the_counts_a_reader_needs(self):
        r = sm.mine(sparse_signal(), window_days=7, min_support=3,
                    min_consequent=1)["rules"][0]
        assert "of" in r["basis"] and "within 7 days" in r["basis"]
        assert "Not a cause" in r["caveat"]


class TestRejectsTheUselesslyTrue:
    def test_a_merely_common_follower_is_dropped_on_lift(self):
        # "b" happens constantly, so it follows everything. Support is
        # excellent and the rule says nothing.
        evs = []
        for i in range(1, 27):
            evs.append(_ev(f"2026-01-{i:02d}", "x", "b"))
        evs += [_ev("2026-01-05", "x", "a"), _ev("2026-01-12", "x", "a"),
                _ev("2026-01-19", "x", "a")]
        out = sm.mine(evs, window_days=7, min_support=3, min_lift=1.25, min_consequent=1)
        assert not [r for r in out["rules"]
                    if r["if_this"] == "a" and r["then_this"] == "b"], \
            "a rule explained entirely by base rate survived"

    def test_support_alone_is_not_enough(self):
        evs = [_ev(f"2026-01-{i:02d}", "x", "common") for i in range(1, 29)]
        out = sm.mine(evs, window_days=7, min_support=3, min_lift=1.25, min_consequent=1)
        # common -> common has enormous support and lift 1.0 by definition.
        assert all(r["lift"] >= 1.25 for r in out["rules"])


class TestScopingAndDirection:
    def test_sequences_do_not_cross_places(self):
        # A strike in Sudan does not follow a strike in Ukraine because
        # the dates line up.
        evs = [_ev("2026-01-01", "ukraine", "a"), _ev("2026-01-02", "sudan", "b")] * 6
        out = sm.mine(evs, window_days=7, min_support=3, min_consequent=1)
        assert not [r for r in out["rules"] if r["if_this"] == "a" and r["then_this"] == "b"]

    def test_only_what_came_after_counts(self):
        # b always precedes a by one day, so with a one-day window only
        # "b then a" can be true. (At window=2 "a then b" is ALSO true,
        # because the next b is two days after each a — which is the
        # miner being right and an earlier version of this test being
        # wrong about its own fixture.)
        evs = []
        for i in range(8):
            evs.append(_ev(f"2026-01-{i*3+1:02d}", "x", "b"))
            evs.append(_ev(f"2026-01-{i*3+2:02d}", "x", "a"))
        out = sm.mine(evs, window_days=1, min_support=3, min_consequent=1)
        names = {(r["if_this"], r["then_this"]) for r in out["rules"]}
        assert ("b", "a") in names
        assert ("a", "b") not in names

    def test_the_window_is_respected(self):
        # a, then b three days later; the next a is a week after that b,
        # so at window=1 nothing is inside anything and at window=5 only
        # "a then b" can be.
        evs = []
        for i in range(3):
            evs.append(_ev(f"2026-01-{i * 10 + 1:02d}", "x", "a"))
            evs.append(_ev(f"2026-01-{i * 10 + 4:02d}", "x", "b"))
        assert not sm.mine(evs, window_days=1, min_support=3, min_consequent=1)["rules"]
        wide = sm.mine(evs, window_days=5, min_support=3, min_consequent=1)["rules"]
        assert {(r["if_this"], r["then_this"]) for r in wide} == {("a", "b")}

    def test_a_flurry_counts_once_per_opportunity(self):
        # Twenty b's after one a must not make a look twenty times
        # more predictive than it is.
        evs = [_ev("2026-01-01", "x", "a")]
        evs += [_ev("2026-01-02", "x", "b")] * 20
        evs += [_ev("2026-02-01", "x", "a"), _ev("2026-02-02", "x", "b")]
        evs += [_ev("2026-03-01", "x", "a"), _ev("2026-03-02", "x", "b")]
        out = sm.mine(evs, window_days=5, min_support=1, min_lift=0.0, min_consequent=1)
        r = next(x for x in out["rules"] if x["if_this"] == "a" and x["then_this"] == "b")
        assert r["support"] == 3, f"expected one per opportunity, got {r['support']}"
        assert r["confidence"] <= 1.0


class TestRobustness:
    def test_unusable_rows_are_skipped_not_fatal(self):
        evs = [_ev(None, "x", "a"), _ev("2026-01-01", None, "a"),
               _ev("2026-01-01", "x", None), _ev("not-a-date", "x", "a")]
        out = sm.mine(evs, min_consequent=1)
        assert out["rules"] == [] and out["events_considered"] == 0

    def test_what_follows_selects_and_orders(self):
        rules = sm.mine(sparse_signal(), window_days=7, min_support=3,
                        min_consequent=1)["rules"]
        got = sm.what_follows(rules, "a")
        assert got and all(r["if_this"] == "a" for r in got)
        assert sm.what_follows(rules, "nothing_like_this") == []


class TestRareConsequentsDoNotManufactureLift:
    def test_a_handful_of_rows_cannot_produce_an_enormous_lift(self):
        # Measured on the real corpus: mining 74,809 GeoConfirmed events
        # produced "lift 41,383" for a faction appearing ~26 times,
        # because dividing by a ~3e-5 base rate manufactures a huge
        # number from almost nothing. A reader seeing that number
        # correctly stops trusting the panel.
        evs = [_ev(f"2026-01-{i:02d}", "x", "common") for i in range(1, 29)]
        evs += [_ev("2026-02-01", "x", "trigger"), _ev("2026-02-02", "x", "vanishing"),
                _ev("2026-03-01", "x", "trigger"), _ev("2026-03-02", "x", "vanishing"),
                _ev("2026-04-01", "x", "trigger"), _ev("2026-04-02", "x", "vanishing")]
        out = sm.mine(evs, window_days=5, min_support=3, min_consequent=20)
        assert not [r for r in out["rules"] if r["then_this"] == "vanishing"]
        assert all(r["lift"] < 1000 for r in out["rules"])

    def test_a_common_enough_consequent_still_produces_a_rule(self):
        # 22 b's, so the guard's threshold is satisfied honestly.
        out = sm.mine(sparse_signal(pairs=22), window_days=7,
                      min_support=3, min_consequent=20)
        assert [r for r in out["rules"] if r["if_this"] == "a" and r["then_this"] == "b"]

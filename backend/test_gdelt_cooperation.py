"""Cooperation events must enter the system, and must stay off the map.

The ontology could not express an alliance because CAMEO 03-07 were
dropped at ingest. Admitting them is what makes "A visited B, B supplies
C" representable at all — but a state visit is a relationship, not an
incident, and the threat surface is for incidents.
"""
import gdelt_events as ge


def _ev(root, code, mentions=8, sources=3, goldstein=7.0):
    return {"event_root_code": root, "event_code": code,
            "mentions": mentions, "sources": sources, "goldstein": goldstein}


class TestCooperationIsAdmitted:
    def test_a_visit_passes(self):
        # CAMEO 042. Previously dropped outright.
        assert ge._passes_filter(_ev("04", "042")) is True

    def test_military_aid_and_cooperation_pass(self):
        assert ge._passes_filter(_ev("07", "072")) is True
        assert ge._passes_filter(_ev("06", "062")) is True

    def test_corroboration_is_still_required(self):
        # One coded report of a visit is one wire story.
        assert ge._passes_filter(_ev("04", "042", mentions=1)) is False

    def test_statements_and_appeals_stay_out(self):
        # A press release is not a relationship.
        assert ge._passes_filter(_ev("01", "010")) is False
        assert ge._passes_filter(_ev("02", "020")) is False

    def test_conflict_codes_still_pass(self):
        assert ge._passes_filter(_ev("19", "190", goldstein=-9.0)) is True
        assert ge._passes_filter(_ev("13", "130", goldstein=-4.0)) is True


class TestCooperationIsNotAnIncident:
    def test_the_root_sets_are_disjoint(self):
        assert not (ge.COOPERATION_ROOT_CODES & ge.KINETIC_ROOT_CODES)
        assert not (ge.COOPERATION_ROOT_CODES & ge.VERBAL_ROOT_CODES)

    def test_cooperation_roots_are_in_the_relevant_set(self):
        assert ge.COOPERATION_ROOT_CODES <= ge.RELEVANT_ROOT_CODES

    def test_the_pin_rule_excludes_cooperation_in_source(self):
        # The pinnable expression is built inside the row mapper, so this
        # asserts the rule itself rather than re-deriving a whole row:
        # a map pin must not be a diplomatic visit.
        import inspect
        src = inspect.getsource(ge)
        assert "event_root_code not in COOPERATION_ROOT_CODES" in src

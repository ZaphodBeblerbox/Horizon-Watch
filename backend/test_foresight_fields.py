"""
Foresight reads real columns, or it is dead and says nothing.

`_gather_zone_intelligence` referenced `Alert.domain` and
`Alert.rule_name`. Neither has ever existed, so the first alert in range
raised AttributeError, the background loop swallowed it into one log line
— "[foresight] loop error: 'Alert' object has no attribute 'domain'" —
and the whole feature produced nothing, indefinitely, with no other
symptom. That is this codebase's most expensive recurring defect:
a producer/consumer name mismatch inside a background task.

A unit test with a mock would have passed throughout, because the mock
would have had whatever attribute the code asked for. These assert
against the real ORM models instead.
"""
import ast
import pytest

import foresight_engine as fe
from database import Alert, FusionEvent, NewsArticle


def _columns(model):
    return ({c.name for c in model.__table__.columns}
            | set(getattr(model, "__mapper__").relationships.keys()))


def test_alert_has_the_fields_foresight_asks_it_for():
    cols = _columns(Alert)
    # The two that were wrong, and what they were corrected to.
    assert "domain" not in cols and "rule_name" not in cols, (
        "If these exist now, the mapping below should go back to them")
    assert "source" in cols
    assert "alert_type" in cols


@pytest.mark.parametrize("model", [Alert, FusionEvent, NewsArticle])
def test_every_attribute_read_off_a_model_row_exists(model):
    """Walk the source for attribute reads on the loop variables that hold
    rows of each model, and check each name against the real table."""
    src = ast.parse(open(fe.__file__).read())
    # Which loop variable holds which model, as written in the file today.
    holder = {Alert: "a", FusionEvent: "f", NewsArticle: "a"}[model]
    # NewsArticle and Alert share the name `a` in different comprehensions,
    # so accept a name that exists on EITHER when they collide.
    allowed = _columns(model)
    if holder == "a":
        allowed |= _columns(Alert) | _columns(NewsArticle)

    missing = set()
    for node in ast.walk(src):
        if (isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id == holder
                and not node.attr.startswith("_")
                and node.attr not in allowed):
            missing.add(node.attr)
    assert not missing, f"{model.__name__} rows read via `{holder}`: {sorted(missing)}"


def test_gathering_against_the_real_database_does_not_raise():
    # The end the loop actually exercises. If this raises AttributeError,
    # foresight is dead in production and nothing else will say so.
    from database import get_db
    with get_db() as db:
        out = fe._gather_zone_intelligence("SZONE-004", "Baltic", db)
    assert isinstance(out, dict)
    for key in ("alerts_7d", "active_fusions", "news_articles_30d"):
        assert key in out

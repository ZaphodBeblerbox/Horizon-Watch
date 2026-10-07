import telegram_ingest as t


def test_a_gathering_after_the_post_is_an_announcement():
    assert t.is_announcement("protest march", "2026-10-17T16:00", "2026-10-06T20:31:00+00:00")
    assert t.is_announcement("demonstration", "2026-10-07", "2026-10-06T18:47:00+00:00")
    assert t.is_announcement("demonstration", "2026-10-07T11:00", "2026-10-06T21:00:00+00:00")   # "demain 11h"


def test_reports_and_non_gatherings_are_not():
    assert not t.is_announcement("rally", "2026-10-04", "2026-10-04T04:35:00+00:00")           # same day, no hour: a report
    assert not t.is_announcement("vigil", "2026-10-06T18:30", "2026-10-06T20:48:00+00:00")     # a recording of last night
    assert not t.is_announcement("construction of crossings", "2026-10-11", "2026-10-04T03:14:00+00:00")
    assert not t.is_announcement("training session", "2026-10-09", "2026-10-05T06:44:00+00:00")
    assert not t.is_announcement("protest march", None, "2026-10-05T06:44:00+00:00")


def test_start_dates_are_checked():
    assert t.parse_start("2026-10-17T16:00", "2026-10-06T20:31:00+00:00") == "2026-10-17T16:00"
    assert t.parse_start("2026-10-17", "2026-10-06T20:31:00+00:00") == "2026-10-17"
    assert t.parse_start("2026-09-01", "2026-10-06T20:31:00+00:00") is None     # before the post
    assert t.parse_start("next week", "2026-10-06T20:31:00+00:00") is None
    assert t.parse_start("2027-06-01", "2026-10-06T20:31:00+00:00") is None     # implausibly far


def test_graphic_words():
    assert t.graphic_by_words("Five Palestinians killed in Israeli attack")
    assert t.graphic_by_words(None, "bodies were recovered from the rubble")
    assert not t.graphic_by_words("Malian forces regain control of Kidal")

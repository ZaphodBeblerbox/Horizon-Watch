"""upcoming_gate: an announcement is listed only with a real future time and a named place
(production rows of 2026-10-22/23)."""
import datetime as dt

import upcoming_gate as ug

NOW = dt.datetime(2026, 10, 23, 10, 0, tzinfo=dt.timezone.utc)
PARIS = (48.8676, 2.3631)


def test_future_time():
    assert ug.future_time("2026-10-23T14:30", "2026-10-23T12:30:00Z", "2026-10-08T14:47:34+00:00", NOW)[0]
    assert ug.future_time("2026-10-24", None, None, NOW)[0]                       # a day after today
    ok, why = ug.future_time("2026-10-23", None, None, NOW)                      # today, no time: may be over
    assert not ok and "today" in why
    assert not ug.future_time("2026-10-22", None, None, NOW)[0]
    assert not ug.future_time("2026-10-22T08:00", "2026-10-22T06:00:00Z", None, NOW)[0]   # passed
    assert not ug.future_time("", None, None, NOW)[0]
    assert not ug.future_time("soon", None, None, NOW)[0]
    # the post's own clock is not the event's time
    assert not ug.future_time("2026-10-23T12:00", "2026-10-23T12:00:00Z", "2026-10-23T12:00:20+00:00", NOW)[0]


def test_named_place():
    assert ug.named_place("Place de la République, Paris, France", *PARIS, "fr")[0]
    assert ug.named_place("Lyon, France", 45.76, 4.83, "fr")[0]
    ok, why = ug.named_place("Place, Bordeaux, France", 44.84, -0.58, "fr")
    assert not ok and "kind of place" in why
    assert not ug.named_place("", *PARIS)[0]
    assert not ug.named_place("France", 46.6, 2.4, "fr")[0]                      # only a country
    assert not ug.named_place("Lyon, France", None, None, "fr")[0]


def test_listed_and_keep():
    good = {"starts_at": "2026-10-24", "place": "Bastille, Paris, France", "lat": 48.853, "lon": 2.369, "country_code": "fr"}
    bad_place = {**good, "place": "Place, Paris, France"}
    bad_time = {**good, "starts_at": "2026-10-22"}
    assert ug.keep([good, bad_place, bad_time], NOW) == [good]


def test_upcoming_reader_uses_the_gate(monkeypatch):
    import telegram_events
    import telegram_ingest as tg
    good = {"id": "a", "starts_at": "2099-01-02", "place": "Bastille, Paris, France", "lat": 48.853, "lon": 2.369, "country_code": "fr"}
    bare = {**good, "id": "b", "place": "Place, Paris, France"}
    monkeypatch.setattr(telegram_events, "announcements", lambda days: [good, bare])
    monkeypatch.setattr(tg, "_protest_status", lambda items: items)
    assert [x["id"] for x in tg.upcoming(30)] == ["a"]

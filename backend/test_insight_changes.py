import insight_changes as ic


def _e(kind, country, n, lat=15.0, lon=44.0, title="x", days=5):
    return [{"kind": kind, "country": country, "title": f"{title} {i}", "when": f"2026-10-0{1 + i % days}", "bucket": f"2026-10-0{1 + i % days}",
             "key": f"{kind}{country}{title}{i}", "lat": lat + i * 0.001, "lon": lon} for i in range(n)]


def test_escalation_new_activity_and_calm():
    cur = _e("verified", "Sudan", 12, 13.6, 25.3, "Drone strike on El Fasher") + _e("ground", "Mali", 4, 18.4, 1.4, "Clashes in Kidal") + _e("verified", "Ukraine", 3)
    # every kind was being collected in the window before too (else it is not compared)
    prev = _e("verified", "Sudan", 3, 13.6, 25.3) + _e("verified", "Ukraine", 14, 48.0, 37.0) + _e("ground", "Chad", 5, 12.1, 15.0)
    r = ic.compare(cur, prev)
    names = [c["country"] for c in r["escalating"]]
    assert names[0] == "Sudan" and "Mali" in names
    sudan = r["escalating"][0]["indicators"][0]
    assert sudan["dir"] == "up" and sudan["cur"] == 12 and sudan["prev"] == 3 and sudan["ratio"] == 4.0
    mali = next(c for c in r["escalating"] if c["country"] == "Mali")["indicators"][0]
    assert mali["dir"] == "new"
    assert {c["country"] for c in r["calmer"]} == {"Ukraine", "Chad"}      # Chad: 5 reports before, none now
    assert any(h["country"] == "Mali" for h in r["lit_up"])          # Kidal had nothing before


def test_small_numbers_are_not_changes():
    r = ic.compare(_e("verified", "Chad", 2), _e("verified", "Chad", 0))
    assert r["escalating"] == [] and r["calmer"] == []


def test_headline_is_built_from_the_numbers():
    r = ic.compare(_e("verified", "Sudan", 12, title="Drone strike on El Fasher", days=3), _e("verified", "Sudan", 3, days=3))
    r["frontlines"] = []
    h = ic.headline(r, 168)
    assert h[0].startswith("Sudan: verified events 4.0× (12, from 3) in the last 7 days — Drone strike on El Fasher")


def test_a_source_not_collected_before_is_not_an_escalation():
    # Telegram started this week: no baseline, so no "new" surge
    r = ic.compare(_e("ground", "Yemen", 40), _e("verified", "Yemen", 5))
    assert all(i["key"] != "ground" for c in r["escalating"] for i in c["indicators"])
    assert r["coverage"]["ground"]["compared"] is False


def test_counts_are_scaled_to_the_days_collected():
    # 10 a day for 5 days now, 10 a day over only 2 collected days before: no change
    cur = _e("verified", "Sudan", 50, days=5)
    prev = _e("verified", "Sudan", 20, days=2)
    r = ic.compare(cur, prev)
    assert r["escalating"] == []


def test_a_detector_writing_many_rows_counts_once():
    rows = [{"kind": "jamming", "country": "Poland", "title": "GPS", "when": "2026-10-05", "bucket": "2026-10-05", "key": "jcell1", "lat": 54, "lon": 18}] * 500
    r = ic.compare(rows, _e("jamming", "Poland", 1, days=1))
    assert r["escalating"] == []

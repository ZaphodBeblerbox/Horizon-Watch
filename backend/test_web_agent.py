"""The web agent (web_agent.py): research caching and caps, URLs only from the search itself, places resolved
by code, the corroboration rule for placing a signal, enrichment once per incident, the status endpoint's
auth. No test reaches the network: the search and the geocoder are stubbed."""
import datetime as dt
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import web_agent as wa

NOW = dt.datetime(2026, 10, 23, 20, 0, tzinfo=dt.timezone.utc)
TRAPPES = (48.7775, 2.0025)
PLACES = {
    "trappes": {"lat": TRAPPES[0], "lon": TRAPPES[1], "class": "place", "type": "town",
                "display_name": "Trappes, Yvelines, Île-de-France, France", "importance": 0.5,
                "address": {"country_code": "fr"}},
    "lyon": {"lat": 45.764, "lon": 4.8357, "class": "place", "type": "city",
             "display_name": "Lyon, Rhône, France", "importance": 0.7, "address": {"country_code": "fr"}},
}


def geocode(q):
    key = q.split(",")[0].strip().lower()
    return [PLACES[key]] if key in PLACES else []


def iso(minutes_ago):
    return (NOW - dt.timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def finding(url, title, place="Trappes", act="shots_fired", ago=40, level="city"):
    return {"title": title, "url": url, "source": url.split("/")[2], "published_at": iso(ago),
            "summary": f"{title}.", "place": place, "place_level": level, "place_context": ["Yvelines", "France"],
            "act": act, "event_time": iso(ago + 10)}


class Search:
    """A stub of the Responses call: returns the given findings and says the search returned their URLs."""
    def __init__(self, findings, extra_urls=(), note="Shots were fired in Trappes."):
        self.findings, self.extra, self.note, self.calls = findings, list(extra_urls), note, 0

    def __call__(self, client, instructions, prompt, loc=None):
        self.calls += 1
        urls = {f["url"]: "" for f in self.findings if not f.get("_invented")}
        urls.update({u: "" for u in self.extra})
        return {"text": json.dumps({"findings": [{k: v for k, v in f.items() if k != "_invented"} for f in self.findings],
                                    "note": self.note}),
                "urls": urls, "input_tokens": 9000, "output_tokens": 500, "searches": 1, "model": "gpt-4.1-mini"}


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(wa, "_db_path", lambda: str(tmp_path / "wa.db"))
    monkeypatch.setattr(wa, "_client", lambda: object())
    monkeypatch.setattr(wa, "_record_usage", lambda *a, **k: None)
    monkeypatch.setattr(wa, "ENABLED", True)
    monkeypatch.setattr(wa, "_geocoder", lambda: geocode)
    import openai_gate
    monkeypatch.setattr(openai_gate, "note_ok", lambda: None)
    yield


def run(q="what happened at Trappes", **kw):
    return wa._research(q, now=NOW, geocode=geocode, **kw)


# ── research ────────────────────────────────────────────────────────────────

def test_research_returns_verified_findings_with_code_resolved_places(monkeypatch):
    s = Search([finding("https://www.leparisien.fr/a?utm_source=x", "Shots fired in Trappes")])
    monkeypatch.setattr(wa, "_search", s)
    out = run(place="Trappes, Yvelines")
    assert len(out["findings"]) == 1
    f = out["findings"][0]
    assert (f["lat"], f["lon"]) == TRAPPES and f["domain"] == "leparisien.fr" and f["level"] == "city"
    assert set(["title", "url", "source", "published_at", "summary", "lat", "lon", "place"]) <= set(f)
    assert out["spent_usd"] > 0.01 and out["note"]


def test_public_signature_and_never_raises(monkeypatch):
    monkeypatch.setattr(wa, "_search", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    out = wa.research("what happened at Trappes", lat=48.7, lon=2.0, place="Trappes", since_hours=6, user=None)
    assert out["findings"] == [] and out["spent_usd"] == 0.0 and "failed" in out["note"]


def test_an_invented_url_is_dropped(monkeypatch):
    f = finding("https://made-up.example/story", "Invented")
    f["_invented"] = True
    monkeypatch.setattr(wa, "_search", Search([f, finding("https://lemonde.fr/x", "Real one")]))
    out = run()
    assert [x["url"] for x in out["findings"]] == ["https://lemonde.fr/x"]


def test_unresolvable_place_keeps_no_coordinates(monkeypatch):
    monkeypatch.setattr(wa, "_search", Search([finding("https://lemonde.fr/x", "Somewhere", place="Nowhereville")]))
    f = run()["findings"][0]
    assert f["lat"] is None and f["lon"] is None


def test_cache_per_query_place_and_day(monkeypatch):
    s = Search([finding("https://lemonde.fr/x", "Shots")])
    monkeypatch.setattr(wa, "_search", s)
    a = run(place="Trappes")
    b = run(q="  What happened at   TRAPPES ", place="trappes")
    assert s.calls == 1 and b["cached"] and b["spent_usd"] == 0.0 and b["findings"] == a["findings"]
    wa._research("what happened at Trappes", place="Trappes", now=NOW + dt.timedelta(days=1), geocode=geocode)
    assert s.calls == 2                                       # a new day asks again
    run(place="Lyon")
    assert s.calls == 3                                       # another place asks again


def test_per_user_daily_cap(monkeypatch):
    monkeypatch.setattr(wa, "_search", Search([]))
    monkeypatch.setattr(wa, "USER_PER_DAY", 2)
    for i in range(2):
        assert "limit" not in run(q=f"question {i}", user={"id": "u1"})["note"]
    out = run(q="question 3", user={"id": "u1"})
    assert out["findings"] == [] and "limit" in out["note"]
    assert "limit" not in run(q="question 3", user={"id": "u2"})["note"]


def test_global_daily_usd_cap(monkeypatch):
    s = Search([])
    monkeypatch.setattr(wa, "_search", s)
    monkeypatch.setattr(wa, "DAILY_USD", 0.025)
    run(q="one")
    out = run(q="two")
    assert s.calls == 1 and "daily budget" in out["note"]


def test_per_call_cap(monkeypatch):
    s = Search([])
    monkeypatch.setattr(wa, "_search", s)
    monkeypatch.setattr(wa, "MAX_CALL_USD", 0.001)
    assert "per-call cap" in run()["note"] and s.calls == 0


def test_no_model_means_no_call(monkeypatch):
    s = Search([])
    monkeypatch.setattr(wa, "_search", s)
    monkeypatch.setattr(wa, "_client", lambda: None)
    assert "unavailable" in run()["note"] and s.calls == 0


# ── corroboration ───────────────────────────────────────────────────────────

def _found(*fs):
    out, _ = wa.verify_findings({"findings": list(fs)}, {f["url"]: "" for f in fs}, now=NOW, geocode=geocode)
    return out


def test_one_source_is_rejected():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes")), NOW)
    assert acc == [] and rej[0]["reason"] == "one source"


def test_two_from_the_same_domain_are_rejected():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes tonight"),
                                     finding("https://www.lemonde.fr/b", "Police hunt gunman after Trappes shooting")), NOW)
    assert acc == [] and rej[0]["reason"] == "same domain"


def test_reposts_count_once():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes, one man wounded"),
                                     finding("https://lefigaro.fr/b", "Shots fired in Trappes: one man wounded")), NOW)
    assert acc == [] and rej[0]["reason"] == "reposts of one story"


def test_social_media_is_not_a_source():
    acc, _ = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes"),
                                   finding("https://x.com/someone/status/1", "Gunfire heard near the station")), NOW)
    assert acc == []


def test_two_independent_sources_are_accepted():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes"),
                                     finding("https://bfmtv.com/b", "Police hunt gunman after shooting near station", ago=20)), NOW)
    assert len(acc) == 1 and rej == []
    a = acc[0]
    assert a["n_sources"] == 2 and set(a["domains"]) == {"lemonde.fr", "bfmtv.com"} and (a["lat"], a["lon"]) == TRAPPES


def test_unresolvable_place_is_rejected():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots", place="Nowhereville"),
                                     finding("https://bfmtv.com/b", "Gunfire", place="Nowhereville")), NOW)
    assert acc == [] and {r["reason"] for r in rej} == {"place not resolvable to a specific point"}


def test_region_level_is_not_a_point():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots", level="region"),
                                     finding("https://bfmtv.com/b", "Gunfire", level="region")), NOW)
    assert acc == []


def test_old_incident_is_rejected():
    acc, rej = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots", ago=600),
                                     finding("https://bfmtv.com/b", "Gunfire", ago=590)), NOW)
    assert acc == [] and rej[0]["reason"] == "outside the time window"


def _accepted():
    acc, _ = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes"),
                                   finding("https://bfmtv.com/b", "Police hunt gunman", ago=20)), NOW)
    return acc


def test_a_new_incident_is_placed_as_a_web_signal_on_the_live_layer():
    out = wa.place_incidents(_accepted(), signals=[], now=NOW, support=lambda *a: {"telegram_posts": 1, "news_items": 0})
    assert len(out["placed"]) == 1
    sigs = wa.decorate([], now=NOW)
    assert len(sigs) == 1
    s = sigs[0]
    assert s["source_kind"] == "web" and s["kind"] == "live_signal" and s["act"] == "shots_fired"
    assert s["corroboration"]["line"].startswith("Corroborated by 2 sources") and "Telegram" in s["corroboration"]["line"]
    assert len(s["citations"]) == 2 and s["title"].startswith("Shots fired at Trappes")


def test_a_duplicate_of_an_existing_signal_is_merged():
    tg = {"id": "ls-chan-1", "kind": "live_signal", "act": "shots_fired", "lat": TRAPPES[0] + 0.005, "lon": TRAPPES[1],
          "event_time": iso(30), "first_event_time": iso(45),
          "corroboration": {"level": "unverified", "n_sources": 1, "line": "1 source, unverified"}, "muted": True}
    out = wa.place_incidents(_accepted(), signals=[tg], now=NOW, support=lambda *a: {})
    assert out["placed"] == [] and out["merged"] == ["ls-chan-1"]
    sigs = wa.decorate([tg], now=NOW)
    assert len(sigs) == 1                                     # no second marker
    s = sigs[0]
    assert s["corroboration"]["n_sources"] == 3 and s["muted"] is False
    assert len(s["web_context"]["findings"]) == 2
    assert tg["muted"] is True                                # the input is not mutated


def test_a_repeat_of_a_web_signal_updates_it():
    wa.place_incidents(_accepted(), signals=[], now=NOW, support=lambda *a: {})
    acc, _ = wa.corroborate(_found(finding("https://lemonde.fr/a", "Shots fired in Trappes"),
                                   finding("https://francebleu.fr/c", "Trappes: gunman sought", ago=10)), NOW)
    out = wa.place_incidents(acc, signals=[], now=NOW, support=lambda *a: {})
    assert out["placed"] == []
    sigs = wa.decorate([], now=NOW)
    assert len(sigs) == 1 and sigs[0]["corroboration"]["n_sources"] == 3


def test_autoplace_is_off_by_default():
    assert wa.autoplace_once(now=NOW, watch={"points": [{"lat": 48.8, "lon": 2.0, "reach": 50}]})["skipped"].startswith("off")


def test_autoplace_end_to_end(monkeypatch):
    monkeypatch.setattr(wa, "_search", Search([finding("https://lemonde.fr/a", "Shots fired in Trappes"),
                                               finding("https://bfmtv.com/b", "Police hunt gunman", ago=20)]))
    w = {"points": [{"lat": 48.8, "lon": 2.05, "reach": 50, "name": "Paris Watch"}]}
    out = wa.autoplace_once(now=NOW, watch=w, signals=[], geocode=geocode, support=lambda *a: {},
                            area_name=lambda *a: "Trappes, France", force=True)
    assert out["accepted"] == 1 and len(out["placed"]) == 1
    again = wa.autoplace_once(now=NOW, watch=w, signals=[], geocode=geocode, force=True)
    assert again["skipped"] == "every area searched recently"


# ── enrichment ──────────────────────────────────────────────────────────────

def sig(**kw):
    s = {"id": "ls-chan-7", "kind": "live_signal", "act": "shots_fired", "place": "Trappes", "context": ["Yvelines"],
         "lat": TRAPPES[0], "lon": TRAPPES[1], "event_time": iso(15), "first_event_time": iso(15)}
    s.update(kw)
    return s


WATCH = {"points": [{"lat": 48.85, "lon": 2.35, "reach": 60, "name": "Paris Watch"}], "countries": {"france"}}


def test_enrichment_runs_once_per_incident_and_shows_on_read(monkeypatch):
    s = Search([finding("https://lemonde.fr/a", "Shots fired in Trappes")])
    monkeypatch.setattr(wa, "_search", s)
    out = wa.enrich_once(now=NOW, signals=[sig()], watch=WATCH, geocode=geocode)
    assert out["enriched"] == 1 and s.calls == 1
    wa.enrich_once(now=NOW, signals=[sig()], watch=WATCH, geocode=geocode)
    wa.enrich_once(now=NOW, signals=[sig(id="ls-other-9")], watch=WATCH, geocode=geocode)   # same incident, new id
    assert s.calls == 1
    got = wa.decorate([sig()], now=NOW)[0]
    assert got["web_context"]["findings"][0]["url"] == "https://lemonde.fr/a"
    assert "Trappes" in got["web_context"]["query"]


def test_enrichment_only_where_watched_and_important(monkeypatch):
    s = Search([])
    monkeypatch.setattr(wa, "_search", s)
    far = {"points": [{"lat": 50.45, "lon": 30.52, "reach": 50, "name": "Kyiv"}], "countries": {"france"}}
    assert wa.enrich_once(now=NOW, signals=[sig()], watch=far)["considered"] == 0      # a watched country is not enough
    assert wa.enrich_once(now=NOW, signals=[sig(act="crowd_movement")], watch=WATCH)["considered"] == 0
    assert wa.enrich_once(now=NOW, signals=[sig(event_time=iso(1), first_event_time=iso(1))], watch=WATCH)["considered"] == 0
    assert wa.enrich_once(now=NOW, signals=[sig()], watch={"open": True, "points": []})["considered"] == 0
    assert s.calls == 0


def test_enrichment_rate_limit(monkeypatch):
    s = Search([])
    monkeypatch.setattr(wa, "_search", s)
    monkeypatch.setattr(wa, "ENRICH_PER_HOUR", 1)
    wa.enrich_once(now=NOW, signals=[sig()], watch=WATCH, geocode=geocode)
    out = wa.enrich_once(now=NOW, signals=[sig(id="ls-b-2", lat=48.86, lon=2.30)], watch=WATCH, geocode=geocode)
    assert out["skipped"] == "enrichment cap" and s.calls == 1


def test_a_capped_enrichment_is_retried_later(monkeypatch):
    monkeypatch.setattr(wa, "_client", lambda: None)
    wa.enrich_once(now=NOW, signals=[sig()], watch=WATCH)
    monkeypatch.setattr(wa, "_client", lambda: object())
    s = Search([])
    monkeypatch.setattr(wa, "_search", s)
    assert wa.enrich_once(now=NOW, signals=[sig()], watch=WATCH, geocode=geocode)["enriched"] == 1


# ── helpers and the endpoint ────────────────────────────────────────────────

def test_domains():
    assert wa.domain_of("https://www.bbc.co.uk/news/1") == "bbc.co.uk"
    assert wa.domain_of("https://edition.cnn.com/x") == "cnn.com"
    assert wa.blocked("news.google.com") and wa.blocked("x.com") and not wa.blocked("lemonde.fr")


def test_status_needs_a_signed_in_user(monkeypatch):
    from routers import web_agent as r

    def me(request):
        if not request.headers.get("x-test-user"):
            raise HTTPException(401, "authentication required")
        return {"id": request.headers["x-test-user"]}
    monkeypatch.setattr(r, "_me", me)
    app = FastAPI()
    app.include_router(r.router)
    c = TestClient(app)
    assert c.get("/api/web-agent/status").status_code == 401
    res = c.get("/api/web-agent/status", headers={"x-test-user": "anna"})
    assert res.status_code == 200
    body = res.json()
    assert {"spent_today_usd", "calls_today", "last_error", "enriched_24h", "web_signals_24h", "caps"} <= set(body)

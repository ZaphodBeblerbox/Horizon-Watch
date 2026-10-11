"""endangered_sources.py — the other countries' adapters on small recordings
of the real answers (backend/tests_fixtures/endangered/, fetched
2026-10-11/12; rows marked INJECTED in the fixture script carry made-up
personal data to prove it is dropped), the level mapping, privacy, the
keep-the-last-copy rule, the alerts (no flood) and the per-user cards."""
import datetime as dt
import json
from pathlib import Path

import pytest

import endangered_places as ep
import endangered_sources as es

UTC = dt.timezone.utc
FX = Path(__file__).parent / "tests_fixtures" / "endangered"
NOW = dt.datetime(2026, 10, 12, 10, 0, tzinfo=UTC)


def fx(name: str) -> bytes:
    return (FX / name).read_bytes()


def calls(places):
    return [c for p in places for c in p["calls"]]


# ── each adapter ─────────────────────────────────────────────────────────

def test_berlin_notified_assemblies():
    ps = es.parse_berlin(fx("berlin.json"))
    assert all(p["country"] == "DE" and p["kind"] == "assembly" and p["geo"]["box"] == list(es.BERLIN_BOX)
               or p["geo"]["box"] == es.BERLIN_BOX for p in ps)
    cs = calls(ps)
    assert all(c["basis"] == "announced" and c["verb"] == "notified" for c in cs)
    assert {c["level"] for c in cs if c["kind"] != "blockade"} == {"medium"}
    block = [c for c in cs if c["kind"] == "blockade"]
    assert len(block) == 1 and block[0]["level"] == "high" and block[0]["supply"] is True   # a blockade at the Westhafen
    assert any(c["kind"] == "march" and c.get("route") for c in cs)                          # a march with its route
    # the "(vom … bis …)" range is cut from the topic; times kept
    assert not any("(vom" in (c.get("topic") or "") for c in cs)
    west = next(p for p in ps if "Westhafen" in p["name"])
    assert west["geo"]["qs"][0] == "Westhafenstr. 1, 13353 Berlin"


def test_italy_mit_strikes_levels_and_places():
    ps = {p["sid"]: p for p in es.parse_mit(fx("mit.xml"))}
    it = ps["IT"]
    assert it["name"] == "Italy (nationwide)" and (it["lat"], it["lon"]) == es.ITALY
    freight = next(c for c in it["calls"] if c["kind"] == "strike_trasporto_merci")
    assert freight["level"] == "high" and freight["supply"] and freight["label_en"] == "Freight transport strike"
    assert freight["date"] == "2026-10-13" and freight["end_date"] == "2026-10-14" and freight["time"] == "06:00"
    assert freight["verb"] == "proclaimed" and "SBB CARGO" in freight["topic"]
    bari = ps["prov:bari"]
    assert bari["kind"] == "strike" and bari["lat"] is None and bari["geo"]["fallback"] == list(es.IT_REGIONS["puglia"])
    tpl = bari["calls"][0]
    assert tpl["level"] == "medium" and tpl["time"] == "08:30" and "supply" not in tpl
    tos = ps["reg:toscana"]
    assert tos["calls"][0]["label_en"] == "General strike" and tos["calls"][0]["level"] == "high"
    assert (tos["lat"], tos["lon"]) == es.IT_REGIONS["toscana"] and tos["reach_km"] == 140.0
    assert ps["prov:napoli"]["calls"][0]["label_en"] == "Maritime and port strike"
    air = [c for c in calls(ps.values()) if c["kind"] == "strike_aereo"]
    assert air and all(c["level"] == "medium" for c in air)


def test_caat_who_arms_israel():
    ps = es.parse_caat(fx("caat.html"))
    assert ps and all(p["country"] == "GB" and p["kind"] == "arms_company" and p["calls"] == [] for p in ps)
    bae = [p for p in ps if p["operator"].startswith("BAE Systems")]
    assert len(bae) >= 3 and any("F-35" in p["name"] for p in bae)
    assert all("CAAT" in p["note"] and "no dated call" in p["note"] for p in ps)
    office = next(p for p in ps if p["name"].endswith("registered office"))
    assert "export licence" in office["note"]


def test_dresden():
    ps = es.parse_dresden(fx("dresden.json"))
    cs = calls(ps)
    assert all(p["city"] == "Dresden" for p in ps)
    b = next(c for c in cs if c["kind"] == "blockade")
    assert b["level"] == "high" and b["expected"] == 1200 and b["notice"] == "notified" and b["supply"]
    first = next(c for c in cs if c["date"] == "2026-10-12" and c["time"] == "19:00")
    assert first["end_time"] == "21:00" and first["notice"] == "decision issued"


def test_xr_uk_actions_only():
    ps = es.parse_xr(fx("xr.js"))
    assert len(ps) == 2                                           # the meetings' address is not a place
    cs = calls(ps)
    assert all(c["tz"] == "Europe/London" for c in cs)
    assert all(c["kind"] in ("vigil", "action", "march", "blockade", "rally") for c in cs)


def test_demosphere_brussels():
    ps = es.parse_demosphere(fx("bxl.ics"), "bxl")
    cs = calls(ps)
    assert cs and all(c["kind"] == "rally" for c in cs)                  # "Rencontre" and "Atelier" left out
    gare = next(p for p in ps if p["name"].startswith("Gare centrale"))
    assert gare["geo"]["fallback"] == list(es.DEMOSPHERE["bxl"]["centre"])
    c = gare["calls"][0]
    assert c["date"] == "2026-10-13" and c["time"] == "18:00" and c["source_url"].startswith("https://bxl.demosphere.net/rv/")


def test_gancio_barcelona():
    ps = es.parse_gancio(fx("bcn.json"), "bcn.convoca.la")
    cs = calls(ps)
    assert cs and all(c["source_url"].startswith("https://bcn.convoca.la/event/") for c in cs)
    assert not any("Taller" in (c.get("topic") or "") or "Muay" in (c.get("topic") or "") for c in cs)


def test_umap_generic_and_discovery():
    name, layers, _lic = es.umap_layers(fx("umap_1096412_map.json"))
    assert name == "Filiera Armi veneto" and layers == [("2c263c38-19fc-4eee-8fa9-2f22087bc4f6", "Layer 1")]
    feats = es.parse_umap_layer(fx("umap_1096412_layer.json"), "Layer 1")
    assert len(feats) == 5 and set(feats[0]) == {"name", "operator", "address", "city", "postcode", "lat", "lon", "layer"}
    ps = es.umap_places(feats, {"country": "IT", "kind": "arms_company"}, name, "u")
    assert all(p["note"] == "Listed by the map “Filiera Armi veneto” as a target for action — no dated call" for p in ps)
    found = es.parse_umap_search(fx("umap_search.html"), "umap.openstreetmap.fr")
    judged = {slug: es.classify_map(slug.replace("-", " "))[0] for _mid, slug in found}
    assert judged["mappatura-la-fabbrica-della-guerra-modena"] is True
    assert judged["cimiteri-militari-della-prima-guerra-mondiale-in-v"] is False
    assert es.classify_map("Entreprises d'armement en France")[0]
    assert es.classify_map("Arms Industry Lobby EU")[0]
    assert not es.classify_map("Stands de tirs habilités pour les formations à l'armement")[0]
    assert es.classify_map("entreprises darmement en france")[0]                       # a slug
    assert not es.classify_map("dalla stazione a piazza darmi")[0]
    assert not es.classify_map("lieux des blocage du 17112018", 2026)[0]               # an old event
    assert es.classify_map("blocage depot petrolier", 2026) == (True, "a call in its title")


# ── privacy (hard rule) ──────────────────────────────────────────────────

FORBIDDEN_KEYS = {"who", "notes", "registration_link", "custom", "veranstalter", "organiser", "organizer", "email",
                  "phone", "telefono", "numero di telefono", "contact", "owner", "editors", "permissions", "user",
                  "ap_user", "apuserapid", "tags", "description", "media"}
FORBIDDEN_TEXT = ("Max Mustermann", "0170 1234567", "max@example.org", "Erika Musterfrau", "natürliche Person",
                  "Jane Doe", "jane.doe@example.org", "07700 900123", "guaspito", "0183854093", "Fernanda Laguna")


def _keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield str(k).lower()
            yield from _keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _keys(v)


def test_no_personal_fields_survive_normalisation():
    out = {
        "berlin": es.parse_berlin(fx("berlin.json")), "mit": es.parse_mit(fx("mit.xml")),
        "caat": es.parse_caat(fx("caat.html")), "dresden": es.parse_dresden(fx("dresden.json")),
        "xr": es.parse_xr(fx("xr.js")), "bxl": es.parse_demosphere(fx("bxl.ics"), "bxl"),
        "bcn": es.parse_gancio(fx("bcn.json"), "bcn.convoca.la"),
        "umap": es.umap_places(es.parse_umap_layer(fx("umap_1096412_layer.json"), "L"), {"country": "IT"}, "M", "u"),
        "umap_meta": list(es.umap_layers(fx("umap_1096412_map.json"))),
    }
    # the recordings DO carry them (so the test means something)
    raw = b"".join(fx(n) for n in ("berlin.json", "dresden.json", "xr.js", "umap_1096412_layer.json",
                                   "umap_1096412_map.json"))
    assert b"Mustermann" in raw and b"Musterfrau" in raw and b"jane.doe@" in raw and b"0183854093" in raw
    assert b"guaspito" in raw and b'"who"' in raw and b"registration_link" in raw
    for name, v in out.items():
        blob = json.dumps(v, ensure_ascii=False)
        for t in FORBIDDEN_TEXT:
            assert t not in blob, f"{t!r} survived in {name}"
        bad = set(_keys(v)) & FORBIDDEN_KEYS
        assert not bad, f"{name} keeps {bad}"
    # the scrubber on its own
    assert es.scrub("Demo, Anmelder Herr Max Mustermann, Tel. 0170 1234567, max@x.org, @someone https://x.y/z") == \
        "Demo, Anmelder, Tel."
    assert es.scrub("Kundgebung 17.30 - 19.00, 1.200 Menschen") == "Kundgebung 17.30 - 19.00, 1.200 Menschen"


# ── storage, build, keep-last-copy, geocoding ────────────────────────────

URLS = {
    es.BERLIN_URL: "berlin.json", es.MIT_URL: "mit.xml", es.CAAT_URL: "caat.html", es.DRESDEN_URL: "dresden.json",
    es.XR_URL: "xr.js", "https://bxl.demosphere.net/events.ics": "bxl.ics",
    "https://bcn.convoca.la/api/events": "bcn.json",
    "https://umap.openstreetmap.fr/en/map/1096412/geojson/": "umap_1096412_map.json",
    "https://umap.openstreetmap.fr/en/datalayer/1096412/2c263c38-19fc-4eee-8fa9-2f22087bc4f6/": "umap_1096412_layer.json",
}


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(ep, "_dir", lambda: tmp_path)
    monkeypatch.setattr(es, "HOST_GAP_S", 0)
    served = dict(URLS)

    def fake(url, cond=None, timeout=30, max_bytes=0):
        if "/en/search/" in url:
            if "umap.openstreetmap.fr" in url and "guerra" in url:
                return fx("umap_search.html"), {}
            if "umap.openstreetmap.fr" in url:
                return b"<html></html>", {}
            raise OSError("refused")
        if url not in served:
            raise OSError("404")
        return fx(served[url]), {"etag": None}
    monkeypatch.setattr(ep, "_fetch", fake)
    looked = []

    def geo(q, cc, box=None):
        looked.append(q)
        return None if "nowhere" in q else (52.5 + len(looked) * 1e-4, 13.4) if cc == "de" else (41.0, 12.0)
    monkeypatch.setattr(es, "geocode_one", geo)
    return {"dir": tmp_path, "served": served, "looked": looked}


def test_refresh_builds_every_country_and_keeps_the_last_copy(sandbox):
    meta = {}
    errors = []
    assert es.refresh_all(meta, NOW, True, errors)
    places, st = es.build_places(meta, NOW)
    by_cc = {}
    for p in places:
        by_cc[p["country"]] = by_cc.get(p["country"], 0) + 1
    assert {"DE", "IT", "GB", "BE", "ES"} <= set(by_cc)
    # every place says where it comes from and how to credit it
    assert all(p["source"] and p["credit"] and p["source_url"] and p["country_name"] for p in places)
    # discovery judged the search page: the Modena map followed, the cemeteries not
    disc = meta["umap_discovered"]
    assert "umap.openstreetmap.fr:1418035" not in disc                  # a seed, read as such
    assert disc["umap.openstreetmap.fr:978911"]["accepted"] is False    # war cemeteries
    # geocoding asked once per address, then from the cache
    n = len(sandbox["looked"])
    assert n > 0
    es.geocode_pending(meta, NOW)
    assert len(sandbox["looked"]) == n
    # a 3-day vigil series in Berlin is one call over its dates
    series = [c for p in places for c in p["calls"] if c.get("dates")]
    assert series and all(len(c["dates"]) >= 2 for c in series)
    # Berlin disappears, Dresden comes back empty: the copies we have stay
    before = {p["id"] for p in places if p["source_key"] in ("de_berlin", "de_dresden")}
    del sandbox["served"][es.BERLIN_URL]
    real = ep._fetch

    def fake2(url, cond=None, timeout=30, max_bytes=0):
        if url == es.DRESDEN_URL:
            return json.dumps({"Versammlungen": []}).encode(), {}
        return real(url, cond, timeout, max_bytes)
    ep._fetch = fake2
    try:
        errors = []
        es.refresh_all(meta, NOW + dt.timedelta(hours=2), True, errors)
    finally:
        ep._fetch = real
    assert any("de_berlin" in e for e in errors) and any("de_dresden" in e and "empty" in e for e in errors)
    places2, _ = es.build_places(meta, NOW + dt.timedelta(hours=2))
    assert before <= {p["id"] for p in places2}
    assert meta["http"]["de_berlin"]["error"]
    rows = {r["key"]: r for r in es.status_rows(meta)}
    assert rows["de_berlin"]["error"] and rows["it_mit"]["ok_at"] and rows["it_mit"]["credit"].startswith("Ministero")


def test_discovered_map_followed_only_while_current(sandbox, monkeypatch):
    meta = {"umap_discovered": {"framacarte.org:35830": {"host": "framacarte.org", "id": 35830, "title": "blocage en cours",
                                                         "accepted": True, "why": "a call in its title"}}}
    old = json.dumps({"type": "Feature", "properties": {"name": "Blocage en cours", "modified_at": "2018-11-20T18:13:47Z",
                                                        "user": {"name": "someone"}, "datalayers": []}}).encode()
    real = ep._fetch
    monkeypatch.setattr(ep, "_fetch", lambda url, *a, **k: (old, {}) if "35830" in url else real(url, *a, **k))
    src = next(s for s in es.all_sources(meta) if s["key"] == "umap:framacarte.org:35830")
    assert src["umap"]["call"] is True
    es.pull(meta, src, NOW, [])
    d = meta["umap_discovered"]["framacarte.org:35830"]
    assert d["accepted"] is False and "2018-11-20" in d["why"]
    assert not [s for s in es.all_sources(meta) if s["key"] == "umap:framacarte.org:35830"]


def test_calls_past_or_far_are_dropped_listed_places_stay(sandbox):
    meta = {}
    es.refresh_all(meta, NOW, True, [])
    later = NOW + dt.timedelta(days=60)
    places, _ = es.build_places(meta, later)
    assert not [p for p in places if p["source_key"] in ("de_berlin", "uk_xr") and p["calls"]]
    assert [p for p in places if p["source_key"] == "uk_caat"]                # listed: still there


# ── derived on read, alerts, cards ───────────────────────────────────────

def _berlin_upcoming(places):
    return next(p for p in places if p["source_key"] == "de_berlin" and p["level"] == "medium"
                and any((c.get("end_date") or c["date"]) >= "2026-10-12" for c in p["calls"]))


@pytest.fixture
def built(sandbox):
    meta = {}
    es.refresh_all(meta, NOW, True, [])
    places, _ = es.build_places(meta, NOW)
    return places


def test_call_lines_in_plain_english(built):
    it = next(p for p in built if p["name"] == "Italy (nationwide)")
    q = ep.annotate(it, NOW)
    line = next(c["line"] for c in q["calls"] if c["kind"] == "strike_trasporto_merci")
    assert line.startswith("Freight transport strike proclaimed for Tue 13 Oct, 06:00 to Wed 14 Oct — “PERSONALE SOC. SBB")
    assert line.endswith("— source: MIT — proclaimed transport strikes (Italy)")
    assert q["alarm"] == "red" and q["status"] == "upcoming"                  # high, within 48 h
    berlin = _berlin_upcoming(built)
    assert ep.annotate(berlin, NOW)["alarm"] == "amber"
    caat = next(p for p in built if p["source_key"] == "uk_caat")
    assert ep.annotate(caat, NOW)["status"] == "listed (no call)" and ep.annotate(caat, NOW)["alarm"] == "grey"


def test_query_country_filter(built):
    data = {"places": built}
    q = ep.query(data=data, now=NOW, country="it")
    assert q["places"] and {p["country"] for p in q["places"]} == {"IT"}
    codes = {r["code"] for r in q["countries"]}
    assert {"DE", "IT", "GB"} <= codes                                         # all countries, whatever the filter
    # Berlin's medium assemblies alone do not switch the layer on by default
    only_berlin = {"places": [p for p in built if p["source_key"] == "de_berlin" and p["level"] == "medium"]}
    assert ep.calls_within(only_berlin, NOW, 7) is False
    assert ep.calls_within({"places": [p for p in built if p["country"] == "IT"]}, NOW, 7) is True


def test_alerts_no_flood(built):
    plan = es.plan(built, {}, NOW)
    ids = [a["id"] for a in plan["new"]]
    countries = [a for a in plan["new"] if a["alert_type"] == es.TYPE_COUNTRY]
    supply = [a for a in plan["new"] if a["alert_type"] == es.TYPE_SUPPLY]
    # a summary only for a country/day with HIGH calls — never for Belgium's rallies or Berlin's vigils
    assert {a["country_code"] for a in countries} <= {"IT", "DE"}
    assert not [a for a in countries if a["country_code"] in ("BE", "GB", "ES")]
    it13 = next(a for a in countries if a["id"] == "EPL-C-IT-20261013")
    assert it13["title"].startswith("Italy: ") and "freight transport strike" in it13["title"]
    # one alert per critical-supply call within 4 days; a far-off strike waits
    assert any(a["title"].startswith("Italy: Freight transport strike proclaimed — Italy nationwide") for a in supply)
    assert not [a for a in supply if "Tue 27 Oct" in a["title"] or "Dec" in a["title"]]
    assert all(a["severity"] == "high" and a["reason"] for a in plan["new"])
    assert len(ids) == len(set(ids))
    sent = {a["id"]: a["_sig"] for a in plan["new"]}
    assert es.plan(built, sent, NOW) == {"new": [], "update": []}


def test_alerts_pass_the_notification_rules(built):
    import event_watch as ew
    import general_feed as gf
    import notification_context as nc
    for a in es.plan(built, {}, NOW)["new"]:
        w = ep.for_writer(a)
        v = nc.notification_relevance({"alert_type": a["alert_type"], "severity": "high", "raw": w,
                                       "lat": a["lat"], "lon": a["lon"], "title": a["title"]})
        assert v["notify"] and v["sev"] == "high" and v["reason"] == a["reason"]
        assert nc.notification_kind(a["alert_type"]) == "signal"
        assert ew.interrupts({"sev": v["sev"], "kind": "signal"})
        assert nc.headline({"alert_type": a["alert_type"], "title": a["title"], "raw": w}) == a["title"]
        assert gf.is_own_alert_type(a["alert_type"]) and gf.is_own_source(a["source"])
        assert not any(ch.isdigit() for ch in a["title"].split(":")[0])                   # never a bare code first
    for t in ep.ALERT_TYPES:
        assert t in gf.EVENT_TYPES


def test_cards_near_assets_and_theaters(built):
    data = {"places": built}
    berlin = _berlin_upcoming(built)
    near = {"assets": [{"lat": berlin["lat"] + 0.01, "lon": berlin["lon"], "radius": 30, "name": "Berlin office",
                        "label": "site"}], "theaters": []}
    cards = ep.cards_for(near, NOW, data)
    assert cards and all(k["kind"] == "announcement" for k in cards)
    k = next(k for k in cards if k["id"].startswith(f"epl:{berlin['id']}"))
    assert "(Germany)" in k["title"] and k["reason"].endswith("from your site Berlin office")
    assert len(cards) <= ep.CAP_NEAR
    # 20 km away: a city assembly is not "near"
    far = {"assets": [{"lat": berlin["lat"] + 0.2, "lon": berlin["lon"], "radius": 30, "name": "X"}], "theaters": []}
    assert not [k for k in ep.cards_for(far, NOW, data) if k["id"].startswith("epl:de_berlin")]
    # an asset in Italy is inside the nationwide strike's area
    rome = {"assets": [{"lat": 41.9, "lon": 12.5, "radius": 5, "name": "Rome depot", "label": "site"}], "theaters": []}
    k = next(k for k in ep.cards_for(rome, NOW, data) if "nationwide" in k["title"])
    assert k["title"].startswith("Italy: ") and "is in the strike's area" in k["reason"]
    # a theater over Italy: one card about the HIGH calls
    th = {"assets": [], "theaters": [{"lat": 42.5, "lon": 12.5, "reach": 700.0, "name": "Italy"}]}
    tcs = [k for k in ep.cards_for(th, NOW, data) if k["id"].startswith("epl-th2:")]
    assert len(tcs) == 1 and "high-disruption call" in tcs[0]["title"] and "Italy" in tcs[0]["title"]

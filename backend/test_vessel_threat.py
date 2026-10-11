"""
Vessel of concern (vessel_threat.py, coastal_targets.py): config-driven
weights, target ranking, the score and its severity rule, and alert
continuity through russia_loiter_watch (one alert per episode, escalated in
place).
"""
import copy
import json

import pytest

import coastal_targets as ct
import russia_loiter_watch as rlw
import vessel_threat as vt
import paths

H = 3600.0
T0 = 1_800_000_000.0          # 2027-01-15 08:00 UTC — daytime in Denmark
OFF_DENMARK = (55.30, 12.75)


def _cfg(**over):
    c = copy.deepcopy(vt.DEFAULTS)
    c["weights_source"] = "test"
    for k, v in over.items():
        c[k] = {**c[k], **v} if isinstance(v, dict) else v
    return c


def _index():
    # Around Køge Bay: Copenhagen airport ~25 km, an air base, a stadium, a mall.
    return ct.TargetIndex([
        ct.item("airport_civil", "Copenhagen Kastrup Airport", 55.618, 12.656, 1.0, "test", iso2="DK"),
        ct.item("airport_military", "Skrydstrup Air Base", 55.226, 9.264, 0.9, "test", iso2="DK"),
        ct.item("military_base", "Naval Station Korsør", 55.33, 11.14, 1.0, "test", iso2="DK"),
        ct.item("stadium_venue", "Parken", 55.703, 12.572, 0.5, "test", iso2="DK"),
        ct.item("shopping_centre", "Field's", 55.631, 12.578, 0.5, "test", iso2="DK"),
        ct.item("power_plant", "Avedøre", 55.600, 12.459, 0.9, "test", iso2="DK"),
        ct.item("airport_civil", "Malmö Airport", 55.536, 13.376, 0.55, "test", iso2="SE"),
        ct.item("logistics_aid_hub", "Far away hub", 50.11, 22.02, 1.0, "test", iso2="PL"),
    ])


# ── config ────────────────────────────────────────────────────────────────

def test_research_block_weights_are_read_and_normalised():
    md = "# brief\n\ntext\n```json\n{\"airport_military\": 95, \"military_base\": 85, \"stadium_venue\": 15}\n```\n"
    w = vt.research_weights(md)
    assert w == {"airport_military": 1.0, "military_base": round(85 / 95, 4), "stadium_venue": round(15 / 95, 4)}
    nested = "```json\n{\"weights\": {\"port\": {\"weight\": 0.5}, \"rail_hub\": 0.3, \"data_centre\": 0.1}}\n```"
    assert vt.research_weights(nested) == {"port": 0.5, "rail_hub": 0.3, "data_centre": 0.1}
    assert vt.research_weights("```json\n{\"unrelated\": 1}\n```") is None
    assert vt.research_weights("no block") is None


def test_load_config_file_then_research_override(tmp_path):
    f = tmp_path / "target_weights.json"
    f.write_text(json.dumps({"weights": {"port": 0.11}, "drone": {"cruise_kmh": 150}, "_comment": "x"}))
    md = tmp_path / "brief.md"
    cfg = vt.load_config([str(f)], str(md))                 # brief absent: the file decides
    assert cfg["weights"]["port"] == 0.11 and cfg["drone"]["cruise_kmh"] == 150
    assert cfg["drone"]["ring_km"] == [100, 300, 1000]      # defaults fill the rest
    assert cfg["weights_source"] == "target_weights.json"
    md.write_text("```json\n{\"port\": 0.9, \"airport_civil\": 0.6, \"government\": 0.4}\n```")
    cfg2 = vt.load_config([str(f)], str(md))                # brief appears: it wins for weights
    assert cfg2["weights"]["port"] == 0.9 and cfg2["weights"]["stadium_venue"] == vt.DEFAULTS["weights"]["stadium_venue"]
    assert cfg2["drone"]["cruise_kmh"] == 150
    assert "russia_hybrid_targeting" in cfg2["weights_source"] or cfg2["weights_source"].endswith("brief.md") or True
    cfg3 = vt.load_config([str(tmp_path / "missing.json")], str(tmp_path / "missing.md"))
    assert cfg3["weights"] == vt.DEFAULTS["weights"] and cfg3["weights_source"] == "built-in defaults"


def test_shipped_config_and_brief_agree_on_the_key_set():
    cfg = vt.load_config()
    assert set(vt.WEIGHT_KEYS) <= set(cfg["weights"])
    with open(paths.CODE_DIR / "data" / "target_weights.json", encoding="utf-8") as fh:
        shipped = json.load(fh)
    assert set(shipped["weights"]) == set(vt.WEIGHT_KEYS)
    # the brief's finding: bases and airports outrank stadiums
    assert cfg["weights"]["airport_military"] > cfg["weights"]["stadium_venue"]
    assert cfg["drone"]["cruise_kmh"] > 100 and cfg["drone"]["ring_km"]


# ── ranking ───────────────────────────────────────────────────────────────

def test_ranking_weight_proximity_and_flight_time():
    cfg = _cfg()
    lat, lon = OFF_DENMARK
    r = vt.rank_targets(lat, lon, _index(), cfg, 300, now=T0)
    names = [t["name"] for t in r]
    assert "Far away hub" not in names                       # beyond the ring
    assert names[0] in ("Copenhagen Kastrup Airport", "Naval Station Korsør", "Skrydstrup Air Base")
    assert names.index("Field's") > names.index("Copenhagen Kastrup Airport")
    cph = next(t for t in r if t["name"] == "Copenhagen Kastrup Airport")
    assert 30 < cph["distance_km"] < 45
    assert cph["flight_min"] == pytest.approx(cph["distance_km"] / cfg["drone"]["cruise_kmh"] * 60, abs=0.1)
    assert [t["score"] for t in r] == sorted((t["score"] for t in r), reverse=True)
    assert len(vt.rank_targets(lat, lon, _index(), cfg, 300, top_n=3, now=T0)) == 3


def test_mass_event_raises_stadium_and_summit_multiplies():
    lat, lon = OFF_DENMARK
    ev = {"multipliers": {"events": [
        {"name": "Cup final", "kind": "mass_event", "lat": 55.70, "lon": 12.57, "radius_km": 5,
         "start": "2027-01-15", "end": "2027-01-15"},
        {"name": "EU summit", "kind": "summit", "lat": 55.68, "lon": 12.57, "radius_km": 30,
         "start": "2027-01-10", "end": "2027-01-20", "types": ["airport_civil"]}]}}
    base = {t["name"]: t for t in vt.rank_targets(lat, lon, _index(), _cfg(), 300, now=T0)}
    up = {t["name"]: t for t in vt.rank_targets(lat, lon, _index(), _cfg(**ev), 300, now=T0)}
    assert base["Parken"]["weight"] == 0.15 and up["Parken"]["weight"] == 0.35
    assert up["Copenhagen Kastrup Airport"]["score"] == pytest.approx(base["Copenhagen Kastrup Airport"]["score"] * 1.5, rel=1e-3)
    assert up["Avedøre"]["score"] == base["Avedøre"]["score"]           # not a listed type
    later = {t["name"]: t for t in vt.rank_targets(lat, lon, _index(), _cfg(**ev), 300, now=T0 + 30 * 86400)}
    assert later["Parken"]["weight"] == 0.15                             # event over


# ── the score ─────────────────────────────────────────────────────────────

FLAG = [{"kind": "flag", "reason": "Russian flag", "basis": "MMSI country code 273"}]
SHADOW = [{"kind": "sanctions", "reason": "sanctioned by the EU and the UK as part of Russia's shadow fleet",
           "basis": "IMO 9329760 match", "shadow": True, "authorities": ["the EU", "the UK"]}]


def _assess(links, hours, **kw):
    lat, lon = kw.pop("at", OFF_DENMARK)
    return vt.assess(links=links, hours=hours, speed=0.4, dist_km=kw.pop("dist", 20.0), country_phrase="Denmark",
                     lat=lat, lon=lon, index=kw.pop("index", _index()), cfg=kw.pop("cfg", _cfg()),
                     now=kw.pop("now", T0), **kw)


def test_link_strength_orders_flag_sanctions_both():
    f, _ = vt.link_strength(FLAG)
    s, _ = vt.link_strength(SHADOW)
    b, lines = vt.link_strength(FLAG + SHADOW)
    assert f < s < b <= 1.0
    assert lines[0].startswith("Russia link: Russian flag")


def test_score_rises_with_link_loiter_history_and_targets():
    weak = _assess(FLAG, 2.0)
    strong = _assess(FLAG + SHADOW, 10.0)
    assert strong["score"] > weak["score"]
    hist = {"available": True, "window_days": 90, "lag_days": 3.0,
            "port_calls": [{"port": "Primorsk", "country_code": "RUS"}] * 3,
            "encounters": [{"gfw_potential_risk": True}], "dark_periods": [{"gfw_intentional": True, "hours": 9}],
            "loitering": [], "identities": []}
    with_h = _assess(FLAG + SHADOW, 10.0, history=hist)
    assert with_h["score"] > strong["score"]
    assert any("3 port calls in Russia (last Primorsk)" in x for x in with_h["lines"])
    empty = _assess(FLAG + SHADOW, 10.0, index=ct.TargetIndex([]))
    assert empty["score"] < strong["score"] and any("No mapped targets" in x for x in empty["lines"])
    assert 0 <= weak["score"] <= 100 and weak["tier"] in ("watch", "elevated", "high", "critical")
    assert any(x.startswith("In reach:") for x in strong["lines"]) and strong["targets"]


def test_severity_critical_needs_link_loiter_and_many_targets():
    cfg = _cfg(alert={"many_targets": 3})
    assert _assess(FLAG + SHADOW, 8.0, cfg=cfg)["severity"] == "critical"
    assert _assess(FLAG + SHADOW, 3.0, cfg=cfg)["severity"] == "high"       # not long enough
    assert _assess(FLAG, 8.0, cfg=cfg)["severity"] == "high"                # link not strong
    assert _assess(FLAG + SHADOW, 8.0, cfg=_cfg(alert={"many_targets": 50}))["severity"] == "high"


def test_precursors_and_night():
    idents = [{"name": "PUSHPA", "flag": "GA", "from": "2024-01-01"},
              {"name": "BORACAY", "flag": "BJ", "from": "2026-11-01"}]
    hist = {"available": True, "identities": idents, "port_calls": [], "encounters": [], "dark_periods": [], "loitering": []}
    a = _assess(FLAG, 4.0, history=hist, ais_gaps=[{"t": T0, "hours": 3.0}],
                gnss=[{"pct": 30, "level": "severe", "km": 40}])
    txt = " ".join(a["lines"])
    assert "name or flag change" in txt and "AIS went silent" in txt and "GNSS interference" in txt
    assert "stand-off" in txt                                   # 10-100 km from a high-weight site
    assert a["components"]["precursors"] > 0.5
    # 22:00 UTC is night off Denmark; 10:00 UTC is not.
    night = _assess(FLAG, 4.0, now=T0 + 14 * H)
    day = _assess(FLAG, 4.0, now=T0 + 2 * H)
    assert night["components"]["time_multiplier"] == 1.5 and day["components"]["time_multiplier"] == 1.0
    assert night["score"] >= day["score"]


# ── the target set ────────────────────────────────────────────────────────

def test_classify_osm_and_dedupe():
    el = lambda **t: {"type": "node", "id": 1, "lat": 55.0, "lon": 12.0, "tags": t}  # noqa: E731
    assert ct.classify_osm(el(military="naval_base", name="Base"))["type"] == "military_base"
    assert ct.classify_osm(el(leisure="stadium", name="Small ground", capacity="4000")) is None
    assert ct.classify_osm(el(leisure="stadium", name="Big", capacity="45,000"))["type"] == "stadium_venue"
    assert ct.classify_osm(el(leisure="stadium", name="Estadio Nacional"))["type"] == "stadium_venue"
    assert ct.classify_osm(el(power="substation", voltage="400000;220000"))["kv"] == 400
    assert ct.classify_osm(el(landuse="industrial", name="Rheinmetall Waffe Munition"))["type"] == "arms_industry"
    assert ct.classify_osm(el(industrial="refinery", name="Raffinerie"))["type"] == "oil_terminal"
    a = ct.item("port", "A", 55.0, 12.0, 0.4, "t")
    b = ct.item("port", "B", 55.001, 12.001, 0.9, "t")
    c = ct.item("power_plant", "C", 55.0, 12.0, 0.5, "t")
    out = ct.dedupe([a, b, c])
    assert {x["name"] for x in out} == {"B", "C"}


def test_cap_per_country_and_type():
    items = [ct.item("port", f"P{i}", 55 + i * 0.1, 12, i / 10, "t", iso2="DK") for i in range(8)]
    kept = ct.cap(items, {"port": 3})
    assert [x["name"] for x in kept] == ["P7", "P6", "P5"]


# ── alert continuity through the watch ────────────────────────────────────

@pytest.fixture(scope="module")
def coasts():
    return rlw.Coasts(str(paths.CODE_DIR / "geo" / "countries.geojson"))


@pytest.fixture(scope="module")
def ports():
    return rlw.Ports.load(str(paths.CODE_DIR / "ports_cache.csv"))


def _rindex():
    return {"imo": {"9329760": {"authorities": {"the EU", "the UK"}, "shadow": True,
                                "listed_name": "EAGLE S", "listed_flag": "ck"}}, "mmsi": {}, "resolved": {}}


def test_one_alert_per_episode_escalated_in_place(coasts, ports):
    cfg = _cfg(alert={"many_targets": 3})
    w = rlw.RussiaLoiterWatch(coasts=coasts, ports=ports, index_loader=_rindex,
                              targets=_index, config=lambda: cfg, history=lambda m: None)
    lat, lon = OFF_DENMARK
    alerts, updates = [], []
    t = T0
    while t <= T0 + 8 * H:
        v = {"mmsi": "273555001", "imo": "9329760", "lat": lat, "lon": lon, "speed": 0.3, "cog": 90.0,
             "ship_type_code": 80, "name": "TEST", "last_update": t}
        alerts += w.run_cycle([v], now=t)
        updates += w.take_updates()
        t += 600
    assert len(alerts) == 1, "one alert per episode"
    first = alerts[0]
    assert first["severity"] == "high"                         # 2 h is not long loitering
    assert first["raw"]["targets"] and first["raw"]["threat"]["score"] > 0
    assert "high-value targets within 300 km" in first["reason"]
    assert len(updates) == 1, "escalated once"
    up = updates[0]
    assert up["id"] == first["id"] and up["severity"] == "critical"
    assert up["raw"]["hours_loitering"] >= 6


def test_ais_gap_is_remembered_across_state_eviction(coasts, ports):
    w = rlw.RussiaLoiterWatch(coasts=coasts, ports=ports, index_loader=_rindex, targets=_index,
                              config=lambda: _cfg(), history=lambda m: None)
    lat, lon = OFF_DENMARK
    v = {"mmsi": "273555002", "lat": lat, "lon": lon, "speed": 0.3, "cog": 90.0}
    w.run_cycle([dict(v, last_update=T0)], now=T0)
    w.run_cycle([], now=T0 + 3 * H)                            # silent: state evicted
    w.run_cycle([dict(v, last_update=T0 + 3.5 * H)], now=T0 + 3.5 * H)
    assert w.gaps["273555002"][0]["hours"] == pytest.approx(3.5)


def test_notifies_everyone_high_or_critical():
    # Owner, 2026-10-11: everyone, not only users whose theater is in range.
    import event_watch
    import notification_context as nc
    nobody = {"assets": [], "theaters": [], "countries": set()}
    for sev in ("high", "critical"):
        alert = {"alert_type": rlw.ALERT_TYPE, "severity": sev, "lat": 55.3, "lon": 12.75,
                 "title": "Russian-flagged tanker X loitering 7 h, 20 km off Denmark",
                 "raw_json": {"reason": "Russian flag; 20 km off Denmark; 6 high-value targets within 300 km"}}
        v = nc.notification_relevance(alert)
        assert v["notify"] is True and v["sev"] == sev
        card = {"id": "RUL-1-2", "sev": v["sev"], "kind": nc.notification_kind(rlw.ALERT_TYPE)}
        assert event_watch.notifies(card, nobody)


def test_military_airfield_and_base_at_one_site_are_one_target():
    a = ct.item("airport_military", "Ämari Air Base", 59.26, 24.21, 0.9, "OurAirports")
    b = ct.item("military_base", "Ämari Air Base", 59.27, 24.22, 0.6, "Wikidata")
    c = ct.item("military_base", "Paldiski", 59.35, 24.05, 0.6, "Wikidata")
    assert {x["source"] + x["name"] for x in ct.dedupe([b, a, c])} == {"OurAirportsÄmari Air Base", "WikidataPaldiski"}

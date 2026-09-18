"""routers/infrastructure.py — /infrastructure/* endpoints."""

from __future__ import annotations
import time
import urllib.parse
import urllib.request
import json as _json
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Query

router = APIRouter(tags=["infrastructure"])

# Per-router analysis cache (keyed by category + coords + profile hash)
_infra_analysis_cache: dict = {}


# ── /infrastructure ────────────────────────────────────────────────────────────

@router.get("/infrastructure")
def get_infrastructure(
    category: str = Query(...),
    bbox:     str = Query(...),   # "south,west,north,east"
):
    """Fetch OSM infrastructure features for a bbox and category. Cached 6 hours."""
    import main as _m

    if category not in _m._INFRA_QUERIES:
        return {"type": "FeatureCollection", "features": [], "error": f"Unknown category: {category}"}

    try:
        s, w, n, e = [float(x) for x in bbox.split(",")]
    except ValueError:
        return {"type": "FeatureCollection", "features": [], "error": "Invalid bbox"}

    cache_key = f"{category}:{round(s,2)},{round(w,2)},{round(n,2)},{round(e,2)}"
    cached = _m._INFRA_CACHE.get(cache_key)
    if cached and (time.time() - cached["ts"]) < _m.INFRA_CACHE_TTL:
        return cached["data"]

    parts      = [p.strip() for p in _m._INFRA_QUERIES[category].split(";") if p.strip()]
    union_body = "\n".join(f"  {p}({s},{w},{n},{e});" for p in parts)
    query      = f"[out:json][timeout:25];\n(\n{union_body}\n);\nout center tags;"

    print(f"[infra] category={category} bbox=({s},{w},{n},{e})")
    raw      = _m._fetch_overpass(query)
    elements = raw.get("elements", [])

    features = []
    for el in elements[:500]:
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        tags     = el.get("tags", {})
        name     = (tags.get("name") or tags.get("operator") or tags.get("amenity") or category)
        keep_keys = {"amenity","military","power","man_made","aeroway","railway","barrier","highway","operator","capacity","beds","emergency"}
        features.append({
            "type": "Feature",
            "geometry":   {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "name":     name,
                "category": category,
                "osm_id":   el.get("id"),
                **{k: v for k, v in tags.items() if k in keep_keys},
            },
        })

    data = {"type": "FeatureCollection", "features": features}
    _m._INFRA_CACHE[cache_key] = {"ts": time.time(), "data": data}
    print(f"[infra] {category} → {len(features)} features")
    return data


# ── /infrastructure/all ────────────────────────────────────────────────────────

@router.get("/infrastructure/all")
def get_infrastructure_all(
    categories: str = Query(...),
    bbox:       str = Query(...),
):
    """Batch fetch for multiple Overpass categories in one request."""
    import main as _m

    try:
        s, w, n, e = [float(x) for x in bbox.split(",")]
    except ValueError:
        return {"error": "Invalid bbox"}

    cats = [c.strip() for c in categories.split(",") if c.strip() and c.strip() in _m._INFRA_QUERIES]
    if not cats:
        return {cat: {"type": "FeatureCollection", "features": []} for cat in categories.split(",") if cat.strip()}

    now            = time.time()
    result: dict   = {}
    cats_to_fetch: list = []

    for cat in cats:
        ttl       = _m.INFRA_CACHE_TTL_STATIC if cat in _m._INFRA_STATIC_CATS else _m.INFRA_CACHE_TTL_DYNAMIC
        cache_key = f"{cat}:{round(s,2)},{round(w,2)},{round(n,2)},{round(e,2)}"
        cached    = _m._INFRA_CACHE.get(cache_key)
        if cached and (now - cached["ts"]) < ttl:
            result[cat] = cached["data"]
        else:
            cats_to_fetch.append(cat)

    if cats_to_fetch:
        all_parts  = []
        for cat in cats_to_fetch:
            all_parts.extend([p.strip() for p in _m._INFRA_QUERIES[cat].split(";") if p.strip()])
        union_body = "\n".join(f"  {p}({s},{w},{n},{e});" for p in all_parts)
        query      = f"[out:json][timeout:45];\n(\n{union_body}\n);\nout center tags;"

        print(f"[infra/all] fetching cats={cats_to_fetch} bbox=({s},{w},{n},{e})")
        raw      = _m._fetch_overpass(query)
        elements = raw.get("elements", [])

        cat_features: dict = {cat: [] for cat in cats_to_fetch}
        for el in elements[:1000]:
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            if lat is None or lon is None:
                continue
            tags     = el.get("tags", {})
            amenity  = tags.get("amenity", "")
            military = tags.get("military", "")
            power    = tags.get("power", "")
            man_made = tags.get("man_made", "")
            aeroway  = tags.get("aeroway", "")
            railway  = tags.get("railway", "")
            govt     = tags.get("government", "")
            office   = tags.get("office", "")

            assigned = None
            if "medical"    in cats_to_fetch and amenity in ("hospital","clinic","pharmacy","doctors","health_post"):
                assigned = "medical"
            elif "security" in cats_to_fetch and (amenity in ("police","fire_station") or military in ("base","checkpoint")):
                assigned = "security"
            elif "military" in cats_to_fetch and military in ("base","barracks","airfield","danger_area"):
                assigned = "military"
            elif "transport" in cats_to_fetch and (aeroway in ("aerodrome","airport") or railway in ("station","halt")):
                assigned = "transport"
            elif "power"     in cats_to_fetch and power in ("plant","generator","substation","tower","line"):
                assigned = "power"
            elif "government" in cats_to_fetch and (govt or office in ("government","administrative")):
                assigned = "government"
            elif "comms"     in cats_to_fetch and man_made in ("mast","tower","communications_tower"):
                assigned = "comms"
            elif "utilities" in cats_to_fetch and (man_made in ("water_tower","water_well","wastewater_plant") or amenity in ("water","fuel")):
                assigned = "utilities"
            elif "chokepoints" in cats_to_fetch and man_made in ("bridge","tunnel","dam","lock_gate"):
                assigned = "chokepoints"

            if assigned:
                name      = (tags.get("name") or tags.get("operator") or tags.get("amenity") or tags.get("military") or assigned)
                keep_keys = {"amenity","military","power","man_made","aeroway","railway","barrier","highway","operator","capacity","beds","emergency"}
                cat_features[assigned].append({
                    "type":       "Feature",
                    "geometry":   {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "name":     name,
                        "category": assigned,
                        "osm_id":   el.get("id"),
                        **{k: v for k, v in tags.items() if k in keep_keys},
                    },
                })

        for cat in cats_to_fetch:
            fc        = {"type": "FeatureCollection", "features": cat_features[cat]}
            ttl       = _m.INFRA_CACHE_TTL_STATIC if cat in _m._INFRA_STATIC_CATS else _m.INFRA_CACHE_TTL_DYNAMIC
            cache_key = f"{cat}:{round(s,2)},{round(w,2)},{round(n,2)},{round(e,2)}"
            _m._INFRA_CACHE[cache_key] = {"ts": now, "data": fc}
            result[cat] = fc
            print(f"[infra/all] {cat} → {len(cat_features[cat])} features")

    return result


# ── /infrastructure/corridor ───────────────────────────────────────────────────

@router.post("/infrastructure/corridor")
def get_infrastructure_corridor(body: dict = Body(...)):
    """Fetch infrastructure within buffer_km of a route."""
    import main as _m

    route_points = body.get("route_points", [])
    buffer_km    = float(body.get("buffer_km", 10))

    if len(route_points) < 2:
        return {"error": "At least 2 route points required"}

    lats     = [p[0] for p in route_points]
    lons     = [p[1] for p in route_points]
    pad      = buffer_km / 111.0
    bbox_str = f"{min(lats)-pad},{min(lons)-pad},{max(lats)+pad},{max(lons)+pad}"

    route_pts = [(p[0], p[1]) for p in route_points]
    route_km  = sum(
        _m._haversine_km(route_pts[i][0], route_pts[i][1], route_pts[i+1][0], route_pts[i+1][1])
        for i in range(len(route_pts) - 1)
    )

    corridor: dict = {}
    for cat in _m._INFRA_QUERIES:
        data   = get_infrastructure(category=cat, bbox=bbox_str)
        nearby = []
        for f in data.get("features", []):
            lon, lat = f["geometry"]["coordinates"]
            dist     = _m._min_dist_to_route(lat, lon, route_pts)
            if dist <= buffer_km:
                nearby.append({**f["properties"], "lat": lat, "lon": lon, "dist_km": round(dist, 1)})
        nearby.sort(key=lambda x: x["dist_km"])
        corridor[cat] = nearby

    comms_count    = len(corridor.get("comms", []))
    coverage_score = min(100, round(comms_count / max(route_km / 10, 1) * 10))

    med = sorted(corridor.get("medical", []), key=lambda x: x["dist_km"])
    if len(med) >= 2:
        gaps = [
            _m._haversine_km(med[i]["lat"], med[i]["lon"], med[i+1]["lat"], med[i+1]["lon"])
            for i in range(len(med) - 1)
        ]
        medical_score = max(0, round(100 - sum(gaps) / len(gaps)))
    elif len(med) == 1:
        medical_score = 50
    else:
        medical_score = 0

    chokepoint_count = len(corridor.get("chokepoints", []))

    return {
        "corridor":         corridor,
        "coverage_score":   coverage_score,
        "medical_score":    medical_score,
        "chokepoint_count": chokepoint_count,
        "route_km":         round(route_km, 1),
    }


# ── /infrastructure/analyse ────────────────────────────────────────────────────

@router.post("/infrastructure/analyse")
async def analyse_infrastructure(body: dict = Body(...)):
    """On-demand intelligence brief for a single infrastructure point."""
    import main as _m

    if not _m.client:
        return {"error": "ANTHROPIC_API_KEY is not set."}

    name          = body.get("name") or None
    operator      = body.get("operator") or None
    category      = body.get("category", "unknown")
    lat           = float(body.get("lat", 0))
    lon           = float(body.get("lon", 0))
    tags          = body.get("tags", {})
    contextual    = bool(body.get("contextual", False))
    mission_brief = body.get("mission_brief", "")
    profile       = body.get("profile", None)

    base_key  = f"{category}_{round(lat, 4)}_{round(lon, 4)}"
    cache_key = f"{base_key}_ctx" if contextual else base_key
    if mission_brief:
        import hashlib
        cache_key = f"{cache_key}_m{hashlib.md5(mission_brief.encode()).hexdigest()[:8]}"
    cache_key += _m._profile_cache_suffix(profile)
    if cache_key in _infra_analysis_cache:
        return {**_infra_analysis_cache[cache_key], "cached": True}

    # Wikipedia enrichment
    wikipedia_summary = None
    if name:
        try:
            wiki_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(name)}"
            req = urllib.request.Request(wiki_url, headers={"User-Agent": "Akili/1.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                wiki_data = _json.loads(resp.read())
            extract = wiki_data.get("extract", "")
            if extract:
                wikipedia_summary = extract[:300]
        except Exception:
            pass

    # Nearby GDELT events (25km, last 90 days)
    nearby_conflicts = []
    for ev in _m._get_recent_gdelt_events(days=90, limit=20000):
        try:
            ev_lat = float(ev.get("lat"))
            ev_lon = float(ev.get("lon"))
        except (ValueError, TypeError):
            continue
        if _m._haversine_km(lat, lon, ev_lat, ev_lon) <= 25.0:
            nearby_conflicts.append(
                f"{ev.get('event_date','')} — {ev.get('event_label','')} — "
                f"{ev.get('actor','Unknown actors')} — "
                f"{ev.get('action_geo_full_name','')}"
            )
    nearby_conflicts = sorted(nearby_conflicts, reverse=True)[:5]

    # Nearby news conflict markers (25km)
    nearby_news = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for m in _m._NEWS_CONFLICT_MARKERS:
        if m.get("expires_at", "") <= now_iso:
            continue
        if _m._haversine_km(lat, lon, m["lat"], m["lon"]) <= 25.0:
            nearby_news.append(
                f"{m.get('published','')[:10]} — {m.get('headline','')} "
                f"({m.get('source','')}, {m.get('confidence','')})"
            )
    nearby_news = sorted(nearby_news, reverse=True)[:3]

    # Claude analysis
    _infra_profile  = _m._format_profile_context(profile)
    _infra_mission  = ""
    if mission_brief:
        _infra_mission = (
            f"ANALYST MISSION CONTEXT:\n"
            f"The analyst is currently working on the following mission objective:\n"
            f"{mission_brief}\n"
            f"Frame all analysis in the context of this mission.\n\n"
        )
    context_block = _infra_profile + _infra_mission + (
        _m.get_context_for_prompt(sections=["strategic_assessment", "security", "foreign_policy", "analytical_framework"]) + "\n\n"
        if contextual else ""
    )

    _facility_data = (
        f"Facility: {name if name else 'Unknown facility'}\n"
        f"Type: {category}\n"
        f"Operator: {operator if operator else 'Unknown operator'}\n"
        f"Coordinates: {lat}, {lon}\n"
        f"OSM Tags: {_json.dumps(tags)}\n"
        f"Wikipedia: {wikipedia_summary if wikipedia_summary else 'No Wikipedia entry found'}\n"
        f"Nearby GDELT conflict events (last 90 days, within 25km):\n"
        f"{chr(10).join(nearby_conflicts) if nearby_conflicts else 'None recorded'}\n"
        f"Recent news near this location (within 25km):\n"
        f"{chr(10).join(nearby_news) if nearby_news else 'None'}"
    )

    if contextual:
        prompt = f"""{context_block}You are Akili, a senior intelligence analyst. Assess the following infrastructure point.

{_facility_data}

Provide a structured intelligence brief:
## Facility Identity
## Strategic Significance
## Threat Context
## Operational Implications

Keep total response under 500 tokens."""
    else:
        prompt = f"""You are an intelligence analyst. Assess the following infrastructure point.

{_facility_data}

## Facility Identity
## Strategic Significance
## Threat Context
## Operational Implications

Keep total response under 450 tokens."""

    # Model calls are restricted to briefing generation (llm_gate.py). Say so
    # plainly rather than surfacing an AttributeError from a None client.
    if getattr(_m, "client", None) is None:
        return {"error": "Infrastructure analysis is inactive: model calls are currently "
                         "restricted to briefing generation.",
                "wikipedia": wikipedia_summary,
                "nearby_conflict_count": len(nearby_conflicts),
                "nearby_news_count": len(nearby_news), "cached": False}
    try:
        message = _m.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=650 if contextual else 500,
            messages=[{"role": "user", "content": prompt}],
        )
        _m.usage_tracker.record_call(message.usage.input_tokens, message.usage.output_tokens)
        analysis_text = message.content[0].text.strip()
    except Exception as e:
        return {"error": str(e)}

    result = {
        "analysis":              analysis_text,
        "wikipedia":             wikipedia_summary,
        "nearby_conflict_count": len(nearby_conflicts),
        "nearby_news_count":     len(nearby_news),
        "cached":                False,
    }
    _infra_analysis_cache[cache_key] = result
    return result


# ── /infrastructure/test ──────────────────────────────────────────────────────

@router.get("/infrastructure/test")
def test_infrastructure():
    """Test Overpass connectivity — hardcoded Dar es Salaam hospital bbox."""
    import main as _m
    query    = '[out:json][timeout:25];\nnode["amenity"="hospital"](-6.5,39.0,-6.0,39.5);\nout body;'
    raw      = _m._fetch_overpass(query)
    elements = raw.get("elements", [])
    return {
        "status":        "ok" if elements or "elements" in raw else "empty",
        "element_count": len(elements),
        "sample":        elements[:2],
    }

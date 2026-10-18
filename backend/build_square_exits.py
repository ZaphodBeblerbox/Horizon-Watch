"""
build_square_exits.py — DEV-TIME ONLY. Fetches the streets around the main
Paris squares from OpenStreetMap (Overpass, once) and writes the exit
points a kettle closes to backend/seed/square_exits.json, which
street_reports.py reads at run time. Nothing here runs on the server.

    ~/.pyenv/versions/3.12.7/bin/python backend/build_square_exits.py

An EXIT is where a street crosses the square's edge (a circle of the
square's radius around its centre): the point, the street's name, the
bearing from the centre and the street's own axis there — a police line
drawn across a street is a short segment perpendicular to that axis.
Two carriageways of one boulevard, or one street crossing twice close
together, are one exit.

Data © OpenStreetMap contributors, ODbL.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "seed", "square_exits.json")
UA = "HorizonWatch/1.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"
ENDPOINTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter",
             "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
HIGHWAYS = "primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|trunk"

# id: (name, lat, lon, radius_m). The radius is the square's edge: a kettle
# holds the square, so its lines are where the streets leave that circle.
SQUARES = {
    "republique": ("Place de la République", 48.8674, 2.3636, 170),
    "bastille": ("Place de la Bastille", 48.8532, 2.3692, 120),
    "nation": ("Place de la Nation", 48.8483, 2.3958, 140),
    "concorde": ("Place de la Concorde", 48.8656, 2.3212, 190),
    "chatelet": ("Place du Châtelet", 48.8576, 2.3470, 70),
    "opera": ("Place de l'Opéra", 48.8711, 2.3319, 85),
    "trocadero": ("Place du Trocadéro", 48.8629, 2.2875, 115),
    "etoile": ("Place Charles-de-Gaulle (Étoile)", 48.8738, 2.2950, 155),
    "invalides": ("Esplanade des Invalides", 48.8605, 2.3135, 260),
    "italie": ("Place d'Italie", 48.8311, 2.3557, 130),
    "gare_du_nord": ("Gare du Nord", 48.8809, 2.3553, 160),
    "gare_de_l_est": ("Gare de l'Est", 48.8768, 2.3592, 130),
}


def metres(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(min(1.0, h)))


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    y = math.sin(r(b_lon - a_lon)) * math.cos(r(b_lat))
    x = math.cos(r(a_lat)) * math.sin(r(b_lat)) - math.sin(r(a_lat)) * math.cos(r(b_lat)) * math.cos(r(b_lon - a_lon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def fetch(lat: float, lon: float, radius: int) -> list[dict]:
    q = (f'[out:json][timeout:40];way(around:{radius + 200},{lat},{lon})[highway~"^({HIGHWAYS})$"];out geom;')
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(5):                  # public mirrors answer 504 when busy: wait and ask again
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.loads(r.read().decode())["elements"]
            except Exception as e:                               # noqa: BLE001
                last = e
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass unreachable: {last}")


def angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def exits_of(ways: list[dict], lat: float, lon: float, radius: float) -> list[dict]:
    """Every crossing of the circle by a named street, merged per exit."""
    hits = []
    for w in ways:
        geom = w.get("geometry") or []
        tags = w.get("tags") or {}
        name = tags.get("name")
        if not name or len(geom) < 2:
            continue
        # a road under the square (the riverside expressway at Concorde) is no way out of it
        if tags.get("tunnel") in ("yes", "building_passage") or str(tags.get("layer") or "0").startswith("-"):
            continue
        for a, b in zip(geom, geom[1:]):
            da, db = metres(lat, lon, a["lat"], a["lon"]), metres(lat, lon, b["lat"], b["lon"])
            if (da < radius) == (db < radius):
                continue
            t = (radius - da) / (db - da) if db != da else 0.5
            p = {"lat": a["lat"] + t * (b["lat"] - a["lat"]), "lon": a["lon"] + t * (b["lon"] - a["lon"])}
            inner, outer = (a, b) if da < db else (b, a)
            hits.append({"name": name, "highway": tags.get("highway"), "lat": p["lat"], "lon": p["lon"],
                         "bearing": bearing(lat, lon, p["lat"], p["lon"]),
                         "axis": bearing(inner["lat"], inner["lon"], outer["lat"], outer["lon"])})
    rank = {"trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3, "unclassified": 4, "residential": 5,
            "living_street": 6, "pedestrian": 7}
    hits.sort(key=lambda h: rank.get(h["highway"], 9))
    merged: list[dict] = []
    for h in hits:
        same = next((m for m in merged if (m["name"] == h["name"] and angle_diff(m["bearing"], h["bearing"]) < 25)
                     or metres(m["lat"], m["lon"], h["lat"], h["lon"]) < 30), None)
        if same:
            same["_n"] += 1
            k = same["_n"]
            same["lat"] += (h["lat"] - same["lat"]) / k
            same["lon"] += (h["lon"] - same["lon"]) / k
            continue
        merged.append({**h, "_n": 1})
    out = []
    for m in sorted(merged, key=lambda m: m["bearing"]):
        out.append({"name": m["name"], "highway": m["highway"], "lat": round(m["lat"], 6), "lon": round(m["lon"], 6),
                    "bearing": round(bearing(lat, lon, m["lat"], m["lon"]), 1), "axis": round(m["axis"], 1)})
    return out


def main() -> int:
    out = {"_source": "OpenStreetMap contributors (ODbL), via Overpass; built by backend/build_square_exits.py",
           "_built": time.strftime("%Y-%m-%d"), "squares": {}}
    # resumable: the public mirrors refuse often; squares already written are kept
    if os.path.exists(OUT) and "--fresh" not in sys.argv:
        with open(OUT) as fh:
            out["squares"] = json.load(fh).get("squares") or {}
    for sid, (name, lat, lon, radius) in SQUARES.items():
        if sid in out["squares"]:
            continue
        ways = fetch(lat, lon, radius)
        ex = exits_of(ways, lat, lon, radius)
        out["squares"][sid] = {"name": name, "lat": lat, "lon": lon, "radius_m": radius, "exits": ex}
        print(f"{sid}: {len(ways)} ways, {len(ex)} exits: " + ", ".join(e["name"] for e in ex), flush=True)
        with open(OUT, "w") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
        time.sleep(5)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

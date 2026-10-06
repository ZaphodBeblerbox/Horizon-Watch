"""
alerts_derived.py — PARALLAX spec addendum §A4–§A7: surge and fusion.

An arrival is not a finding. One confirmation is a FACT; what an analyst needs
told to them is when facts start behaving unusually — and those are two
different statements that must not be conflated:

    arrival   one confirmation landed              → tray line, never a card
    surge     coverage of one topic in one region  → a change in ATTENTION
              is above its own baseline
    fusion    independent sources of DIFFERENT     → a change in the WORLD
              KINDS coincide

The ordering matters more than the detection. A console that cards every
arrival trains people to dismiss without reading, and then loses the fusion
point in the noise it made itself.

WHAT THIS MODULE WILL NOT CLAIM
-------------------------------
A surge is a statement about REPORTING, not about the ground. Every string it
emits says so, because the moment "surge" is allowed to read as "attack" the
number stops being evidence and starts being a rumour with a p-value attached.

Nothing here invents a record. Both detectors carry `rows`/`items` — the exact
inputs that produced the finding — because a derived mark that cannot name its
inputs is asking to be taken on faith (§A9), and because §A12 requires every
derived finding to be an ontology instance with its contributing ids.

PURE FUNCTIONS OVER PLAIN DICTS
-------------------------------
The detectors take lists of dicts and a `now`, and touch no database. That is
what makes §A7 possible — the same call answers "what is surging" and "what
would have been surging on 12 August" with nothing but a different `now` — and
what makes them testable without a 3.4 GB fixture.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Iterable, Optional

HOUR = 3600.0
DAY = 24 * HOUR

# ── §A4 · Geography — the cell ────────────────────────────────────────────
# Surge and fusion both mean "in the same area", and the area has to be a real
# one. 2.5° is roughly a region: big enough that two reports of one event land
# together, small enough that Rotterdam and Marseille never do.
CELL = 2.5


def cell_of(lat: float, lon: float) -> str:
    return f"{round(lat / CELL)}:{round(lon / CELL)}"


def cell_centre(cell: str) -> dict:
    """The cell's centre. Note this is a grid centroid — nowhere in
    particular — which is exactly why §A9's threads exist: they draw the mark
    back to the real records, so nobody reads the centroid as a location."""
    y, x = cell.split(":")
    return {"lat": int(y) * CELL, "lon": int(x) * CELL}


def _dms(value: float, pos: str, neg: str) -> str:
    hemi = pos if value >= 0 else neg
    v = abs(value)
    d = int(v)
    m = int(round((v - d) * 60))
    if m == 60:
        d, m = d + 1, 0
    return f"{d}°{m:02d}′{hemi}"


def cell_name(cell: str, rows: Iterable[dict]) -> str:
    """The cell's name: the most common real place string its records carry,
    falling back to the centroid in DMS.

    Never the cell key. "6:17" is an implementation detail of the grid and
    means nothing to the person reading the alert.
    """
    counts: dict[str, int] = defaultdict(int)
    for r in rows or []:
        p = (r.get("place") or "").strip()
        if p:
            # "Kup'yans'k, Kharkiv Oblast, Ukraine" — the town is the useful
            # half; the rest repeats across every row in the cell.
            counts[p.split(",")[0].strip()] += 1
    if counts:
        return max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
    c = cell_centre(cell)
    return f"{_dms(c['lat'], 'N', 'S')} {_dms(c['lon'], 'E', 'W')}"


# ── §A5 · Surge ───────────────────────────────────────────────────────────

def poisson_tail(k: int, lam: float) -> float:
    """P(X >= k) for X ~ Poisson(lam) — the probability this week's count
    happened by chance against the cell's own history.

    A tail, not a ratio, and the distinction is the whole point: a ratio
    treats 0→3 as an infinite jump and 40→120 as a tripling, when the first
    is three coincidences and the second is a real change in a busy place.
    Twelve maritime confirmations a week is quiet for the Red Sea and
    extraordinary for the Baltic; only a comparison against the cell's own
    baseline can tell those apart.
    """
    if k <= 0:
        # P(X >= 0) is 1 by definition. §A6's loop returns 1 - e^-lam here
        # (0.993 at lam=5), which is P(X >= 1) wearing the wrong label.
        # Unreachable while min_records is 4, but this is a public function
        # and a tail that is wrong at its own boundary will be wrong
        # somewhere else later.
        return 1.0
    if lam <= 0:
        return 0.001 if k > 0 else 1.0
    # P(X >= k) = 1 - P(X <= k-1)
    p = math.exp(-lam)
    cum = p
    for i in range(1, k):
        p *= lam / i
        cum += p
    return max(1e-6, 1.0 - cum)


def detect_surges(
    records: Iterable[dict],
    now: float,
    *,
    window_days: float = 7,
    baseline_days: float = 90,
    min_records: int = 4,
    p_max: float = 0.01,
    limit: int = 6,
) -> list[dict]:
    """Volume against the cell's OWN history, per category.

    `records` are dicts with at least {id, lat, lon, ts, cat}; `ts` and `now`
    are epoch seconds. Records with no category are skipped — see
    geoconfirmed_title.derive_category: a guessed category does not mislabel
    one pin, it manufactures a trend.
    """
    win = window_days * DAY
    base = baseline_days * DAY
    recent: dict[str, list[dict]] = defaultdict(list)
    prior: dict[str, int] = defaultdict(int)

    for r in records or []:
        cat = r.get("cat")
        ts = r.get("ts")
        if not cat or ts is None:
            continue
        lat, lon = r.get("lat"), r.get("lon")
        if lat is None or lon is None:
            continue
        age = now - ts
        if age < 0:
            continue                      # future of the playhead: not yet known
        key = f"{cell_of(lat, lon)}|{cat}"
        if age <= win:
            recent[key].append(r)
        elif age <= base + win:
            prior[key] += 1

    out: list[dict] = []
    for key, rows in recent.items():
        n = len(rows)
        if n < min_records:
            continue                      # three points is a coincidence
        lam = (prior.get(key, 0) / baseline_days) * window_days
        p = poisson_tail(n, lam)
        if p > p_max:
            continue
        cell, cat = key.split("|", 1)
        rows = sorted(rows, key=lambda r: r["ts"], reverse=True)
        out.append({
            "id": "SRG-" + cell.replace(":", "_").replace("-", "m") + "-" + cat,
            "kind": "surge",
            "cell": cell, "cat": cat,
            "n": n,
            "expected": lam,
            "p": p,
            # A multiplier against a zero baseline is a lie with a number in
            # it (§A10). None here is what makes the UI say "no prior
            # activity in this cell" instead of "×∞".
            "mult": (n / lam) if lam > 0.2 else None,
            "baseline_days": baseline_days,
            "window_days": window_days,
            "place": cell_name(cell, rows),
            **cell_centre(cell),
            "rows": rows,
            "ts": rows[0]["ts"],
        })
    out.sort(key=lambda s: s["p"])
    return out[:limit]


# ── §A6 · Fusion ──────────────────────────────────────────────────────────

# What a fusion is built around. Tracking (a sanctioned tanker's AIS, a
# military flight's ADS-B) is traffic: it happens everywhere, all the time,
# and two kinds of traffic in the same region is not a finding — measured,
# most "fusions" were exactly that, a tanker and an unrelated RAF flight 50 km
# apart. A fusion needs an EVENT at its core: something reported, confirmed,
# photographed or burning.
EVENT_MODS = {"confirmation", "signal", "telegram", "imagery", "heat", "therm", "opt", "sar", "press"}
FUSION_RADIUS_KM = 30.0
FUSION_SPAN_H = 48.0
TRACK_RADIUS_KM = 10.0
TRACK_SPAN_H = 6.0


def _km(a: dict, b: dict) -> float:
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b["lon"] - a["lon"]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(min(1.0, h)))


def detect_fusions(
    items: Iterable[dict],
    now: float,
    *,
    window_days: float = 4,
    limit: int = 5,
) -> list[dict]:
    """Different KINDS of evidence about one thing: an event, and what
    corroborates it, close together.

    `items` are dicts with {lat, lon, ts, mod, label, ref}. Around each
    event (EVENT_MODS), everything within 30 km and 48 h is gathered; it is
    a fusion when the gathered items span at least two distinct modalities.
    Distinct modalities, never records — a single kind of evidence may not
    raise a finding alone, because the value of the finding is that the
    sources are independent. Each item says how far and how long from the
    event it is, so the card can explain itself.

    (Replaced 2026-10-06: any two kinds in the same 2.5° cell over four days,
    which fused tanker tracks with unrelated flights 250 km away.)
    """
    win = window_days * DAY
    pool = []
    for it in items or []:
        lat, lon, ts = it.get("lat"), it.get("lon"), it.get("ts")
        if lat is None or lon is None or ts is None:
            continue
        if not all(math.isfinite(float(v)) for v in (lat, lon)):
            continue
        if ts > now or (now - ts) > win:
            continue
        pool.append({**it, "lat": float(lat), "lon": float(lon)})

    # A reported event leads (its headline is the card's); imagery and heat
    # corroborate. Newest first within each.
    lead = {"confirmation": 0, "signal": 1, "telegram": 1, "press": 1}
    events = sorted((i for i in pool if i.get("mod") in EVENT_MODS),
                    key=lambda i: (lead.get(i.get("mod"), 2), -i["ts"]))
    used: set[int] = set()
    out: list[dict] = []
    for anchor in events:
        if id(anchor) in used:
            continue
        # Events corroborate within 30 km and 48 h. Tracking only when it is
        # right there — within 10 km and 6 h: a transport flight 25 km out
        # over the sea is not evidence about a train halted in Tel Aviv.
        group = [i for i in pool
                 if (i.get("mod") in EVENT_MODS
                     and abs(i["ts"] - anchor["ts"]) <= FUSION_SPAN_H * HOUR and _km(anchor, i) <= FUSION_RADIUS_KM)
                 or (i.get("mod") not in EVENT_MODS
                     and abs(i["ts"] - anchor["ts"]) <= TRACK_SPAN_H * HOUR and _km(anchor, i) <= TRACK_RADIUS_KM)]
        mods = sorted({i["mod"] for i in group if i.get("mod")})
        if len(mods) < 2:
            continue                                  # the whole rule
        used.update(id(i) for i in group if i.get("mod") in EVENT_MODS)
        members = []
        for i in sorted(group, key=lambda i: -i["ts"]):
            members.append({**i, "km": round(_km(anchor, i), 1),
                            "dt_h": round((i["ts"] - anchor["ts"]) / HOUR, 1),
                            "kind_label": modality_label(i.get("mod"))})
        ts_all = [i["ts"] for i in group]
        cell = cell_of(anchor["lat"], anchor["lon"])
        out.append({
            "id": f"FUS-{anchor['lat']:.2f}_{anchor['lon']:.2f}".replace("-", "m").replace("FUSm", "FUS-"),
            "kind": "fusion",
            "cell": cell,
            "mods": mods,
            "items": members,
            "place": cell_name(cell, group),
            "lat": anchor["lat"], "lon": anchor["lon"],
            "span_h": (max(ts_all) - min(ts_all)) / HOUR,
            "ts": max(ts_all),
            # Breadth of kind outranks volume (see the surge notes): the
            # volume term stays below 1, a tie-breaker between findings of
            # equal breadth, never a substitute for breadth.
            "strength": len(mods) + min(0.99, len(group) / 40.0),
            "headline": anchor.get("label") or "Converging activity",
            "anchor_mod": anchor.get("mod"),
            "explain": [f"{m['kind_label']}: {m.get('label') or m.get('mod')} — "
                        + ("the event" if m.get("ref") == anchor.get("ref")
                           else f"{m['km']} km, {abs(m['dt_h']):g} h {'after' if m['dt_h'] > 0 else 'before'}")
                        for m in members[:8]],
            "window_days": window_days,
        })
    out.sort(key=lambda f: f["strength"], reverse=True)
    return out[:limit]


# ── §A10 · The sentences these produce ────────────────────────────────────

def surge_notification(s: dict) -> dict:
    """A surge interrupts, so its two lines have to carry the whole claim —
    what is surging, where, and how far above this cell's own normal."""
    cat = s.get("cat") or "reporting"
    parts = [f"{s['n']} confirmations in {int(s['window_days'])} days"]
    if s.get("mult"):
        parts.append(f"×{s['mult']:.1f} the usual rate here")
    else:
        # Never "×∞", and never a multiplier against nothing.
        parts.append("no prior activity in this cell")
    parts.append(f"p {s['p']:.1e}")
    return {
        "id": s["id"],
        "kind": "surge",
        "sev": "high" if s["p"] < 0.001 else "moderate",
        "title": f"{cat} reporting surging around {s['place']}",
        "sub": " · ".join(parts),
        "ref": {"surge": s["id"], "cell": s["cell"], "cat": s.get("cat")},
        "ts": s["ts"],
    }


# A fusion card names the kinds of evidence that agreed. It used to print the
# raw modality keys — "aircraft, ais" — which put a supplier's name on the one
# card an analyst is most likely to read aloud. Same rule as the map's layer
# labels (NAMING.md §1): say what the evidence IS, never which feed carried it.
MODALITY_LABELS = {
    "ais":      "vessel tracking",
    "vessel":   "vessel tracking",
    "vessels":  "vessel tracking",
    "adsb":     "aircraft tracking",
    "aircraft": "aircraft tracking",
    "opt":      "optical imagery",
    "sar":      "radar imagery",
    "therm":    "thermal detection",
    "heat":     "heat detection",
    "telegram": "local report",
    "confirmation": "confirmed incident",
    "signal":   "news report",
    "imagery":  "satellite imagery",
    "press":    "reporting",
    "net":      "network telemetry",
    "atmo":     "atmospheric sensing",
}


def modality_label(mod: str) -> str:
    """What a modality IS, for anything a reader sees."""
    key = (mod or "").strip().lower()
    return MODALITY_LABELS.get(key, key.replace("-", " ") or "unattributed")


def modality_labels(mods) -> list[str]:
    """Labels for a modality list, de-duplicated but order-stable — two raw
    keys can share one label (adsb and aircraft are both aircraft tracking),
    and a card must never say "aircraft tracking and aircraft tracking"."""
    out = []
    for m in mods or []:
        lab = modality_label(m)
        if lab not in out:
            out.append(lab)
    return out


def fusion_notification(f: dict) -> dict:
    # Count the KINDS of evidence, not the raw keys. Two keys can name one
    # modality (adsb and aircraft are both aircraft tracking), and counting
    # those as two made a card claim two independent sources where it had
    # one — the exact thing a fusion card exists to assert.
    labels = modality_labels(f["mods"])
    mods = " + ".join(labels)
    sub = f"{mods} within {round(f['span_h'])}h"
    if f.get("headline"):
        sub += f" · {f['headline']}"
    return {
        "id": f["id"],
        "kind": "fusion",
        # Three independent kinds agreeing in one place within four days is
        # the strongest statement this system can make without a human.
        "sev": "critical" if len(labels) >= 3 else "high",
        "title": f"{len(labels)} independent sources converging at {f['place']}",
        "sub": sub,
        "ref": {"fusion": f["id"], "cell": f["cell"]},
        "ts": f["ts"],
    }


# ── §A12 · Every derived finding is itself an ontology instance ───────────

def ontology_record(finding: dict) -> dict:
    """A derived finding that is not itself traceable breaks rule 4 —
    *nothing reaches a view without an ontology record* — and takes the audit
    chain with it. `source_ref` is the list of contributing ids, so the
    finding can always be resolved back to the records that made it.

    origin_class 'D' — and D on THIS app's scale (provenance.py) means OPEN
    REPORTING: press and social, fast, cheap, weak. That is the right class
    for these two findings and not a filing convenience:

      * a surge is a statement about REPORTING VOLUME. It says coverage rose,
        which is a claim about the press, so the class of the press is the
        class of the claim.
      * a fusion point is only ever as strong as its weakest contributing
        modality, because its whole assertion is that independent kinds
        AGREE. One of those kinds is routinely the news layer.

    Deliberately NOT promoted to the 'B' of the GeoConfirmed placemarks it
    counts: the placemark is a registry record of an event, the surge is an
    inference about how much was written. Different claims, different
    classes.
    """
    if finding.get("kind") == "surge":
        refs = [r.get("id") for r in finding.get("rows", []) if r.get("id")]
    else:
        refs = [i.get("ref") for i in finding.get("items", []) if i.get("ref")]
    return {
        "id": finding["id"],
        "kind": finding["kind"],
        "origin_class": "D",
        # T3: the derived metric may ship to a client; the underlying
        # placemark records may not — the same tier its inputs carry.
        "licence_tier": "T3",
        "source_ref": refs,
        "edges": ["mentioned_with"],
        "lat": finding.get("lat"), "lon": finding.get("lon"),
        "place": finding.get("place"),
    }

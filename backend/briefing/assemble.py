"""
briefing/assemble.py — the parts of an issue that come from data, not prose.

Both writers (the model in write.py, the rehearsal in rehearsal.py) use
these: the cover's facts, the figures drawn from the evidence (a map of the
period's events numbered by their S-ids, and the per-day chart), the
imagery part with our own crops, the source register (web sources Q-xx, and
the own signals the text cites), and the method's numbers (the funnel).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import re

from . import figures, spec

MONTHS = {
    "de": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    "fr": ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
}
CAT = {
    "de": {"maritime": "Seelage", "aviation": "Luftlage", "navigation": "Navigationsstörung", "unrest": "Unruhen und Proteste",
           "sabotage": "Sabotage und hybride Vorgänge", "kinetic": "Gewalt und Angriffe", "fire": "Brände und Hitzepunkte",
           "crime": "Kriminalität", "other": "Sonstiges"},
    "en": {"maritime": "Maritime", "aviation": "Air picture", "navigation": "Navigation interference", "unrest": "Unrest and protest",
           "sabotage": "Sabotage and hybrid activity", "kinetic": "Violence and attacks", "fire": "Fires and heat",
           "crime": "Crime", "other": "Other"},
    "fr": {"maritime": "Situation maritime", "aviation": "Situation aérienne", "navigation": "Brouillage de navigation",
           "unrest": "Troubles et manifestations", "sabotage": "Sabotage et actions hybrides", "kinetic": "Violences et attaques",
           "fire": "Incendies et points chauds", "crime": "Criminalité", "other": "Autres"},
}
CAT_COLOR = {"maritime": "#2f5c90", "aviation": "#5f7a5c", "navigation": "#a89f68", "unrest": "#a85f3a", "sabotage": "#8b3a2f",
             "kinetic": "#1b1f24", "fire": "#b8892f", "crime": "#6b6b6b", "other": "#9a948a"}
WORDS = {
    "de": {"from": "", "map_title": "Vorgänge im Berichtszeitraum", "chart_title": "Erfasste Signale je Tag",
           "map_caption": "Ereignisse des Berichtszeitraums, nummeriert nach Signal-ID. Quelle: Parallax.",
           "chart_caption": "Signale je Tag und Kategorie, die einen Expositionsvektor erreichen (vor Zusammenführung). Quelle: Parallax.",
           "img_caption": "{what}, {place}, {date}. Eigene Erkennung (Parallax), Kasten = Fundstelle.",
           "own": "Parallax-Signal", "signals": "Signale", "publisher": "Trifecta Technologies · Parallax"},
    "en": {"map_title": "Events in the reporting period", "chart_title": "Signals per day",
           "map_caption": "Events of the reporting period, numbered by signal id. Source: Parallax.",
           "chart_caption": "Signals per day and category that reach an exposure vector (before merging). Source: Parallax.",
           "img_caption": "{what}, {place}, {date}. Our own detection (Parallax); box = finding.",
           "own": "Parallax signal", "signals": "signals", "publisher": "Trifecta Technologies · Parallax"},
    "fr": {"map_title": "Événements de la période", "chart_title": "Signaux par jour",
           "map_caption": "Événements de la période, numérotés par identifiant de signal. Source : Parallax.",
           "chart_caption": "Signaux par jour et catégorie atteignant un vecteur d'exposition (avant fusion). Source : Parallax.",
           "img_caption": "{what}, {place}, {date}. Détection propre (Parallax) ; cadre = constat.",
           "own": "Signal Parallax", "signals": "signaux", "publisher": "Trifecta Technologies · Parallax"},
}


def _dt_of(s) -> _dt.datetime:
    t = _dt.datetime.fromisoformat(str(s).replace("Z", "+00:00").replace(" ", "T"))
    return t if t.tzinfo else t.replace(tzinfo=_dt.timezone.utc)


def date_label(t: _dt.datetime, lang: str, year: bool = True) -> str:
    m = MONTHS[lang][t.month - 1]
    if lang == "en":
        return f"{t.day} {m}" + (f" {t.year}" if year else "")
    return f"{t.day}{'.' if lang == 'de' else ''} {m}" + (f" {t.year}" if year else "")


def short_date(when, lang: str) -> str:
    t = _dt_of(when)
    return f"{t.day:02d}.{t.month:02d}." if lang == "de" else (f"{t.day:02d}/{t.month:02d}" if lang == "fr" else f"{t.day} {MONTHS['en'][t.month - 1][:3]}")


def period_label(start: _dt.datetime, end: _dt.datetime, lang: str) -> str:
    last = end - _dt.timedelta(seconds=1)
    if start.date() == last.date():
        return date_label(last, lang)
    return f"{date_label(start, lang, year=start.year != last.year)} – {date_label(last, lang)}"


def meta(profile: dict, cadence: str, lang: str, start: _dt.datetime, end: _dt.datetime, run_id: str = "") -> dict:
    L = spec.LABELS[lang]
    org = profile.get("org") or (profile.get("contact") or {}).get("name") or "—"
    code = re.sub(r"[^A-Z]", "", org.upper())[:3] or "ORG"
    serial = f"PLX-{end:%Y-%m%d}-{code}-{cadence[0].upper()}{(run_id or hashlib.sha1(str(end).encode()).hexdigest())[:4].upper()}"
    ctx_start = end - _dt.timedelta(days=spec.CONTEXT_DAYS[cadence])
    title = f"{L[cadence]} — {period_label(start, end, lang)}"
    return {"language": lang, "cadence": cadence, "title": title, "org": org, "addressee": profile.get("addressee") or "—",
            "serial": serial, "issue_no": f"{end:%m}", "month_label": f"{MONTHS[lang][end.month - 1]} {end.year}",
            "period_label": period_label(start, end, lang), "context_label": period_label(ctx_start, end, lang),
            "cutoff_label": f"{date_label(end, lang)}, {end:%H:%M} Z", "publisher": WORDS[lang]["publisher"],
            "publisher_line": "Parallax Intelligence", "domains": "", "template_version": "PLX 1.0",
            "contact": profile.get("contact") or {}, "rehearsal": False}


def domains(evidence: dict) -> str:
    names = {"alerts": "AIS · ADS-B · GNSS", "fusion": "Fusion", "telegram": "Telegram", "geoconfirmed": "GeoConfirmed",
             "gdelt": "GDELT", "news": "News", "surge": "News", "imagery": "Sentinel-1/2"}
    got = [names[k] for k, v in (evidence.get("funnel", {}).get("read_by_store") or {}).items() if v and k in names]
    return " · ".join(dict.fromkeys(got)) or "—"


def figure_set(evidence: dict, lang: str, focus_iso: str | None = None) -> dict:
    """F1: map of the events; F2: signals per day by category (weekly and monthly)."""
    W = WORDS[lang]
    out = {}
    ev = [e for e in evidence.get("events") or [] if e.get("lat") is not None]
    if ev:
        top = sorted(ev, key=lambda e: -e["score"])[:24]
        pts = [{"lat": e["lat"], "lon": e["lon"], "n": e["sid"].split("-")[1].lstrip("0") or "0",
                "color": CAT_COLOR.get(e["category"], CAT_COLOR["other"])} for e in top]
        cats = list(dict.fromkeys(e["category"] for e in top))
        legend = [(CAT[lang].get(c, c), CAT_COLOR.get(c, CAT_COLOR["other"])) for c in cats]
        out["F1"] = {"number": 1, "html": figures.place_map(pts, focus_iso=focus_iso, legend_title=W["map_title"].upper(), legend=legend),
                     "caption": W["map_caption"]}
    s = evidence.get("series") or {}
    if evidence.get("cadence") != "daily" and s.get("counts"):
        days = s["days"]
        totals = [sum(v[i] for v in s["counts"].values()) for i in range(len(days))]
        labels = [short_date(d + "T00:00:00", lang) for d in days]
        if len(labels) > 16:
            labels = [lb if i % 3 == 0 else "" for i, lb in enumerate(labels)]
        out["F2"] = {"number": 2, "html": figures.bars(labels, totals, title=W["chart_title"], ylabel=W["signals"],
                                                       width_in=6.4, height_in=2.4), "caption": W["chart_caption"]}
    return out


def imagery_part(evidence: dict, lang: str, first_number: int) -> dict:
    W = WORDS[lang]
    items = []
    for e in evidence.get("events") or []:
        if not e.get("image"):
            continue
        what = re.sub(r"\s+detected$", "", e["title"]).strip()
        items.append({"src": e["image"], "number": first_number + len(items), "sid": e["sid"],
                      "caption": W["img_caption"].format(what=what[:1].upper() + what[1:], place=e.get("place") or e.get("country") or "",
                                                         date=date_label(_dt_of(e["when"]), lang)) + (f" ({e['detail']})" if e.get("detail") else "") + f" [{e['sid']}]",
                      "text": ""})
    return {"items": items}


def sources(findings: list[dict], evidence: dict, doc: dict, lang: str) -> list[dict]:
    """The register: the web sources the research kept (Q-xx), then the own
    signals the text cites (S-xx), each with tier and reliability."""
    out = [{"id": f["qid"], "title": f.get("title") or f.get("publisher") or f["url"], "url": f["url"], "tier": f.get("tier") or 3,
            "reliability": f.get("reliability") or "medium", "note": f.get("note") or ("interested party" if f.get("interested") else "—")}
           for f in findings]
    cited = set()
    import json as _json
    blob = _json.dumps({k: v for k, v in doc.items() if k not in ("figures", "sources", "evidence")}, ensure_ascii=False)
    cited |= set(re.findall(r"S-\d+", blob))
    for e in evidence.get("events") or []:
        if e["sid"] in cited:
            out.append({"id": e["sid"], "title": f"{WORDS[lang]['own']}: {e['title']} — {', '.join(e['sources'][:3])}, {short_date(e['when'], lang)}",
                        "url": e.get("url") or "", "tier": 4, "reliability": "high" if e["corroboration"] >= 2 else "medium",
                        "note": "—"})
    return out

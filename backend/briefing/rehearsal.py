"""
briefing/rehearsal.py — an issue built from the evidence alone, no model.

So the whole pipeline (profile → collect → figures → validate → print →
reader) runs and can be checked before the API is funded, and so a run
that hits its cost cap or loses the model still delivers. Every page says
REHEARSAL. What it writes is only what the evidence says — the events,
where, when, by whom reported, how corroborated — sorted into the issue's
fixed structure; judgments, scenarios and decisions are left out rather
than invented.
"""
from __future__ import annotations

from collections import Counter, defaultdict

from . import assemble, spec
from .countries import name as cname

P = {
    "de": {
        "lead": "{n} Vorgänge im Berichtszeitraum erreichen diesen Vektor; am häufigsten: {cats}.",
        "none": "Im Berichtszeitraum hat kein erfasster Vorgang diesen Vektor erreicht.",
        "pattern": "{title} — an {days} von {total} Tagen erfasst, {reports} Einzelmeldungen; zuletzt {last}{places}.",
        "places": "; Schwerpunkte: {p}",
        "event": "{date}, {place}: {title}{detail} Gemeldet von {src}{corr}.",
        "corr": ", unabhängig bestätigt durch {n} Quellenfamilien",
        "reach": {"site": "{km} km von {site}", "city": "in derselben Stadt wie {site}", "precedent": "gleiche Zielart wie {site}, anderswo im Land",
                  "country": "im Land", "keyword": "Stichworttreffer"},
        "meaning": "{n} Vorgänge, davon {near} am Standort selbst und {prec} als Präzedenzfall gleicher Zielart. Die Bewertung der Tragweite fehlt in dieser Probe; sie schreibt das Modell.",
        "kj_title": "{vec}: {n} relevante Vorgänge, an erster Stelle {top}.",
        "kj_body": "Stärkstes Signal: {top} ({date}, {place}) [{sid}]. Grundlage: {n} zusammengeführte Vorgänge aus {reports} Einzelmeldungen.",
        "change": "Probe", "drivers": "{n} Vorgänge; stärkster: {top}",
        "chrono_lead": "Die Vorgänge des Zeitraums in zeitlicher Folge, mit Signal-ID.",
        "ind_name": "{title} (Tage mit Meldung)", "ind_lead": "Fortlaufende Lagen aus den eigenen Sensoren, mit Stand im Zeitraum.",
        "gap_model": "Bewertung, Szenarien und Entscheidungen", "gap_model_why": "Diese Ausgabe ist eine Probe ohne Modell.",
        "gap_model_how": "Lauf mit freigeschaltetem Modell (BRIEFING_MODEL).",
        "gap_web": "Internetrecherche zu den Vorgängen", "gap_web_why": "Kontext, Zuschreibung und Zweitquellen fehlen.",
        "gap_web_how": "Recherchestufe des Modelllaufs.",
        "procedure": "Erfasst wurden {read} Signale aus {stores}. {reached} erreichten einen Expositionsvektor des Profils, sie wurden zu {events} Vorgängen zusammengeführt ({corr} davon unabhängig bestätigt), {used} wurden ausgewählt — geschichtet nach Tag und Vektor.",
        "weakest": "Ohne Modell bleibt jede Aussage beim beobachteten Vorgang; Wirkung und Wahrscheinlichkeit sind nicht bewertet.",
        "limits": "Die Nachrichtenbasis (GDELT) reicht nur wenige Tage zurück; ältere Zeiträume stützen sich auf die eigenen Sensoren.",
        "htr": ("Wahrscheinlichkeiten stehen immer als benanntes Band mit Zahlen.", "Konfidenz beschreibt die Belegdichte, nicht die Wahrscheinlichkeit.",
                "Aufbau der Abschnitte", "Jeder Abschnitt beginnt auf einer neuen Seite und endet mit der Bedeutung für den Adressaten.",
                "Herkunft", "S-Nummern sind eigene Parallax-Signale, Q-Nummern Quellen aus der Recherche."),
        "img_lead": "Eigene Erkennungen aus Satellitenbildern im Berichtszeitraum, Ausschnitte mit markierter Fundstelle.",
    },
    "en": {
        "lead": "{n} events in the period reach this vector; most frequent: {cats}.",
        "none": "No collected event reached this vector in the period.",
        "pattern": "{title} — recorded on {days} of {total} days, {reports} individual reports; last {last}{places}.",
        "places": "; mainly {p}",
        "event": "{date}, {place}: {title}{detail} Reported by {src}{corr}.",
        "corr": ", independently confirmed by {n} source families",
        "reach": {"site": "{km} km from {site}", "city": "in the same city as {site}", "precedent": "same kind of target as {site}, elsewhere in the country",
                  "country": "in the country", "keyword": "keyword match"},
        "meaning": "{n} events, {near} of them at the site itself and {prec} precedents against the same kind of target. The assessment of consequence is missing in this rehearsal; the model writes it.",
        "kj_title": "{vec}: {n} relevant events, led by {top}.",
        "kj_body": "Strongest signal: {top} ({date}, {place}) [{sid}]. Basis: {n} merged events from {reports} individual reports.",
        "change": "Rehearsal", "drivers": "{n} events; strongest: {top}",
        "chrono_lead": "The period's events in order, with signal id.",
        "ind_name": "{title} (days reported)", "ind_lead": "Standing conditions from our own sensors, with their state in the period.",
        "gap_model": "Assessment, scenarios and decisions", "gap_model_why": "This issue is a rehearsal without the model.",
        "gap_model_how": "Run with the model enabled (BRIEFING_MODEL).",
        "gap_web": "Web research on the events", "gap_web_why": "Context, attribution and second sources are missing.",
        "gap_web_how": "The research stage of a model run.",
        "procedure": "{read} signals were read from {stores}. {reached} reached an exposure vector of the profile; they were merged into {events} events ({corr} independently confirmed) and {used} were selected, stratified by day and vector.",
        "weakest": "Without the model every statement stays with the observed event; consequence and probability are not assessed.",
        "limits": "The news base (GDELT) reaches back a few days only; older periods rest on our own sensors.",
        "htr": ("Probabilities are always a named band with numbers.", "Confidence describes the density of evidence, not the probability.",
                "How sections are built", "Every section starts on a new page and ends with what it means for the reader.",
                "Provenance", "S numbers are Parallax's own signals, Q numbers sources from the research."),
        "img_lead": "Our own detections in satellite imagery during the period, cropped with the finding marked.",
    },
    "fr": {
        "lead": "{n} événements de la période atteignent ce vecteur ; les plus fréquents : {cats}.",
        "none": "Aucun événement collecté n'a atteint ce vecteur sur la période.",
        "pattern": "{title} — relevé {days} jours sur {total}, {reports} signalements ; dernier le {last}{places}.",
        "places": " ; principalement {p}",
        "event": "{date}, {place} : {title}{detail} Signalé par {src}{corr}.",
        "corr": ", confirmé indépendamment par {n} familles de sources",
        "reach": {"site": "à {km} km de {site}", "city": "dans la même ville que {site}", "precedent": "même type de cible que {site}, ailleurs dans le pays",
                  "country": "dans le pays", "keyword": "correspondance par mot-clé"},
        "meaning": "{n} événements, dont {near} sur le site même et {prec} précédents contre le même type de cible. L'évaluation de la portée manque dans cette répétition ; le modèle la rédige.",
        "kj_title": "{vec} : {n} événements pertinents, en tête {top}.",
        "kj_body": "Signal le plus fort : {top} ({date}, {place}) [{sid}]. Base : {n} événements fusionnés issus de {reports} signalements.",
        "change": "Répétition", "drivers": "{n} événements ; le plus fort : {top}",
        "chrono_lead": "Les événements de la période dans l'ordre, avec identifiant de signal.",
        "ind_name": "{title} (jours avec signalement)", "ind_lead": "Situations durables issues de nos capteurs, avec leur état sur la période.",
        "gap_model": "Évaluation, scénarios et décisions", "gap_model_why": "Ce numéro est une répétition sans modèle.",
        "gap_model_how": "Exécution avec le modèle activé (BRIEFING_MODEL).",
        "gap_web": "Recherche internet sur les événements", "gap_web_why": "Contexte, attribution et sources secondaires manquent.",
        "gap_web_how": "L'étape de recherche d'une exécution avec modèle.",
        "procedure": "{read} signaux ont été lus depuis {stores}. {reached} ont atteint un vecteur d'exposition du profil ; fusionnés en {events} événements ({corr} confirmés indépendamment), {used} ont été retenus, stratifiés par jour et par vecteur.",
        "weakest": "Sans le modèle, chaque énoncé s'en tient à l'événement observé ; portée et probabilité ne sont pas évaluées.",
        "limits": "La base d'actualités (GDELT) ne remonte que de quelques jours ; les périodes plus anciennes reposent sur nos capteurs.",
        "htr": ("Les probabilités sont toujours une fourchette nommée avec des chiffres.", "La confiance décrit la densité des preuves, pas la probabilité.",
                "Structure des sections", "Chaque section commence sur une nouvelle page et se termine par ce que cela signifie pour le lecteur.",
                "Provenance", "Les numéros S sont les signaux propres de Parallax, les numéros Q les sources de la recherche."),
        "img_lead": "Nos détections sur imagerie satellite pendant la période, recadrées avec le constat marqué.",
    },
}


def tag_of(e: dict) -> str:
    if e.get("interested_only"):
        return "REPORTED_INTERESTED"
    if e["corroboration"] >= 2:
        return "FACT"
    if e["kind"] in ("alert", "fusion", "imagery") or e.get("pattern"):
        return "OBSERVATION"
    return "REPORTED"


def sentence(e: dict, lang: str, total_days: int = 1) -> str:
    W = P[lang]
    d = assemble.short_date(e["when"], lang)
    if e.get("pattern"):
        places = W["places"].format(p=", ".join(e["places"][:3])) if e.get("places") else ""
        return W["pattern"].format(title=e["title"], days=e["days_active"], total=max(total_days, e["days_active"]),
                                   reports=e["reports"], last=assemble.short_date(e["last"], lang), places=places) + f" [{e['sid']}]"
    reach = W["reach"].get(e["reach"], "").format(km=e.get("km"), site=e.get("site") or "")
    place = e.get("place") or cname(e.get("country"), lang) or reach
    detail = ""
    if e.get("detail") and e["detail"][:60].lower() not in e["title"].lower():
        detail = f" — {e['detail'][:220].rstrip('.')}."
    else:
        detail = "."
    corr = W["corr"].format(n=e["corroboration"]) if e["corroboration"] >= 2 else ""
    return W["event"].format(date=d, place=place + (f" ({reach})" if reach and reach not in place else ""), title=e["title"].rstrip("."),
                             detail=detail, src=", ".join(e["sources"][:3]), corr=corr) + f" [{e['sid']}]"


SITE_TEXT = {
    "de": "Nächster Vorgang: {t} ({km} km) [{sid}].", "en": "Nearest event: {t} ({km} km) [{sid}].", "fr": "Événement le plus proche : {t} ({km} km) [{sid}].",
}


def site_rows(evidence: dict, lang: str) -> list[dict]:
    rows = []
    for s in evidence.get("sites") or []:
        n = s.get("nearest")
        rows.append({**s, "text": SITE_TEXT[lang].format(t=n["title"], km=n["km"], sid=n["sid"]) if n else ""})
    return rows


def build(profile: dict, evidence: dict, cadence: str, lang: str, start, end, run_id: str = "", reason: str = "") -> dict:
    W = P[lang]
    B = spec.BUDGET[cadence]
    parts = set(spec.parts_for(cadence))
    events = evidence.get("events") or []
    by_vec: dict[str, list] = defaultdict(list)
    for e in events:
        by_vec[e["vector"]].append(e)
    from .profile import localise
    import copy
    profile = localise(copy.deepcopy(profile), lang)
    vectors = [v for v in profile.get("vectors") or []]
    m = assemble.meta(profile, cadence, lang, start, end, run_id)
    m.update({"rehearsal": True, "domains": assemble.domains(evidence), "rehearsal_reason": reason})
    total_days = evidence.get("days") or 1

    # sections: the vectors with most weight, as many as the cadence takes
    weight = {v["id"]: sum(e["score"] for e in by_vec.get(v["id"], [])) for v in vectors}
    active = sorted([v for v in vectors if by_vec.get(v["id"])], key=lambda v: -weight[v["id"]])[:B["sections"]]
    figs = assemble.figure_set(evidence, lang, focus_iso=None)
    sections = []
    for i, v in enumerate(active, 1):
        evs = sorted(by_vec[v["id"]], key=lambda e: -e["score"])
        cats = Counter(e["category"] for e in evs)
        lead = W["lead"].format(n=len(evs), cats=", ".join(assemble.CAT[lang].get(c, c) for c, _ in cats.most_common(3)))
        near = sum(1 for e in evs if e["reach"] in ("site", "city"))
        prec = sum(1 for e in evs if e["reach"] == "precedent")
        meaning = {"type": "meaning", "text": W["meaning"].format(n=len(evs), near=near, prec=prec)}
        per_block = {"daily": 4, "weekly": 6, "monthly": 10}[cadence]
        if cadence == "daily":
            blocks = [{"type": "p", "tag": tag_of(e), "text": sentence(e, lang, total_days)} for e in evs[:per_block]] + [meaning]
            sections.append({"id": f"s{i}", "number": str(i), "kicker": f"{v['id']}", "title": v["name"], "lead": lead, "subsections": [], "blocks": blocks})
            continue
        subs = []
        for j, (c, _) in enumerate(cats.most_common(4), 1):
            ce = [e for e in evs if e["category"] == c][:per_block]
            blocks = [{"type": "p", "tag": tag_of(e), "text": sentence(e, lang, total_days)} for e in ce]
            top = ce[0]
            blocks.append({"type": "signal", "id": top["sid"], "text": top["title"],
                           "meta": f"{assemble.short_date(top['when'], lang)} · {top.get('place') or top.get('country') or ''} · {', '.join(top['sources'][:2])}"})
            subs.append({"id": f"s{i}_{j}", "number": f"{i}.{j}", "title": assemble.CAT[lang].get(c, c), "blocks": blocks})
        if i == 1 and "F1" in figs:
            subs[0]["blocks"].insert(0, {"type": "figure", "figure": "F1"})
        subs[-1]["blocks"].append(meaning)
        sections.append({"id": f"s{i}", "number": str(i), "kicker": v["id"], "title": v["name"], "lead": lead, "subsections": subs, "blocks": []})

    kj = []
    for v in active[:B["kj"]]:
        evs = sorted(by_vec[v["id"]], key=lambda e: -e["score"])
        top = evs[0]
        kj.append({"id": f"KJ-{len(kj) + 1}", "title": W["kj_title"].format(vec=v["name"], n=len(evs), top=top["title"].rstrip(".")),
                   "body": W["kj_body"].format(top=top["title"].rstrip("."), date=assemble.short_date(top["when"], lang),
                                               place=top.get("place") or top.get("country") or "", sid=top["sid"], n=len(evs),
                                               reports=sum(e["reports"] for e in evs)),
                   "band": "even", "low": 45, "high": 55, "confidence": "low", "change": W["change"]})

    doc = {"meta": m, "key_judgments": kj, "sections": sections, "figures": figs, "sites": site_rows(evidence, lang)}
    if "exposure" in parts:
        rows = []
        for v in vectors:
            evs = by_vec.get(v["id"], [])
            lvl = 1 + min(4, int(sum(e["score"] for e in evs) // 0.6))
            top = max(evs, key=lambda e: e["score"])["title"] if evs else "—"
            rows.append({"id": v["id"], "name": v["name"], "level": lvl, "prev": "—", "delta": "—",
                         "drivers": W["drivers"].format(n=len(evs), top=top[:90]) if evs else "—", "decision": v.get("decision_area") or "—"})
        doc["exposure"] = {"lead": "", "vectors": rows, "movement": ""}
    if "chronology" in parts:
        rows = sorted(events, key=lambda e: -e["score"])[:B["chrono"]]
        doc["chronology"] = {"kicker": "", "lead": W["chrono_lead"],
                             "rows": [{"date": assemble.short_date(e["when"], lang), "event": f"{e['title']} [{e['sid']}]", "vector": e["vector"], "tag": tag_of(e)}
                                      for e in sorted(rows, key=lambda e: e["when"])]}
    if "how_to_read" in parts:
        h = W["htr"]
        doc["how_to_read"] = {"bands": h[0], "confidence": h[1], "layout_title": h[2], "layout": h[3], "provenance_title": h[4], "provenance": h[5]}
    if "imagery" in parts:
        im = assemble.imagery_part(evidence, lang, first_number=len(figs) + 1)
        if im["items"]:
            im["lead"] = W["img_lead"]
            doc["imagery"] = im
    if "indicators" in parts:
        pats = [e for e in events if e.get("pattern")][:B["indicators"]]
        doc["indicators"] = {"lead": W["ind_lead"], "rows": [
            {"id": f"I-{k}", "name": W["ind_name"].format(title=e["detector"].replace("_", " ")), "threshold": "—",
             "current": f"{e['days_active']}/{total_days}", "trend": "—", "lead": "—"} for k, e in enumerate(pats, 1)]} if pats else None
    if "gaps" in parts:
        doc["gaps"] = {"rows": [{"id": "L-1", "what": W["gap_model"], "why": W["gap_model_why"] + (f" ({reason})" if reason else ""), "clarify": W["gap_model_how"]},
                                {"id": "L-2", "what": W["gap_web"], "why": W["gap_web_why"], "clarify": W["gap_web_how"]}], "excluded": []}
    if "method" in parts:
        f = evidence.get("funnel") or {}
        doc["method"] = {"procedure": W["procedure"].format(read=f.get("read", 0), stores=assemble.domains(evidence), reached=f.get("reached", 0),
                                                            events=f.get("events", 0), corr=f.get("corroborated", 0), used=f.get("used", 0)),
                         "checks": [], "weakest": W["weakest"], "internal": "", "limits": W["limits"]}
    doc["glossary"] = []
    doc["sources"] = assemble.sources([], evidence, doc, lang)
    return doc

"""
briefing/spec.py — what a Parallax briefing IS, fixed in advance.

Every briefing follows one predetermined structure (the owner, 2026-10-07,
after comparing the Trifecta "Lagebericht" with what Parallax produced): the
logo, a cover sheet, contents, key judgments, the exposure register, the
decisions to take, a dated chronology, sections each ending in what it means
for the reader, the analyst desk, scenarios, indicators, calendar, gaps,
sources, method and glossary. The cadence decides the depth, not the logic:

    daily    ~2 pages    what changed, what to watch
    weekly   ~10 pages   the week's picture against the exposure register
    monthly  30–40 pages the full assessment, with the analyst desk

The model never invents the structure. It fills the parts this file names,
in the language chosen (German, English or French), in the labels below.
"""
from __future__ import annotations

CADENCES = ("daily", "weekly", "monthly")
LANGUAGES = ("de", "en", "fr")

# Parts in order. "min" is the cadence from which the part appears.
# pages: rough budget per cadence, used to size what the writer is asked for.
PARTS = [
    # key            daily  weekly  monthly   what it is
    ("cover",         True,  True,   True),    # cover sheet (daily: a header band, not a page)
    ("key_judgments", True,  True,   True),    # 3 (daily) / 4 (weekly) / 5 (monthly) judgments
    ("contents",      False, True,   True),    # table of contents with page numbers
    ("exposure",      False, True,   True),    # exposure register: vectors, level 1–5, change
    ("decisions",     False, True,   True),    # decisions with owner and date
    ("how_to_read",   False, False,  True),    # conventions: tags, probability bands, confidence
    ("chronology",    True,  True,   True),    # dated chain of events
    ("sections",      True,  True,   True),    # one section per active vector (daily: what changed, what to watch)
    ("imagery",       False, True,   True),    # our own detections, with the crops
    ("analyst_desk",  False, False,  True),    # the question, competing hypotheses, assumptions, counter-argument
    ("scenarios",     False, True,   True),    # 30–90 day branches with triggers
    ("indicators",    True,  True,   True),    # tracked quantities with thresholds
    ("calendar",      False, True,   True),    # dated horizon, wildcards
    ("gaps",          False, True,   True),    # what could not be established, what was left out
    ("exposure_cards", False, False, True),    # one card per vector at level 3+
    ("sources",       True,  True,   True),    # source register with tier and reliability
    ("method",        False, False,  True),    # method, checks, weakest point, limits
    ("glossary",      True,  True,   True),    # every acronym and term used
]


def parts_for(cadence: str) -> list[str]:
    i = CADENCES.index(cadence)
    return [p[0] for p in PARTS if p[1 + i]]


BUDGET = {
    #           pages      key judgments  sections  words per section  chronology rows  indicators  sources
    "daily":   {"pages": (2, 3),   "kj": 3, "sections": 2, "words": 220,    "chrono": 8,  "indicators": 5,  "sources": 12},
    "weekly":  {"pages": (9, 12),  "kj": 4, "sections": 4, "words": 550,  "chrono": 14, "indicators": 10, "sources": 20},
    "monthly": {"pages": (30, 40), "kj": 5, "sections": 7, "words": 1300, "chrono": 22, "indicators": 14, "sources": 30},
}

# How far back the analysis looks, beyond the reporting period itself.
CONTEXT_DAYS = {"daily": 7, "weekly": 30, "monthly": 183}
PERIOD_DAYS = {"daily": 1, "weekly": 7, "monthly": 31}

# ── words: the conventions of every issue, in three languages ────────────────

# Statement tags. Fact = two independent sources; reported = one; interested
# party = a party to the conflict or state-aligned source; assessment = our
# analysts' conclusion; assumption = load-bearing, unproven; gap = needed but
# not establishable; forecast = falsifiable, with indicator and date;
# observation = recorded by the system, without our assessment.
TAGS = ("FACT", "REPORTED", "REPORTED_INTERESTED", "ASSESSMENT", "ASSUMPTION", "GAP", "FORECAST", "OBSERVATION")
TAG_LABEL = {
    "de": {"FACT": "FAKT", "REPORTED": "GEMELDET", "REPORTED_INTERESTED": "GEMELDET / INTERESSIERTE PARTEI",
           "ASSESSMENT": "BEWERTUNG", "ASSUMPTION": "ANNAHME", "GAP": "LÜCKE", "FORECAST": "PROGNOSE", "OBSERVATION": "BEOBACHTUNG"},
    "en": {"FACT": "FACT", "REPORTED": "REPORTED", "REPORTED_INTERESTED": "REPORTED / INTERESTED PARTY",
           "ASSESSMENT": "ASSESSMENT", "ASSUMPTION": "ASSUMPTION", "GAP": "GAP", "FORECAST": "FORECAST", "OBSERVATION": "OBSERVATION"},
    "fr": {"FACT": "FAIT", "REPORTED": "SIGNALÉ", "REPORTED_INTERESTED": "SIGNALÉ / PARTIE INTÉRESSÉE",
           "ASSESSMENT": "ÉVALUATION", "ASSUMPTION": "HYPOTHÈSE", "GAP": "LACUNE", "FORECAST": "PRÉVISION", "OBSERVATION": "OBSERVATION"},
}
TAG_MEANING = {
    "de": {"FACT": "Durch mindestens zwei unabhängige Quellen belegt.", "REPORTED": "Von einer Quelle berichtet, nicht unabhängig bestätigt.",
           "REPORTED_INTERESTED": "Von einer Konfliktpartei oder staatsnahen Quelle berichtet.",
           "ASSESSMENT": "Schlussfolgerung unserer Analyse, nicht des Systems.", "ASSUMPTION": "Tragende Annahme ohne eigenen Beleg, ausdrücklich ausgewiesen.",
           "GAP": "Erforderlich, aber nicht feststellbar.", "FORECAST": "Falsifizierbare Vorhersage mit Beobachtungsgröße und Frist.",
           "OBSERVATION": "Vom System erfasster Vorgang ohne eigene Bewertung."},
    "en": {"FACT": "Established by at least two independent sources.", "REPORTED": "Reported by one source, not independently confirmed.",
           "REPORTED_INTERESTED": "Reported by a party to the conflict or a state-aligned source.",
           "ASSESSMENT": "Our analysts' conclusion, not the system's.", "ASSUMPTION": "A load-bearing assumption without its own evidence, stated as such.",
           "GAP": "Needed, but not establishable.", "FORECAST": "A falsifiable prediction with an observable quantity and a deadline.",
           "OBSERVATION": "Recorded by the system, without our assessment."},
    "fr": {"FACT": "Établi par au moins deux sources indépendantes.", "REPORTED": "Rapporté par une seule source, non confirmé de façon indépendante.",
           "REPORTED_INTERESTED": "Rapporté par une partie au conflit ou une source proche d'un État.",
           "ASSESSMENT": "Conclusion de nos analystes, non du système.", "ASSUMPTION": "Hypothèse porteuse sans preuve propre, signalée comme telle.",
           "GAP": "Nécessaire mais impossible à établir.", "FORECAST": "Prévision réfutable, avec un indicateur observable et une échéance.",
           "OBSERVATION": "Événement enregistré par le système, sans évaluation de notre part."},
}

# Probability bands, always given with their numbers; confidence kept apart.
BANDS = [  # key, low, high
    ("remote", 1, 5), ("very_unlikely", 5, 20), ("unlikely", 20, 45), ("even", 45, 55),
    ("likely", 55, 80), ("very_likely", 80, 95), ("almost_certain", 95, 99),
]
BAND_LABEL = {
    "de": {"remote": "nahezu ausgeschlossen", "very_unlikely": "sehr unwahrscheinlich", "unlikely": "unwahrscheinlich",
           "even": "etwa gleich wahrscheinlich", "likely": "wahrscheinlich", "very_likely": "sehr wahrscheinlich", "almost_certain": "nahezu sicher"},
    "en": {"remote": "remote", "very_unlikely": "very unlikely", "unlikely": "unlikely", "even": "roughly even chance",
           "likely": "likely", "very_likely": "very likely", "almost_certain": "almost certain"},
    "fr": {"remote": "quasi exclu", "very_unlikely": "très improbable", "unlikely": "improbable", "even": "à peu près aussi probable qu'improbable",
           "likely": "probable", "very_likely": "très probable", "almost_certain": "quasi certain"},
}
CONFIDENCE = ("low", "medium", "high")
CONFIDENCE_LABEL = {"de": {"low": "niedrig", "medium": "mittel", "high": "hoch"},
                    "en": {"low": "low", "medium": "medium", "high": "high"},
                    "fr": {"low": "faible", "medium": "moyenne", "high": "élevée"}}
LEVELS = {  # exposure levels 1–5
    "de": ["Niedrig", "Moderat", "Erhöht", "Hoch", "Kritisch"],
    "en": ["Low", "Moderate", "Elevated", "High", "Critical"],
    "fr": ["Faible", "Modéré", "Élevé", "Haut", "Critique"],
}
LEVEL_MEANING = {
    "de": ["Regelbetrieb, keine Anpassung.", "Erhöhte Aufmerksamkeit, Unterrichtung Reisender.",
           "Nicht zwingende Reisen prüfen, Bewegungsregeln, Begleitung erwägen.",
           "Nicht zwingende Reisen aussetzen, Objektschutz anheben, Evakuierungsplanung auffrischen und üben.",
           "Entscheidung über Evakuierung oder Schutzraumaufenthalt ist aktiv."],
    "en": ["Normal operations, no change.", "Heightened attention; brief travellers.",
           "Review non-essential travel, movement rules, consider escorts.",
           "Suspend non-essential travel, raise site protection, refresh and rehearse evacuation plans.",
           "A decision on evacuation or sheltering is live."],
    "fr": ["Fonctionnement normal, aucun ajustement.", "Vigilance accrue ; informer les voyageurs.",
           "Revoir les déplacements non essentiels, règles de mouvement, envisager une escorte.",
           "Suspendre les déplacements non essentiels, renforcer la protection des sites, actualiser et exercer les plans d'évacuation.",
           "Une décision d'évacuation ou de mise à l'abri est en cours."],
}

LABELS = {
    "de": {
        "issue": "Ausgabe Nr.", "monthly": "Monatlicher Lagebericht", "weekly": "Wöchentlicher Lagebericht", "daily": "Tageslage",
        "for": "Unternehmensbezogene Lagebeurteilung für", "period": "Berichtszeitraum", "context": "Analytisches Kontextfenster",
        "serial": "Seriennummer", "addressee": "Adressat", "cutoff": "Redaktionsschluss", "publisher": "Herausgeber",
        "domains": "Erfasste Domänen", "template": "Vorlagenversion", "contact": "Ansprechpartner", "page": "Seite", "of": "von",
        "key_judgments": "Kernaussagen", "kj_lead": "Feststellungen, geordnet nach Tragweite. Jede nennt die Konsequenz, das Wahrscheinlichkeitsband und die Konfidenz. Wer nach dieser Seite aufhört zu lesen, ist zutreffend unterrichtet.",
        "probability": "Wahrscheinlichkeit", "confidence": "Konfidenz", "change": "Veränderung",
        "exposure": "Expositionsregister", "vector": "Expositionsvektor", "level": "Stufe", "prev": "Vormonat", "drivers": "Treiber im Berichtszeitraum", "decision_touched": "Berührte Entscheidung",
        "decisions": "Entscheidungsdossier", "decide": "Zu entscheiden", "owner": "Zuständig", "due": "Termin", "urgency": "Dringlichkeit", "rationale": "Begründungen",
        "contents": "Inhalt", "how_to_read": "Zum Gebrauch dieses Berichts", "chronology": "Der Zeitraum im Verlauf", "date": "Datum", "event": "Vorgang", "class": "Einstufung",
        "meaning_for": "Bedeutung für", "imagery": "Eigene Bilderkennung", "analyst_desk": "Analystentisch", "question": "Die Frage",
        "hypotheses": "Analyse konkurrierender Hypothesen", "assumptions": "Prüfung der tragenden Annahmen", "counter": "Gegenrede",
        "would_change": "Was die Bewertung ändern würde", "analogues": "Vergleichsfälle", "scenarios": "Szenarien und Auslöseschwellen",
        "trigger": "Auslöser", "measure": "Maßnahme", "indicators": "Indikatoren und Frühwarnung", "threshold": "Schwelle", "current": "Stand",
        "trend": "Trend", "lead_time": "Vorlauf", "calendar": "Horizontkalender und Wildcards", "wildcards": "Wildcards",
        "gaps": "Erfassungslücken und Aussortiertes", "excluded": "Bewusst nicht aufgenommen", "exposure_cards": "Expositionskarten",
        "sources": "Belegverzeichnis", "tier": "St.", "reliability": "Verlässlichkeit", "note": "Anmerkung", "method": "Methodik, Prüfung und Grenzen",
        "glossary": "Glossar und Abkürzungen", "term": "Begriff", "meaning": "Bedeutung in diesem Bericht", "figure": "Abb.", "source": "Quelle",
        "watch": "Worauf zu achten ist", "what_changed": "Was sich änderte", "why_matters": "Warum es zählt", "rehearsal": "PROBE — nicht vom Modell verfasst",
    },
    "en": {
        "issue": "Issue no.", "monthly": "Monthly Situation Report", "weekly": "Weekly Situation Report", "daily": "Daily Brief",
        "for": "Company-specific situation assessment for", "period": "Reporting period", "context": "Analytical context window",
        "serial": "Serial number", "addressee": "Addressee", "cutoff": "Information cut-off", "publisher": "Publisher",
        "domains": "Domains collected", "template": "Template version", "contact": "Contact", "page": "Page", "of": "of",
        "key_judgments": "Key Judgments", "kj_lead": "Findings ordered by consequence. Each states the consequence, the probability band and the confidence. Stop reading after this page and you are correctly informed.",
        "probability": "Probability", "confidence": "Confidence", "change": "Change",
        "exposure": "Exposure Register", "vector": "Exposure vector", "level": "Level", "prev": "Previous", "drivers": "Drivers this period", "decision_touched": "Decision affected",
        "decisions": "Decision Dossier", "decide": "To decide", "owner": "Owner", "due": "Due", "urgency": "Urgency", "rationale": "Rationale",
        "contents": "Contents", "how_to_read": "How to Read This Report", "chronology": "The Period in Sequence", "date": "Date", "event": "Event", "class": "Classification",
        "meaning_for": "What it means for", "imagery": "Our Own Imagery Detections", "analyst_desk": "Analyst Desk", "question": "The Question",
        "hypotheses": "Analysis of Competing Hypotheses", "assumptions": "Key Assumptions Check", "counter": "Devil's Advocate",
        "would_change": "What Would Change the Assessment", "analogues": "Comparable Cases", "scenarios": "Scenarios and Triggers",
        "trigger": "Trigger", "measure": "Measure", "indicators": "Indicators and Early Warning", "threshold": "Threshold", "current": "Current",
        "trend": "Trend", "lead_time": "Lead time", "calendar": "Horizon Calendar and Wildcards", "wildcards": "Wildcards",
        "gaps": "Collection Gaps and Exclusions", "excluded": "Deliberately excluded", "exposure_cards": "Exposure Cards",
        "sources": "Source Register", "tier": "Tier", "reliability": "Reliability", "note": "Note", "method": "Method, Checks and Limits",
        "glossary": "Glossary and Abbreviations", "term": "Term", "meaning": "Meaning in this report", "figure": "Fig.", "source": "Source",
        "watch": "What to watch", "what_changed": "What changed", "why_matters": "Why it matters", "rehearsal": "REHEARSAL — not written by the model",
    },
    "fr": {
        "issue": "Numéro", "monthly": "Rapport de situation mensuel", "weekly": "Rapport de situation hebdomadaire", "daily": "Point quotidien",
        "for": "Évaluation de situation propre à l'entreprise pour", "period": "Période couverte", "context": "Fenêtre d'analyse",
        "serial": "Numéro de série", "addressee": "Destinataire", "cutoff": "Date de clôture", "publisher": "Éditeur",
        "domains": "Domaines collectés", "template": "Version du modèle", "contact": "Contact", "page": "Page", "of": "sur",
        "key_judgments": "Jugements clés", "kj_lead": "Constats classés par portée. Chacun indique la conséquence, la fourchette de probabilité et le niveau de confiance. Qui s'arrête après cette page est correctement informé.",
        "probability": "Probabilité", "confidence": "Confiance", "change": "Évolution",
        "exposure": "Registre d'exposition", "vector": "Vecteur d'exposition", "level": "Niveau", "prev": "Précédent", "drivers": "Facteurs de la période", "decision_touched": "Décision concernée",
        "decisions": "Dossier de décision", "decide": "À décider", "owner": "Responsable", "due": "Échéance", "urgency": "Urgence", "rationale": "Justifications",
        "contents": "Sommaire", "how_to_read": "Mode d'emploi du rapport", "chronology": "La période en séquence", "date": "Date", "event": "Événement", "class": "Classification",
        "meaning_for": "Ce que cela signifie pour", "imagery": "Nos détections d'imagerie", "analyst_desk": "Bureau d'analyse", "question": "La question",
        "hypotheses": "Analyse des hypothèses concurrentes", "assumptions": "Vérification des hypothèses porteuses", "counter": "Avocat du diable",
        "would_change": "Ce qui changerait l'évaluation", "analogues": "Cas comparables", "scenarios": "Scénarios et seuils de déclenchement",
        "trigger": "Déclencheur", "measure": "Mesure", "indicators": "Indicateurs et alerte précoce", "threshold": "Seuil", "current": "Niveau actuel",
        "trend": "Tendance", "lead_time": "Délai", "calendar": "Calendrier et cartes blanches", "wildcards": "Cartes blanches",
        "gaps": "Lacunes et éléments écartés", "excluded": "Délibérément écartés", "exposure_cards": "Fiches d'exposition",
        "sources": "Registre des sources", "tier": "Niv.", "reliability": "Fiabilité", "note": "Remarque", "method": "Méthode, contrôles et limites",
        "glossary": "Glossaire et abréviations", "term": "Terme", "meaning": "Sens dans ce rapport", "figure": "Fig.", "source": "Source",
        "watch": "Points de vigilance", "what_changed": "Ce qui a changé", "why_matters": "Pourquoi cela compte", "rehearsal": "RÉPÉTITION — non rédigé par le modèle",
    },
}

# Source tiers: 1 official, 2 international agencies and leading media,
# 3 regional / foreign-language press (alignment named), 4 specialist press and
# aggregation, 5 institutes and vendors (framing, not facts). Our own signal
# inventory is tier 4 by convention.
SOURCE_TIERS = (1, 2, 3, 4, 5)


def band_of(low: int, high: int) -> str | None:
    """The named band whose numbers these are, or None."""
    for k, lo, hi in BANDS:
        if (lo, hi) == (int(low), int(high)):
            return k
    return None


# ── what a run costs (shown before it starts; capped) ───────────────────────
# Opus 5.5 list prices, 2026-10 (platform.claude.com/docs/en/about-claude/pricing):
# $4 / M input, $20 / M output, $0.20 / M cached input; web search $10 / 1,000.
# Environment overrides keep a price change or a model switch to one edit.
import os as _os

MODEL = _os.getenv("BRIEFING_MODEL", "claude-opus-5-5")
PRICE_IN = float(_os.getenv("BRIEFING_PRICE_IN_PER_M", "4"))
PRICE_OUT = float(_os.getenv("BRIEFING_PRICE_OUT_PER_M", "20"))
PRICE_CACHED = float(_os.getenv("BRIEFING_PRICE_CACHED_PER_M", "0.2"))
PRICE_SEARCH = float(_os.getenv("BRIEFING_PRICE_PER_SEARCH", "0.01"))

# Expected volume per cadence: tokens in, of which cached share, out, searches.
VOLUME = {
    "daily":   {"in": 80_000,    "cached": 0.4, "out": 6_000,  "searches": 8},
    "weekly":  {"in": 300_000,   "cached": 0.6, "out": 25_000, "searches": 20},
    "monthly": {"in": 1_100_000, "cached": 0.7, "out": 80_000, "searches": 50},
}


def estimate(cadence: str) -> dict:
    v = VOLUME[cadence]
    cached = v["in"] * v["cached"]
    low = (v["in"] - cached) * PRICE_IN / 1e6 + cached * PRICE_CACHED / 1e6 + v["out"] * PRICE_OUT / 1e6 + v["searches"] * PRICE_SEARCH
    high = v["in"] * PRICE_IN / 1e6 + v["out"] * PRICE_OUT / 1e6 * 1.3 + v["searches"] * 1.5 * PRICE_SEARCH
    return {"model": MODEL, "usd_low": round(low, 2), "usd_high": round(high, 2),
            "tokens_in": v["in"], "tokens_out": v["out"], "searches": v["searches"],
            "pages": BUDGET[cadence]["pages"]}

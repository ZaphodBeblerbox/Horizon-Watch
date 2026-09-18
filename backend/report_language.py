"""
report_language.py — the briefing's output language.

English, German and French. The language is a property of the DELIVERABLE,
not of the evidence: item_ids, section keys, severity words and the two
provenance axes stay in their canonical English form in the model's JSON,
because they are validated against real snapshot ids and real enum values
downstream. Only the prose the analyst reads is translated.

Getting that boundary wrong is the obvious failure here: a model asked to
"write in German" will helpfully return "abschnitt": "seeaktivität" and
every claim is then dropped by validation, producing an empty report with
no visible error.
"""
from __future__ import annotations

LANGUAGES = {
    "en": {
        "name": "English",
        "label": "English",
        # The evidence-marking vocabulary. The reference deliverable marks
        # every statement with its epistemic status; without this the model
        # writes assertions and the reader cannot tell a two-source fact
        # from a single interested-party claim.
        "marks": {
            "fact": "[FACT]", "reported": "[REPORTED]",
            "interested": "[REPORTED / INTERESTED PARTY]",
            "assessment": "[ASSESSMENT]", "assumption": "[ASSUMPTION]",
            "gap": "[GAP]", "forecast": "[FORECAST]", "observation": "[OBSERVATION]",
        },
        "bands": ("almost certainly not (1-5%)", "very unlikely (5-20%)", "unlikely (20-45%)",
                  "roughly even (45-55%)", "likely (55-80%)", "very likely (80-95%)",
                  "almost certain (95-99%)"),
        "confidence": ("low", "medium", "high"),
    },
    "de": {
        "name": "German",
        "label": "Deutsch",
        "marks": {
            "fact": "[FAKT]", "reported": "[GEMELDET]",
            "interested": "[GEMELDET / INTERESSIERTE PARTEI]",
            "assessment": "[BEWERTUNG]", "assumption": "[ANNAHME]",
            "gap": "[LÜCKE]", "forecast": "[PROGNOSE]", "observation": "[BEOBACHTUNG]",
        },
        "bands": ("nahezu ausgeschlossen (1-5 %)", "sehr unwahrscheinlich (5-20 %)",
                  "unwahrscheinlich (20-45 %)", "etwa gleich wahrscheinlich (45-55 %)",
                  "wahrscheinlich (55-80 %)", "sehr wahrscheinlich (80-95 %)",
                  "nahezu sicher (95-99 %)"),
        "confidence": ("niedrig", "mittel", "hoch"),
    },
    "fr": {
        "name": "French",
        "label": "Français",
        "marks": {
            "fact": "[FAIT]", "reported": "[RAPPORTÉ]",
            "interested": "[RAPPORTÉ / PARTIE INTÉRESSÉE]",
            "assessment": "[ÉVALUATION]", "assumption": "[HYPOTHÈSE]",
            "gap": "[LACUNE]", "forecast": "[PRÉVISION]", "observation": "[OBSERVATION]",
        },
        "bands": ("quasiment exclu (1-5 %)", "très improbable (5-20 %)",
                  "improbable (20-45 %)", "à peu près équiprobable (45-55 %)",
                  "probable (55-80 %)", "très probable (80-95 %)",
                  "quasiment certain (95-99 %)"),
        "confidence": ("faible", "moyenne", "élevée"),
    },
}

DEFAULT = "en"


def normalise(code) -> str:
    """Accepts 'de', 'DE', 'de-DE', 'German', None."""
    if not code:
        return DEFAULT
    text = str(code).strip().lower().replace("_", "-")
    head = text.split("-")[0]
    if head in LANGUAGES:
        return head
    for key, spec in LANGUAGES.items():
        if text in (spec["name"].lower(), spec["label"].lower()):
            return key
    return DEFAULT


def spec(code) -> dict:
    return LANGUAGES[normalise(code)]


def prompt_block(code) -> str:
    """The language instruction handed to the drafting model."""
    lang = spec(code)
    marks = lang["marks"]
    if normalise(code) == DEFAULT:
        head = ("Write all prose in English.")
    else:
        head = (
            f"Write ALL prose — key_judgments, claim text, second_para, bottom_line, "
            f"warnings and action text — in {lang['name']} ({lang['label']}), in the register "
            f"a professional {lang['name']}-language intelligence product uses. Do NOT translate "
            f"or alter any of these, which are machine-validated identifiers and must stay "
            f"exactly as given: item_id values, cite_section values, the JSON keys themselves, "
            f"and the report section names (maritime_activity, aerial_activity, "
            f"imagery_detection, open_source_context, alerts_events, area_overview, "
            f"outlook_watch). A translated section name or key silently discards the claim."
        )
    return (
        f"{head}\n\n"
        f"Mark every substantive statement with its epistemic status, using exactly these "
        f"tokens at the start of the sentence they qualify:\n"
        f"  {marks['fact']} corroborated by at least two independent sources or modalities "
        f"(the evidence line says independent_modalities=2 or more)\n"
        f"  {marks['reported']} a single source, not independently confirmed\n"
        f"  {marks['interested']} reported by a party to the conflict or a state-linked source\n"
        f"  {marks['assessment']} your own conclusion, not something the evidence states\n"
        f"  {marks['gap']} something required for the judgement that the evidence does not contain\n"
        f"  {marks['forecast']} a falsifiable prediction, which must name an observable and a date\n"
        f"Express likelihood ONLY as one of these bands, never as a bare adjective: "
        f"{'; '.join(lang['bands'])}. State confidence separately as "
        f"{'/'.join(lang['confidence'])} — confidence describes the quality of the sourcing and "
        f"reasoning, likelihood describes whether the event happens. Never put the two in the "
        f"same sentence as though they were one scale."
    )

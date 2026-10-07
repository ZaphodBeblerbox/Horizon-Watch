"""
briefing/sample.py — a filled-in document for testing the layout.

Not a briefing: a fixture in the target structure (modelled on the Trifecta
Lagebericht the owner gave as the bar), with realistic paragraph lengths,
tables, figures and every part, so the renderer's page breaks, contents and
stamps can be checked without a model run.
"""
from __future__ import annotations

from . import figures


def para(n=1):
    base = ("Der Leipziger Vorfall ist nicht als Aufklärung, sondern als Wirkversuch gegen eine militärische Nachschublinie auf "
            "NATO-Gebiet zu lesen. Die Kombination aus vorbereiteter Relaisinfrastruktur, mehreren Luftfahrzeugen und Sprengstoff "
            "schließt Zufall praktisch aus [Q-06, Q-07]. Der Umstand, dass die vorhandene Abwehr die Drohne weder erkannte noch "
            "bekämpfte, ist für die eigene Standortplanung erheblicher als die Attribution [S-14]. ")
    return (base * n).strip()


def sample_doc(cadence: str = "monthly", language: str = "de") -> dict:
    chart = figures.bars(["Sabotage-\nverdacht", "Drohnen-\nvorfälle", "gesichtete\nDrohnen", "Spionage-\ndelikte"], [165, 747, 1068, 112],
                         title="Deutschland, Jan.–Aug. 2026 (BKA-Lagebild)", ylabel="Fälle", highlight=0)
    mp = figures.place_map([{"lat": 51.42, "lon": 12.24, "n": 1}, {"lat": 52.99, "lon": 8.25, "n": 2}, {"lat": 50.94, "lon": 6.96, "n": 3},
                            {"lat": 48.37, "lon": 10.9, "n": 4}, {"lat": 48.14, "lon": 11.58, "n": 5, "color": "#1b1f24"}],
                           bbox=(5.5, 47.2, 15.2, 55.1), focus_iso="DE", legend_title="VORFÄLLE 2026",
                           legend=["1 Leipzig/Halle, 04.08.", "2 Großenkneten, 09.08.", "3 Raum Köln, Juli", "4 Bayern, Juli", "5 München (EU-Sitz)"])
    sections = []
    titles = ["Ukraine: Personal, Standort, Nachfrage", "Zielprofil des Unternehmens", "Code- und Lieferkettenintegrität",
              "Standort Deutschland", "Exportkontrolle, Sanktionen, Rohstoffe", "Taiwan und China", "Beschaffungs- und Kapitalumfeld"]
    n_sections = {"daily": 2, "weekly": 4, "monthly": 7}[cadence]
    for i, t in enumerate(titles[:n_sections]):
        subs = []
        for j in range(1, (4 if cadence == "monthly" else 2) + 1):
            blocks = [{"type": "p", "tag": "FACT" if j == 1 else None, "text": para(2 if cadence == "monthly" else 1)},
                      {"type": "p", "tag": "ASSESSMENT", "text": para(1)}]
            if i == 3 and j == 1:
                blocks.append({"type": "figure", "figure": "F4"})
            if i == 3 and j == 2:
                blocks.append({"type": "figure", "figure": "F5"})
            if i == 1 and j == 2:
                blocks.append({"type": "org_card", "code": "GRU", "name": "GRU — Einheit 26165 und assoziierte Strukturen",
                               "subtitle": "Militärischer Nachrichtendienst der Russischen Föderation", "tag": "ORG",
                               "rows": [["Auftrag", "Aufklärung und Vorbereitung von Wirkung gegen die europäische Unterstützungskette."],
                                        ["Vorgehen", "Cyberzugriff auf Logistikdaten, Anwerbung über Messengerdienste, öffentliche Zielsignalisierung."],
                                        ["Nachweis", "Gemeinsame Behördenwarnung, April 2026 [Q-09]."]]})
            blocks.append({"type": "meaning", "text": para(1)})
            subs.append({"id": f"s{i+1}_{j}", "number": f"{i+1}.{j}", "title": f"Unterabschnitt {i+1}.{j}", "blocks": blocks})
        sections.append({"id": f"s{i+1}", "number": str(i + 1), "kicker": f"ABSCHNITT {i+1}", "title": t,
                         "lead": "Der Abschnitt mit der größten Veränderung im Monat.", "subsections": subs if cadence != "daily" else [],
                         "blocks": [{"type": "p", "text": para(1)}, {"type": "meaning", "text": para(1)}] if cadence == "daily" else []})
    kj = [{"id": f"KA-{i}", "title": "Auterion ist im August von einem mittelbar betroffenen Unternehmen zu einem plausiblen eigenständigen Ziel geworden.",
           "body": para(1), "band": "likely", "low": 55, "high": 80, "confidence": "medium", "change": "neu"} for i in range(1, {"daily": 3, "weekly": 4, "monthly": 5}[cadence] + 1)]
    doc = {
        "meta": {"language": language, "cadence": cadence, "title": "Monatlicher Lagebericht — August 2026", "org": "Auterion GmbH",
                 "addressee": "Leitung Unternehmenssicherheit", "serial": "PLX-2026-08-AUT", "issue_no": "08", "month_label": "August 2026",
                 "period_label": "1.–31. August 2026", "context_label": "1. März – 31. August 2026", "cutoff_label": "6. September 2026, 18:00 Z",
                 "publisher": "Trifecta Technologies · Parallax", "publisher_line": "Parallax Intelligence", "domains": "News · AIS · ADS-B · Fusion · Telegram · Amtliche Quellen",
                 "template_version": "PLX 1.0", "contact": {"name": "Marc-Amay Lunau", "email": "marc.lunau@trifecta-technologies.com"}, "rehearsal": True},
        "key_judgments": kj,
        "exposure": {"lead": "Acht Vektoren, gewichtet nach dem Entscheidungsbereich der Unternehmenssicherheit.",
                     "vectors": [{"id": f"V{i}", "name": n, "level": lv, "prev": pv, "delta": d, "drivers": "Zwei Munitionslagertreffer im Umland binnen zwei Monaten",
                                  "decision": "Aufenthalts- und Schutzregeln"} for i, (n, lv, pv, d) in enumerate(
                         [("Personal und Standort Kyjiw", 5, 4, "▲"), ("Zielprofil des Unternehmens", 4, 2, "▲▲"), ("Code- und Lieferkettenintegrität", 4, 3, "▲"),
                          ("Standort Deutschland", 3, 2, "▲"), ("Exportkontrolle und Sanktionen", 3, 3, "—"), ("Taiwan und Gegenmaßnahmenrisiko", 3, 3, "—"),
                          ("Beschaffungs- und Haushaltsumfeld", 2, 2, "—"), ("Maritime und Grauzonenlage", 2, 2, "—")], 1)],
                     "movement": para(1)},
        "decisions": {"lead": "Was in den nächsten 90 Tagen zu entscheiden ist, mit Zuständigkeit und Termin.",
                      "items": [{"id": f"E-{i}", "what": "Personenschutzkonzept für die Führungsebene festlegen", "vector": "V2", "owner": "Leitung Sicherheit",
                                 "due": "bis 30.09.2026", "urgency": "hoch", "rationale": para(1)} for i in range(1, 7)],
                      "footnote": "Die Termine sind Vorschläge und binden das Unternehmen nicht."},
        "how_to_read": {"bands": "Wahrscheinlichkeiten werden ausschließlich als Band mit Zahlenwerten angegeben.", "confidence": "Konfidenz ist von der Wahrscheinlichkeit getrennt.",
                        "layout_title": "Aufbau der Abschnitte", "layout": "Jeder Abschnitt beginnt auf einer neuen Seite und endet mit einer Zeile BEDEUTUNG FÜR.",
                        "provenance_title": "Sprachgebrauch zur Herkunft von Signalen", "provenance": "„Parallax erfasste“ bezeichnet Vorgänge, die der Signalbestand unmittelbar aufgenommen hat."},
        "chronology": {"kicker": "ABSCHNITT 0", "lead": "Datierte Ereigniskette.",
                       "rows": [{"date": f"{d:02d}.08.", "event": "Leipzig/Halle: Quadrocopter mit Plastiksprengstoff trifft einen ukrainischen Antonow-Frachter, detoniert nicht.",
                                 "vector": "V2 / V4", "tag": "FACT"} for d in range(2, 30, 2)], "meaning": para(1)},
        "analyst_desk": {"kicker": "ABSCHNITT 9", "question": "Ist Auterion zum eigenständigen Ziel geworden — und gegen welchen Wirkweg ist zu schützen?", "why": para(1),
                         "hypotheses": [{"id": f"H{i}", "text": t, "consequence": "Personenschutz, Werkschutz, Luftraumbeobachtung."} for i, t in enumerate(
                             ["Auterion ist Beifang.", "Auterion ist vorrangiges Aufklärungsziel.", "Auterion liegt im Zielspektrum für Sabotage.", "Der effiziente Weg führt über die Software-Lieferkette."], 1)],
                         "matrix": [{"label": "E1 Adressen europ. Drohnenhersteller veröffentlicht (04/2026)", "diagnostic": True, "scores": ["-", "+", "++", "+"]},
                                    {"label": "E2 Donaustahl: Vorbereitung Anschlag (08/2026)", "diagnostic": True, "scores": ["--", "+", "++", "o"]},
                                    {"label": "E3 Leipzig/Halle: Sprengdrohne (04.08.2026)", "diagnostic": False, "scores": ["-", "+", "++", "o"]},
                                    {"label": "E4 CHAINDROP-Wurm (04.08.2026)", "diagnostic": True, "scores": ["o", "+", "o", "++"]}],
                         "evaluation": para(1), "assessment": para(1),
                         "assumptions": [{"id": f"A{i}", "text": "Das beschriebene Vorgehen ist übertragbar.", "confidence": "medium", "breaks": "Nachweis eines individuellen Motivs."} for i in range(1, 5)],
                         "counter": para(2), "counter_reply": para(1),
                         "would_change": [{"id": f"W{i}", "event": "Öffentliche Nennung als Ziel", "deadline": "laufend", "effect": "H3 steigt auf 70–80 %"} for i in range(1, 4)],
                         "analogues": [{"title": "Rheinmetall, 2024", "text": para(1)}, {"title": "Ostsee-Infrastruktur, 2024–2026", "text": para(1)}]},
        "scenarios": {"lead": "Vier Verläufe für die kommenden 30 bis 90 Tage.", "items": [
            {"key": k, "title": t, "p": p, "text": para(1), "trigger": "W1 oder W2 tritt ein.", "measure": "Sofortmaßnahmen Personenschutz."}
            for k, t, p in [("A", "Fortsetzung auf hohem Niveau", 55), ("B", "Eskalation gegen Unternehmen und Personen", 20), ("C", "Teilberuhigung über die Verhandlungsspur", 18), ("D", "Bruch der Nachfrage", 7)]],
            "note_title": "Ein kontraintuitiver Hinweis.", "note": para(1)},
        "indicators": {"lead": "Verfolgte Größen mit Schwelle, Stand und Vorlaufzeit.",
                       "rows": [{"id": f"I-{i}", "name": "Sabotageverdachtsfälle DE je Monat", "threshold": ">25", "current": "~21", "trend": "steigend", "lead": "60 Tage"}
                                for i in range(1, {"daily": 5, "weekly": 10, "monthly": 14}[cadence] + 1)], "note": para(1)},
        "calendar": {"rows": [{"when": "10.11.2026", "what": "Ende der Aussetzung chinesischer Ausfuhrkontrollen", "vector": "V5", "why": "Magnet- und Rohstoffbezug; harter Termin"} for _ in range(8)],
                     "wildcards": [{"title": "Namentliche Sanktionierung durch die Volksrepublik China", "p": "5–10 %", "text": para(1), "precaution": "Kenntnis der eigenen Stückliste."} for _ in range(3)]},
        "gaps": {"rows": [{"id": f"L-{i}", "what": "Ob die Kapitalrunde geschlossen wurde", "why": "Bestimmt den Mittelrahmen", "clarify": "Auskunft des Unternehmens"} for i in range(1, 7)],
                 "excluded": [{"title": "Explosion am Augsburger Hauptbahnhof, 2. September", "text": para(1)}]},
        "exposure_cards": [{"id": f"K{i}", "title": "Personal und Standort Kyjiw", "sub": "Vormonat Stufe 4 · Treiber: Trefferbild im Umland", "tag": f"V{i} · STUFE 5",
                            "rows": [["Was sich änderte", para(1)], ["Warum es zählt", para(1)], ["Entscheidung", "E-4 bis 30.09.2026."], ["Auslöser", "Weiterer Treffer."]]} for i in range(1, 8)],
        "sources": [{"id": f"Q-{i:02d}", "title": "Bloomberg — Reportage über autonome Schwärme, 14.08.2026", "url": "https://www.bloomberg.com/news/articles/2026-08-14/autonomous-swarm",
                     "tier": 2, "reliability": "high", "note": "—"} for i in range(1, 29)],
        "method": {"procedure": para(2), "checks": [["Alle Expositionsvektoren geführt", "ja"], ["Unsicherheit durchgängig beziffert", "ja"], ["Jeder Vorgang mit Bedeutungszeile", "ja"]],
                   "weakest": para(1), "internal": para(1), "limits": para(1)},
        "glossary": [{"term": t, "meaning": m} for t, m in [("ADS-B", "Selbstmeldeverfahren von Luftfahrzeugen."), ("AIS", "Selbstmeldeverfahren von Schiffen."),
                                                             ("BKA", "Bundeskriminalamt."), ("GRU", "Militärischer Nachrichtendienst der Russischen Föderation."),
                                                             ("GNSS", "Satellitennavigation."), ("NATO", "Nordatlantikvertrags-Organisation.")]],
        "figures": {"F4": {"number": 4, "html": chart, "caption": "Gemeldete Sabotage-, Drohnen- und Spionagevorgänge in Deutschland. Quelle: Parallax, korreliert aus Behördenlagebild."},
                    "F5": {"number": 5, "html": mp, "caption": "Sabotage- und Spionagevorgänge in Deutschland 2026. Ortsangaben auf Stadtebene."}},
        "sections": sections,
    }
    if cadence == "daily":
        doc["meta"]["title"] = "Tageslage — 7. Oktober 2026"
    return doc

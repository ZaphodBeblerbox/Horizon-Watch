"""
street_reports.py — what people on the street write in a few words, read as
signals: "ça gaze à Répu", "ça nasse à Répu", "les CRS chargent bd Voltaire",
"les flics arrivent à Répu" (with a video), "on est à Bastoche", "lanzan
lacrimógenas en Altamira", "la GNB llegó a Plaza Venezuela".

THE OWNER (2026-10-18): "I received in Telegram a video of the police moving
in at République, why isn't that added to the map?? Why isn't for example
'ça gaz à Répu' being translated as a signal saying: gaz lacrymogène
employed at République? Or 'ça nasse à Répu' should show the police lines
blocking all the exit points of République … translate more of the casual
messages into signals."

WHY THEY WERE LOST (each fixed where it happens; see the report of
2026-10-18): the live-development pass read only posts longer than 25
characters (telegram_events.read_situations) — "ça gaze à Répu" is 14; its
cue words had no police slang (flics, keufs, BAC …) and no Spanish; the
intent rules (telegram_signals) read CALLS ("on va …") and self-reported
positions, never a report of what the police are doing; a group's
forwarded video was skipped at collection; and a place written "Répu",
"Bastoche" or "Nation" alone resolved nowhere.

MODEL EXTRACTS, CODE RESOLVES. Two readings meet here:
  · THE RULES (this module, no model, derived on read): a lexicon of
    police tactics and crowd reports in French street slang, Spanish
    (Venezuela), English and Burmese, and a gazetteer of the places as
    people write them (Répu, Bastoche, Châtelet, Plaza Venezuela, Sule …),
    with fixed coordinates.
  · THE MODEL, through what it already wrote for the post: the classify
    pass's English rendering (summary_en: the translation shown under the
    quote) and its located place (lat/lon, geocoded by the pins' rule), and
    the live-development pass's typed events (telegram_situations: kind,
    place). The model never gives coordinates; a place it names that the
    gazetteer knows is put at the gazetteer's point.
A post either reading finds is a report; both, "rule+model".

ONE THING, ONE SIGNAL. Reports of the same tactic at the same place, each
within MERGE_GAP_MIN of the last, are one signal that counts its messages
and chats and quotes each one (original, translation, channel, link, time).
Nothing is stored: signals are derived on read from telegram_posts and
telegram_situations, so a better lexicon applies to everything collected.

ON THE MAP (src/globe/policeActions.js): tear gas is an area; a kettle is
police lines across every exit street of the named square (exits from
OpenStreetMap, precomputed in seed/square_exits.json by
build_square_exits.py; radial exits when the place is not one of them);
police moving in is an arrow (from the street they came by, when said)
or a marker. Each fades with age and is gone after its VALID_MIN.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import os
import re
import sqlite3
import threading
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
EXITS_FILE = os.path.join(HERE, "seed", "square_exits.json")

LOOKBACK_H = 6
MERGE_GAP_MIN = 45
MERGE_M = 350
CACHE_S = 15
FALLBACK_EXITS = 6
FROM_M = 380                # an arrow's tail: this far back along the street the police came by
NOTE = "Reported on Telegram, unverified — read by rule from what people wrote, and the model's translation"

# ── tactics ─────────────────────────────────────────────────────────────────
# kind: (title verb phrase, how long it stays on the map, severity)
TACTICS = {
    "kettle": ("Kettled — exits blocked", 120, "high"),
    "tear_gas": ("Tear gas used", 60, "high"),
    "charge": ("Police charge", 45, "high"),
    "lbd": ("Rubber bullets / LBD fired", 60, "high"),
    "gunfire": ("Shots fired", 90, "high"),
    "water_cannon": ("Water cannon used", 60, "high"),
    "arrests": ("Arrests", 90, "moderate"),
    "police_arrival": ("Police moving in", 60, "moderate"),
    "barricade": ("Barricades", 180, "moderate"),
    "fire": ("Fires", 120, "moderate"),
    "crowd": ("Crowd reported", 90, "low"),
    "footage": ("Footage from the street", 90, "low"),
}
# the order a post with several tactics is named by: the gravest first
RANK = ["gunfire", "kettle", "lbd", "tear_gas", "water_cannon", "charge", "arrests", "police_arrival",
        "fire", "barricade", "crowd", "footage"]


def fold(s: str | None) -> str:
    """Lower case, accents dropped, curly apostrophes straightened. Burmese
    and other scripts pass through (NFKD leaves their letters alone)."""
    out, base = [], ""
    for c in unicodedata.normalize("NFKD", str(s or "")):
        # an accent on a Latin letter goes; a Burmese vowel sign or asat is
        # a letter of the word and stays
        if unicodedata.combining(c) and base and base < "ɐ":
            continue
        base = c if not unicodedata.combining(c) else base
        out.append(c)
    return unicodedata.normalize("NFC", "".join(out)).lower().replace("’", "'").replace("`", "'")


# The police, as people write them. French slang first (keufs, condés,
# schmitts, la BAC, les bleus …), then Spanish (Venezuela: GNB, PNB,
# colectivos, la guardia, los verdes), English, Burmese (စစ်ကောင်စီ the
# junta's forces, စစ်တပ် the army, စစ်သား soldiers, ရဲ police).
POLICE = (r"(?:\bcrs\b|\bbac\b|\bbrav-?m\b|\bbrigades? de repression|\bgendarm\w*|\bgm\b|\bflics?\b|\bkeufs?\b|\bkisdes?\b|"
          r"\bcondes?\b|\bpoulets\b|\bschmitts?\b|\bbleus\b|\bpolic(?:e|iers?|ieres?)\b|\bforces de l'ordre\b|\bfdo\b|"
          r"\bcops?\b|\briot police\b|\bofficers\b|\btroops?\b|\bsoldiers\b|\bmilitaires?\b|\bfourgons?\b|\bcamions de crs\b|"
          r"\bgnb\b|\bpnb\b|\bguardia(?:s| nacional)?\b|\bpolicias?\b|\bpolicia nacional\b|\bcolectivos?\b|\bsebin\b|\bdgcim\b|"
          r"\bfaes\b|\blos verdes\b|\btanquetas?\b|\bmotorizados\b|\befectivos\b|\bfuncionarios\b|"
          r"စစ်ကောင်စီ|စစ်တပ်|စစ်သား|စစ်ကား|ရဲတပ်|ရဲများ|ရဲ)")

T = {
    "tear_gas": (
        r"\b(?:ca|sa|ils|on se fait|on s'fait|ca nous|ils nous|on est|on s'est fait|on s'est faits?) ?gaz\w*|"
        r"\bgaz(?:e|ent|ez|age|es|ee|ees)\b|\bgaz\b(?= (?:a|au|sur|vers|devant|partout|lacry)\b)|\bgaz lacry\w*|\blacrymo\w*|\blacry\b|\bgazeuses?\b|\bnuages? de gaz|"
        r"\btear ?gas\w*|\bgass(?:ed|ing)\b|\bpepper spray\b|"
        r"\blacrimo\w*|\bbombas? lacrim\w*|\bgas pimienta\b|\b(?:lanzan|lanzando|tiran|tirando|echan|echando|botan|botando)"
        r"(?: \w+){0,2} gas(?:es)?\b|\bgas del bueno\b|"
        r"မျက်ရည်ယို"),
    "kettle": (
        r"\bnass(?:e|es|ent|er|ee|ees|ent|age)\b|\bca nasse\b|\bune nasse\b|\bencercl\w*|\bkettl\w*|\bpris(?:es)? au piege\b|"
        r"\b(?:on|nous) (?:peut|peux|ne peut|n'peut|ne peux) (?:plus|pas) sortir\b|\btoutes les sorties\b|\bsorties? bloquees?\b|"
        r"\b(?:boxed|hemmed|penned) in\b|\bsurrounded by (?:police|cops|riot)\b|"
        r"\bencerrad\w*|\bacorralad\w*|\bencapsulad\w*|\bnos (?:tienen|tiene) (?:rodeados|encerrados|cercados)\b|"
        r"\b(?:rodead|cercad)(?:o|os|a|as)\b|"
        r"ဝိုင်းထား|ဝိုင်းရံ"),
    "charge": (
        r"\bca charge\b|\b(?:ils|on se fait|on s'est fait) charg\w*|\bcharg(?:e|ent|ent|ement|es)\b(?= .{0,25}(?:crs|flic|keuf|police|bac|gendarm|brav|manif|cortege|nous|les gens))|"
        r"(?:crs|flics?|keufs?|bac|brav-?m|gendarmes?|policiers?|police|gm) (?:\w+ ){0,2}charg\w*|\bcharge (?:de|des|du) (?:crs|flics|keufs|police|bac|brav)|"
        r"\b(?:police|riot police|cops) (?:\w+ ){0,1}charg\w*|\bbaton charge\w*|"
        r"\barremet\w*|\bcarga (?:policial|de la (?:gnb|pnb|guardia|policia))|\bnos (?:cargaron|cargan|cayeron)\b|\bcargan contra\b"),
    "lbd": (
        r"\blbd\b|\bflash-?ball\w*|\bballes? (?:en caoutchouc|de defense)\b|\bdesencerclement\b|\bgli-?f4\b|"
        r"\bgrenades? (?:assourdissantes?|de desencerclement|explosives?)\b|\bdes tirs? de (?:lbd|grenades?)\b|"
        r"\brubber (?:bullets?|rounds?)\b|\bstun grenades?\b|\bflash-?bangs?\b|"
        r"\bperdig\w*|\bbalas? de goma\b|\bmetras? de goma\b"),
    "gunfire": (
        r"\btirs? a balles? reelles?\b|\bcoups? de feu\b|\bca tire\b|\bils tirent\b|"
        r"\bgunfire\b|\bshots? fired\b|\blive (?:fire|rounds|ammunition)\b|\bopened fire\b|\bshooting at (?:protesters|crowd)\b|"
        r"\bdisparos?\b|\bdisparan\w*|\bdisparando\b|\bplomo\b|\btiroteo\w*|\bbalacera\b|\bestan tirando\b|\btiros\b|"
        r"ပစ်ခတ်"),
    "water_cannon": (
        r"\bcanons? a eau\b|\blance-?eau\b|\bwater ?cannons?\b|\bballenas?\b|\bcamion(?:es)? hidrante\w*|\bhidrantes?\b|\btanquetas? de agua\b"),
    "arrests": (
        r"\binterpell\w*|\barrestation\w*|\b(?:ils|on) (?:arrete|embarque)\w*|\bembarqu(?:e|ent|es|ees)\b|\bgarde a vue\b|"
        r"\barrest(?:s|ed|ing)?\b|\bdetain(?:ed|ing)?\b|\brounded up\b|"
        r"\bdetenid\w*|\bdetencion\w*|\barrestad\w*|\bse (?:los|lo|la|las) llevaron\b|\bllevaron pres\w*|\bcapturad\w*|"
        r"ဖမ်းဆီး|ဖမ်းခံ|ဖမ်းသွား"),
    "barricade": (
        r"\bbarricad\w*|\bguarimb\w*|\btrancaz\w*|\btrancad\w*|\bcauchos? quemad\w*|\bquema de cauchos\b"),
    "fire": (
        r"\ben feu\b|\bpoubelles? (?:en feu|brulee?s?|cramee?s?)\b|\bvoitures? (?:en feu|brulee?s?|cramee?s?)\b|\bca crame\b|\bca brule\b|"
        r"\bincendi(?:e|es|ent|aire)\b|\bset (?:on )?fire\b|\bon fire\b|\bblaze\b|"
        r"\bincendi(?:o|os|an|aron)\b|\bqueman(?:do)?\b|\bprendieron fuego\b|\bcandela\b|"
        r"မီးရှို့|မီးလောင်"),
    "crowd": (
        r"\b(?:on est|on se trouve|nous sommes|on arrive|on est arrives?|y'?a (?:du|grave du|beaucoup de) monde|beaucoup de monde|"
        r"une foule|la foule|le cortege|cortege (?:arrive|passe|est)|on est (?:des )?(?:milliers|centaines|nombreux|plein))\b|"
        r"\b(?:we'?re|we are) (?:at|in|outside|on)\b|\bcrowds? (?:at|in|gathering|gathered)\b|\bprotesters (?:at|in|gather)\w*|"
        r"\b(?:estamos|ya estamos|nos encontramos|seguimos) (?:en|frente)\b|\bconcentrad(?:os|as) en\b|\bconcentracion en\b|"
        r"\bmucha gente en\b|\bfull gente\b|\bmarcha (?:en|por|hacia|llega)\b|\bcacerolazo\b|"
        r"ဆန္ဒပြ|စုရုံး"),
}
_T = {k: re.compile(v) for k, v in T.items()}
_POLICE = re.compile(POLICE)
# Police coming: an actor and a verb of arriving or massing, close together.
ARRIVE = re.compile(
    r"\b(?:arriv\w*|debarqu\w*|deploi\w*|deploy\w*|en approche|approch\w*|se positionn\w*|positionn\w*|montent|monte|descend\w*|"
    r"remont\w*|avanc\w*|ramen\w*|rappliqu\w*|se pointent?|partout|plein de|y'?a des|il y a des|bcp de|beaucoup de|en masse|"
    r"moving in|arriving|arrived|deployed|massing|lining up|coming|pouring in|"
    r"lleg(?:an|aron|ando|o|ó)|vienen|viene|avanzan|avanzando|se despliegan|desplegad\w*|apostad\w*|tomaron|toman|entrando|"
    r"entraron|subiendo|bajando|full de|lleno de|"
    r"ရောက်|ဝင်ရောက်|ဝင်လာ|ချထား)\b|ရောက်|ဝင်ရောက်|ဝင်လာ|ချထား")
CA_BOUGE = re.compile(r"\bca bouge\b|\bsa bouge\b|\bse esta prendiendo\b|\bse prendio\b|\bse calento\b")
PROTEST_WORDS = re.compile(
    r"\b(manif\w*|cortege|greve|blocage|gilets? jaunes|gj\b|lyceens?|etudiants?|protest\w*|demonstrat\w*|rally|march\w*|"
    r"protesta\w*|manifestaci\w*|marcha\w*|plantón|planton|cacerolazo|oposicion|"
    r"riot\w*|emeute\w*)|ဆန္ဒပြ|အာဏာရှင်|သပိတ်")
# the post looks back on something, or is about elsewhere / another time
NOT_NOW = re.compile(r"\b(hier|la semaine derniere|l'an dernier|en 20[01]\d|ayer|la semana pasada|yesterday|last week|"
                     r"il y a \d+ (?:jours|ans|mois)|souvenir|anniversaire|rappel|demain|manana|tomorrow)\b")


def cues(text: str | None) -> bool:
    """Is there a street report to read here? The cheap pre-filter, also
    used in front of the model for group messages."""
    t = fold(text)
    if not t:
        return False
    if any(rx.search(t) for k, rx in _T.items() if k != "crowd"):
        return True
    if _POLICE.search(t) and (ARRIVE.search(t) or CA_BOUGE.search(t)):
        return True
    return bool(CA_BOUGE.search(t) or (_T["crowd"].search(t) and place_in(text)))


def tactics(text: str | None) -> list[dict]:
    """[{kind, start, end, words}] in the post, gravest first, one per kind."""
    t = fold(text)
    out = []
    for k, rx in _T.items():
        m = rx.search(t)
        if m:
            out.append({"kind": k, "start": m.start(), "end": m.end(), "words": m.group(0).strip()})
    pm = _POLICE.search(t)
    if pm:
        win = t[max(0, pm.start() - 50):pm.end() + 60]
        am = ARRIVE.search(win) or CA_BOUGE.search(win)
        if am and not any(o["kind"] in ("charge", "kettle") for o in out):
            out.append({"kind": "police_arrival", "start": pm.start(), "end": pm.end(), "words": f"{pm.group(0)} … {am.group(0)}".strip()})
    if not any(o["kind"] == "police_arrival" for o in out):
        cb = CA_BOUGE.search(t)
        if cb and not out:
            out.append({"kind": "police_arrival", "start": cb.start(), "end": cb.end(), "words": cb.group(0), "vague": True})
    out.sort(key=lambda o: RANK.index(o["kind"]))
    return out


# ── places as people write them ─────────────────────────────────────────────
# (id, name, city, country, lat, lon, kind, aliases). kind: square | site |
# street | district. An alias marked "=" counts only right after a
# preposition ("à Répu", "sur Nation", "vers République", "en Altamira") —
# "la République" is a regime and "nation" a word as often as a square.
# Streets carry their line (approximate, from the map) instead of a point.
PLACES = [
    # Paris — the squares a kettle closes (exits in seed/square_exits.json)
    ("republique", "Place de la République", "Paris", "fr", 48.8674, 2.3636, "square",
     ["place de la republique", "pl de la republique", "pl. de la republique", "place republique", "repu", "repue", "=republique",
      "=la republique", "=la rep", "=rep"]),
    ("bastille", "Place de la Bastille", "Paris", "fr", 48.8532, 2.3692, "square",
     ["place de la bastille", "bastille", "bastoche", "opera bastille"]),
    ("nation", "Place de la Nation", "Paris", "fr", 48.8483, 2.3958, "square",
     ["place de la nation", "pl de la nation", "pl nation", "=nation", "=la nation"]),
    ("concorde", "Place de la Concorde", "Paris", "fr", 48.8656, 2.3212, "square", ["place de la concorde", "concorde"]),
    ("chatelet", "Châtelet", "Paris", "fr", 48.8576, 2.3470, "square",
     ["chatelet-les halles", "chatelet les halles", "place du chatelet", "chatelet", "chatlet"]),
    ("opera", "Place de l'Opéra", "Paris", "fr", 48.8711, 2.3319, "square", ["place de l'opera", "opera garnier", "=opera", "=l'opera"]),
    ("trocadero", "Place du Trocadéro", "Paris", "fr", 48.8629, 2.2875, "square", ["trocadero", "place du trocadero", "troca", "troc"]),
    ("etoile", "Place Charles-de-Gaulle (Étoile)", "Paris", "fr", 48.8738, 2.2950, "square",
     ["place de l'etoile", "arc de triomphe", "charles de gaulle etoile", "charles-de-gaulle-etoile", "cdg etoile", "=etoile", "=l'etoile"]),
    ("invalides", "Esplanade des Invalides", "Paris", "fr", 48.8605, 2.3135, "square", ["esplanade des invalides", "invalides"]),
    ("italie", "Place d'Italie", "Paris", "fr", 48.8311, 2.3557, "square", ["place d'italie", "pl d'italie", "=italie", "=d'italie"]),
    ("gare_du_nord", "Gare du Nord", "Paris", "fr", 48.8809, 2.3553, "square", ["gare du nord", "gdn"]),
    ("gare_de_l_est", "Gare de l'Est", "Paris", "fr", 48.8768, 2.3592, "square", ["gare de l'est", "gare de lest"]),
    # Paris — other places named in protests
    ("elysee", "Palais de l'Élysée", "Paris", "fr", 48.8704, 2.3167, "site", ["palais de l'elysee", "=l'elysee", "=elysee"]),
    ("champs", "Champs-Élysées", "Paris", "fr", 48.8698, 2.3076, "street", ["champs-elysees", "champs elysees", "=les champs"]),
    ("assemblee", "Assemblée nationale", "Paris", "fr", 48.8619, 2.3186, "site", ["assemblee nationale", "palais bourbon", "=l'assemblee"]),
    ("matignon", "Hôtel de Matignon", "Paris", "fr", 48.8546, 2.3204, "site", ["matignon"]),
    ("beauvau", "Place Beauvau", "Paris", "fr", 48.8722, 2.3164, "site", ["place beauvau", "beauvau"]),
    ("hotel_de_ville", "Hôtel de Ville", "Paris", "fr", 48.8566, 2.3522, "site", ["hotel de ville", "=hdv"]),
    ("saint_michel", "Place Saint-Michel", "Paris", "fr", 48.8532, 2.3440, "site",
     ["place saint-michel", "place saint michel", "fontaine saint-michel", "saint-michel", "saint michel", "st-michel", "st michel",
      "st mich", "saint mich", "saint-mich"]),
    ("halles", "Les Halles", "Paris", "fr", 48.8620, 2.3455, "district", ["les halles", "forum des halles"]),
    ("montparnasse", "Montparnasse", "Paris", "fr", 48.8421, 2.3219, "district", ["montparnasse", "montparno", "montpar"]),
    ("denfert", "Place Denfert-Rochereau", "Paris", "fr", 48.8339, 2.3324, "square", ["denfert-rochereau", "denfert"]),
    ("gare_de_lyon", "Gare de Lyon", "Paris", "fr", 48.8443, 2.3743, "site", ["gare de lyon"]),
    ("saint_lazare", "Gare Saint-Lazare", "Paris", "fr", 48.8763, 2.3253, "site", ["saint-lazare", "saint lazare", "st-lazare", "st lazare"]),
    ("stalingrad", "Stalingrad", "Paris", "fr", 48.8843, 2.3680, "district", ["stalingrad", "stalin"]),
    ("jaures", "Jaurès", "Paris", "fr", 48.8826, 2.3702, "district", ["=jaures"]),
    ("belleville", "Belleville", "Paris", "fr", 48.8721, 2.3767, "district", ["belleville", "belleville"]),
    ("barbes", "Barbès", "Paris", "fr", 48.8838, 2.3506, "district", ["barbes"]),
    ("pigalle", "Pigalle", "Paris", "fr", 48.8821, 2.3376, "district", ["pigalle"]),
    ("oberkampf", "Oberkampf", "Paris", "fr", 48.8648, 2.3680, "district", ["oberkampf"]),
    ("menilmontant", "Ménilmontant", "Paris", "fr", 48.8665, 2.3833, "district", ["menilmontant", "=menil"]),
    ("parmentier", "Parmentier", "Paris", "fr", 48.8653, 2.3747, "district", ["=parmentier"]),
    ("madeleine", "La Madeleine", "Paris", "fr", 48.8700, 2.3245, "site", ["madeleine"]),
    ("sorbonne", "Sorbonne", "Paris", "fr", 48.8487, 2.3431, "site", ["sorbonne"]),
    ("luxembourg", "Jardin du Luxembourg", "Paris", "fr", 48.8462, 2.3372, "site", ["jardin du luxembourg", "=luco", "senat"]),
    ("porte_maillot", "Porte Maillot", "Paris", "fr", 48.8780, 2.2830, "site", ["porte maillot"]),
    ("clichy", "Place de Clichy", "Paris", "fr", 48.8835, 2.3275, "square", ["place de clichy"]),
    ("tour_eiffel", "Tour Eiffel", "Paris", "fr", 48.8584, 2.2945, "site", ["tour eiffel", "champ de mars"]),
    # Paris — boulevards and streets (line from end to end; a charge is drawn along it)
    ("bd_voltaire", "Boulevard Voltaire", "Paris", "fr", [(48.8668, 2.3651), (48.8605, 2.3745), (48.8540, 2.3840), (48.8489, 2.3935)], None,
     "street", ["boulevard voltaire", "bd voltaire", "bvd voltaire", "bld voltaire", "bd. voltaire", "=voltaire"]),
    ("bd_magenta", "Boulevard de Magenta", "Paris", "fr", [(48.8693, 2.3622), (48.8762, 2.3570), (48.8834, 2.3494)], None,
     "street", ["boulevard de magenta", "boulevard magenta", "bd magenta", "bd de magenta", "bd. magenta", "=magenta"]),
    ("bd_beaumarchais", "Boulevard Beaumarchais", "Paris", "fr", [(48.8540, 2.3687), (48.8589, 2.3672), (48.8628, 2.3660)], None,
     "street", ["boulevard beaumarchais", "bd beaumarchais", "=beaumarchais"]),
    ("bd_richard_lenoir", "Boulevard Richard-Lenoir", "Paris", "fr", [(48.8543, 2.3703), (48.8616, 2.3712), (48.8690, 2.3681)], None,
     "street", ["boulevard richard-lenoir", "boulevard richard lenoir", "bd richard lenoir", "bd richard-lenoir", "richard lenoir"]),
    ("bd_saint_germain", "Boulevard Saint-Germain", "Paris", "fr", [(48.8505, 2.3555), (48.8530, 2.3440), (48.8540, 2.3330), (48.8580, 2.3240), (48.8615, 2.3195)], None,
     "street", ["boulevard saint-germain", "boulevard saint germain", "bd saint germain", "bd saint-germain", "bd st germain", "bd st-germain"]),
    ("bd_saint_michel", "Boulevard Saint-Michel", "Paris", "fr", [(48.8532, 2.3440), (48.8470, 2.3405), (48.8400, 2.3370)], None,
     "street", ["boulevard saint-michel", "boulevard saint michel", "bd saint michel", "bd saint-michel", "bd st michel", "boul mich", "boul'mich"]),
    ("rue_de_rivoli", "Rue de Rivoli", "Paris", "fr", [(48.8553, 2.3600), (48.8590, 2.3480), (48.8620, 2.3370), (48.8655, 2.3255)], None,
     "street", ["rue de rivoli", "=rivoli"]),
    ("bd_sebastopol", "Boulevard de Sébastopol", "Paris", "fr", [(48.8583, 2.3485), (48.8640, 2.3505), (48.8700, 2.3535)], None,
     "street", ["boulevard de sebastopol", "bd de sebastopol", "bd sebastopol", "sebasto", "=sebastopol"]),
    ("bd_du_temple", "Boulevard du Temple", "Paris", "fr", [(48.8665, 2.3640), (48.8635, 2.3655), (48.8610, 2.3670)], None,
     "street", ["boulevard du temple", "bd du temple"]),
    ("av_republique", "Avenue de la République", "Paris", "fr", [(48.8666, 2.3660), (48.8645, 2.3765), (48.8625, 2.3860)], None,
     "street", ["avenue de la republique", "av de la republique", "av. de la republique"]),
    ("fbg_du_temple", "Rue du Faubourg-du-Temple", "Paris", "fr", [(48.8685, 2.3650), (48.8705, 2.3710), (48.8722, 2.3770)], None,
     "street", ["rue du faubourg du temple", "faubourg du temple", "fbg du temple"]),
    ("bd_diderot", "Boulevard Diderot", "Paris", "fr", [(48.8445, 2.3740), (48.8462, 2.3840), (48.8480, 2.3940)], None,
     "street", ["boulevard diderot", "bd diderot"]),
    ("bd_de_l_hopital", "Boulevard de l'Hôpital", "Paris", "fr", [(48.8410, 2.3650), (48.8370, 2.3600), (48.8320, 2.3560)], None,
     "street", ["boulevard de l'hopital", "bd de l'hopital"]),
    ("bd_haussmann", "Boulevard Haussmann", "Paris", "fr", [(48.8722, 2.3405), (48.8738, 2.3300), (48.8750, 2.3150), (48.8745, 2.3010)], None,
     "street", ["boulevard haussmann", "bd haussmann", "=haussmann"]),
    ("av_opera", "Avenue de l'Opéra", "Paris", "fr", [(48.8632, 2.3356), (48.8670, 2.3338), (48.8705, 2.3322)], None,
     "street", ["avenue de l'opera", "av de l'opera"]),
    ("bd_barbes", "Boulevard Barbès", "Paris", "fr", [(48.8840, 2.3497), (48.8880, 2.3490), (48.8920, 2.3487)], None,
     "street", ["boulevard barbes", "bd barbes"]),
    # Lyon, Marseille, other French cities
    ("lyon_bellecour", "Place Bellecour", "Lyon", "fr", 45.7578, 4.8320, "square", ["bellecour"]),
    ("lyon_terreaux", "Place des Terreaux", "Lyon", "fr", 45.7676, 4.8344, "square", ["terreaux"]),
    ("lyon_guillotiere", "Place Gabriel-Péri (La Guillotière)", "Lyon", "fr", 45.7553, 4.8427, "square", ["guillotiere", "guillo", "gabriel peri"]),
    ("marseille_vieux_port", "Vieux-Port", "Marseille", "fr", 43.2951, 5.3740, "site", ["vieux-port", "vieux port"]),
    ("toulouse_capitole", "Place du Capitole", "Toulouse", "fr", 43.6045, 1.4440, "square", ["capitole"]),
    ("nantes_commerce", "Place du Commerce", "Nantes", "fr", 47.2130, -1.5600, "square", ["place du commerce"]),
    ("rennes_republique", "Place de la République", "Rennes", "fr", 48.1100, -1.6790, "square", []),
    ("lyon_republique", "Place de la République", "Lyon", "fr", 45.7616, 4.8360, "square", []),
    # Caracas and Venezuela
    ("ccs_plaza_venezuela", "Plaza Venezuela", "Caracas", "ve", 10.4996, -66.8865, "square", ["plaza venezuela"]),
    ("ccs_altamira", "Plaza Altamira (Plaza Francia)", "Caracas", "ve", 10.4963, -66.8495, "square",
     ["plaza altamira", "plaza francia", "=altamira"]),
    ("ccs_chacaito", "Chacaíto", "Caracas", "ve", 10.4917, -66.8689, "district", ["chacaito"]),
    ("ccs_plaza_bolivar", "Plaza Bolívar de Caracas", "Caracas", "ve", 10.5061, -66.9146, "square", ["plaza bolivar"]),
    ("ccs_miraflores", "Palacio de Miraflores", "Caracas", "ve", 10.5067, -66.9183, "site", ["miraflores"]),
    ("ccs_petare", "Petare", "Caracas", "ve", 10.4772, -66.8072, "district", ["petare"]),
    ("ccs_el_valle", "El Valle", "Caracas", "ve", 10.4630, -66.9060, "district", ["=el valle"]),
    ("ccs_candelaria", "La Candelaria", "Caracas", "ve", 10.5050, -66.9030, "district", ["la candelaria"]),
    ("ccs_las_mercedes", "Las Mercedes", "Caracas", "ve", 10.4830, -66.8580, "district", ["las mercedes"]),
    ("ccs_chacao", "Chacao", "Caracas", "ve", 10.4950, -66.8530, "district", ["=chacao"]),
    ("ccs_ucv", "Universidad Central de Venezuela", "Caracas", "ve", 10.4890, -66.8900, "site", ["ucv", "universidad central"]),
    ("ccs_proceres", "Paseo Los Próceres", "Caracas", "ve", 10.4685, -66.8990, "site", ["los proceres", "paseo los proceres"]),
    ("ccs_catia", "Catia", "Caracas", "ve", 10.5130, -66.9440, "district", ["catia"]),
    ("ccs_23_enero", "23 de Enero", "Caracas", "ve", 10.5110, -66.9300, "district", ["23 de enero"]),
    ("ccs_helicoide", "El Helicoide", "Caracas", "ve", 10.4885, -66.9045, "site", ["helicoide"]),
    ("ccs_la_carlota", "Base aérea La Carlota", "Caracas", "ve", 10.4880, -66.8400, "site", ["la carlota"]),
    ("ccs_fuerte_tiuna", "Fuerte Tiuna", "Caracas", "ve", 10.4560, -66.9000, "site", ["fuerte tiuna"]),
    ("ccs_autopista", "Autopista Francisco Fajardo", "Caracas", "ve", 10.4950, -66.8800, "street",
     ["autopista francisco fajardo", "francisco fajardo", "gran cacique guaicaipuro", "=la autopista"]),
    ("ve_valencia", "Valencia", "Valencia", "ve", 10.1620, -68.0077, "district", ["=valencia"]),
    ("ve_maracaibo", "Maracaibo", "Maracaibo", "ve", 10.6427, -71.6125, "district", ["maracaibo"]),
    ("ve_merida", "Mérida", "Mérida", "ve", 8.5897, -71.1561, "district", ["=merida"]),
    ("ve_san_cristobal", "San Cristóbal", "San Cristóbal", "ve", 7.7669, -72.2250, "district", ["san cristobal"]),
    # Yangon, Mandalay (Latin and Burmese script)
    ("ygn_sule", "Sule Pagoda", "Yangon", "mm", 16.7745, 96.1588, "square", ["sule", "ဆူးလေ"]),
    ("ygn_hledan", "Hledan junction", "Yangon", "mm", 16.8240, 96.1290, "square", ["hledan", "လှည်းတန်း"]),
    ("ygn_shwedagon", "Shwedagon Pagoda", "Yangon", "mm", 16.7983, 96.1497, "site", ["shwedagon", "ရွှေတိဂုံ"]),
    ("ygn_myaynigone", "Myaynigone", "Yangon", "mm", 16.8040, 96.1350, "district", ["myaynigone", "myenigone", "မြေနီကုန်း"]),
    ("ygn_tamwe", "Tamwe", "Yangon", "mm", 16.8070, 96.1720, "district", ["tamwe", "တာမွေ"]),
    ("ygn_sanchaung", "Sanchaung", "Yangon", "mm", 16.8020, 96.1330, "district", ["sanchaung", "စမ်းချောင်း"]),
    ("ygn_insein", "Insein", "Yangon", "mm", 16.8900, 96.1030, "district", ["insein", "အင်းစိန်"]),
    ("ygn_hlaing_tharyar", "Hlaing Tharyar", "Yangon", "mm", 16.8650, 96.0650, "district", ["hlaing tharyar", "hlaingthaya", "လှိုင်သာယာ"]),
    ("ygn_north_okkalapa", "North Okkalapa", "Yangon", "mm", 16.9050, 96.1750, "district", ["north okkalapa", "မြောက်ဥက္ကလာ"]),
    ("ygn_south_okkalapa", "South Okkalapa", "Yangon", "mm", 16.8450, 96.1850, "district", ["south okkalapa", "တောင်ဥက္ကလာ"]),
    ("ygn_thingangyun", "Thingangyun", "Yangon", "mm", 16.8300, 96.1950, "district", ["thingangyun", "သင်္ဃန်းကျွန်း"]),
    ("mdy_centre", "Mandalay", "Mandalay", "mm", 21.9588, 96.0891, "district", ["mandalay", "မန္တလေး"]),
    ("npt_centre", "Naypyidaw", "Naypyidaw", "mm", 19.7633, 96.0785, "district", ["naypyidaw", "nay pyi taw", "နေပြည်တော်"]),
]

PREP = r"(?:\ba|\bau|\baux|\bvers|\bsur|\bdevant|\bpres de|\bcote|\bdepuis|\bde|\bdu|\bpar|\bat|\bin|\bnear|\bon|\ben|\bpor|\bhacia|\bdesde|\bfrente a|\bfrente al)"
CITY_OF_REGION = {"Île-de-France": "Paris", "Paris": "Paris", "Auvergne-Rhône-Alpes": "Lyon", "Lyon": "Lyon",
                  "Provence-Alpes-Côte d'Azur": "Marseille", "Marseille": "Marseille", "Bretagne": "Rennes", "Rennes": "Rennes"}


def _compile_places():
    out = []
    for pid, name, city, cc, lat, lon, kind, aliases in PLACES:
        if isinstance(lat, list):
            line = [(a, b) for a, b in lat]
            plat, plon = line[len(line) // 2]
        else:
            line, plat, plon = None, lat, lon
        pats = []
        for a in aliases:
            strict = a.startswith("=")
            a = a.lstrip("=")
            words = [re.escape(w).replace(r"\-", "[ -]?").replace("'", "[' ]?") for w in a.split(" ")]
            body = r"[\s\-]+".join(words)
            if re.search(r"[က-႟]", a):          # Burmese script: no word boundaries
                pats.append((re.compile(body), len(a)))
            elif strict:
                pats.append((re.compile(rf"{PREP}\s+(?:la\s+|le\s+|l')?{body}(?![\w])"), len(a)))
            else:
                pats.append((re.compile(rf"(?<![\w]){body}(?![\w])"), len(a)))
        out.append({"id": pid, "name": name, "city": city, "country": cc, "lat": plat, "lon": plon, "kind": kind,
                    "line": line, "pats": pats})
    return out


_PLACES = _compile_places()
_BY_ID = {p["id"]: p for p in _PLACES}
_BY_NAME: dict = {}
for _p in _PLACES:
    _BY_NAME.setdefault(fold(_p["name"]), []).append(_p)


def _hits(t: str) -> list[tuple]:
    """(place, position, alias length) for every gazetteer place in folded text."""
    hits = []
    for p in _PLACES:
        for rx, ln in p["pats"]:
            m = rx.search(t)
            if m:
                hits.append((p, m.start(), ln))
                break
    return hits


def place_in(text: str | None, city: str | None = None, after: int = 0, exclude: set | None = None) -> dict | None:
    """The place a post names, from the gazetteer: the longest alias, the
    one nearest `after` (the tactic's words) on a tie. A place in another
    city than the chat's is taken only when no place of its city is named;
    `exclude` (the street the police came by) only when nothing else is."""
    hits = _hits(fold(text))
    if not hits:
        return None
    if city:
        hits = [h for h in hits if h[0]["city"] == city] or hits
    if exclude:
        hits = [h for h in hits if h[0]["id"] not in exclude] or hits
    hits.sort(key=lambda h: (-h[2], abs(h[1] - after)))
    return hits[0][0]


def place_by_name(name: str | None) -> dict | None:
    """The model's place ("Place de la République, Paris, France") at the
    gazetteer's point when the gazetteer knows it — in the city it names."""
    if not name:
        return None
    parts = [fold(x).strip() for x in str(name).split(",")]
    same = _BY_NAME.get(parts[0])
    if same:
        return next((p for p in same if fold(p["city"]) in parts[1:]), same[0])
    return place_in(name)


# "par le bd Magenta", "depuis Barbès", "from Bastille", "por la autopista"
FROM_RE = re.compile(r"\b(?:par|depuis|arriv\w* (?:de|du|des)|from|via|por|desde|vienen de|venant de)\s+(?:le |la |les |l'|el |los )?")


def came_from(text: str | None, place: dict | None = None) -> dict | None:
    """The street or place the police came by, when the post says it: a
    gazetteer name right after "par", "depuis", "from", "por" …"""
    t = fold(text)
    for m in FROM_RE.finditer(t):
        near = [h for h in _hits(t[m.end():m.end() + 60]) if h[1] <= 3]
        near.sort(key=lambda h: -h[2])
        for p, _pos, _ln in near:
            if not place or p["id"] != place["id"]:
                return p
    return None


# ── exits ───────────────────────────────────────────────────────────────────

_exits: dict | None = None


def load_exits() -> dict:
    global _exits
    if _exits is None:
        try:
            with open(EXITS_FILE) as fh:
                _exits = (json.load(fh) or {}).get("squares") or {}
        except (OSError, ValueError):
            _exits = {}
    return _exits


def offset(lat: float, lon: float, bearing_deg: float, metres: float) -> tuple[float, float]:
    r = math.radians(bearing_deg)
    dlat = metres * math.cos(r) / 111_320
    dlon = metres * math.sin(r) / (111_320 * max(0.2, math.cos(math.radians(lat))))
    return round(lat + dlat, 6), round(lon + dlon, 6)


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    y = math.sin(r(b_lon - a_lon)) * math.cos(r(b_lat))
    x = math.cos(r(a_lat)) * math.sin(r(b_lat)) - math.sin(r(a_lat)) * math.cos(r(b_lat)) * math.cos(r(b_lon - a_lon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def metres(a_lat, a_lon, b_lat, b_lon) -> float:
    r = math.radians
    h = math.sin(r(b_lat - a_lat) / 2) ** 2 + math.cos(r(a_lat)) * math.cos(r(b_lat)) * math.sin(r(b_lon - a_lon) / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(min(1.0, h)))


def exits_for(place: dict | None, lat: float, lon: float) -> tuple[list[dict], str]:
    """The exits a kettle at this place closes: [{name, lat, lon, bearing,
    axis}] and where they came from ("osm" | "radial" | "street")."""
    sq = load_exits().get(place["id"]) if place else None
    if sq and sq.get("exits"):
        return [dict(e) for e in sq["exits"]], "osm"
    if place and place.get("line"):
        # a kettle on a street: the street closed both sides of the point
        line = place["line"]
        i = min(range(len(line) - 1), key=lambda k: metres(lat, lon, *line[k]))
        ax = bearing(*line[i], *line[i + 1])
        return [{"name": place["name"], "bearing": round(b, 1), "axis": round(b, 1),
                 **dict(zip(("lat", "lon"), offset(lat, lon, b, 120)))} for b in (ax, (ax + 180) % 360)], "street"
    out = []
    for k in range(FALLBACK_EXITS):
        b = k * 360 / FALLBACK_EXITS
        la, lo = offset(lat, lon, b, 130)
        out.append({"name": None, "lat": la, "lon": lo, "bearing": round(b, 1), "axis": round(b, 1)})
    return out, "radial"


# ── one post → reports ──────────────────────────────────────────────────────

SITUATION_KIND = {"kettle": "kettle", "tear_gas": "tear_gas", "charge": "charge", "water_cannon": "water_cannon",
                  "reinforcements": "police_arrival", "advance": "police_arrival", "checkpoint": "police_arrival",
                  "clashes": "charge"}
PRECISE = {"site", "street", "district"}


def read_post(post: dict, situations: list[dict] | None = None, *, chat_city: str | None = None,
              protest_chat: bool = False) -> list[dict]:
    """The reports in one post: [{kind, words, place (gazetteer dict or
    None), lat, lon, place_name, precision, source}]. `post` has at least
    text, media, lat, lon, precision, place, summary_en; `situations` are
    the model's live events read out of it (telegram_situations rows)."""
    text = post.get("text") or ""
    t = fold(text)
    found = tactics(text)
    model = [s for s in (situations or []) if SITUATION_KIND.get(s.get("kind") or "")]
    if NOT_NOW.search(t) and not model:
        return []
    media = (post.get("media") or "none") in ("photo", "video")
    fr0 = came_from(text)
    gaz = place_in(text, chat_city, found[0]["start"] if found else 0, exclude={fr0["id"]} if fr0 else None)
    # footage: a picture or a video, captioned with a place, from a protest chat or about one
    if not found and media and gaz and (protest_chat or PROTEST_WORDS.search(t) or _POLICE.search(t)):
        found = [{"kind": "footage", "start": 0, "end": 0, "words": ""}]
    # a crowd needs a place that is a point, not a word
    found = [f for f in found if f["kind"] != "crowd" or gaz]
    if not found and not model:
        return []
    out: list[dict] = []
    kinds = [f["kind"] for f in found]
    for f in found:
        rep = {"kind": f["kind"], "words": f["words"], "vague": bool(f.get("vague")), "source": "rule"}
        if gaz:
            rep.update(place=gaz, lat=gaz["lat"], lon=gaz["lon"], place_name=gaz["name"], city=gaz["city"],
                       country=gaz["country"], precision=gaz["kind"])
            if gaz.get("line"):
                rep["street_line"] = [list(p) for p in gaz["line"]]
                # a named crossing on the street ("bd Voltaire à hauteur de Parmentier") puts it there
                other = place_in(t.replace(fold(gaz["name"]), " "), gaz["city"])
                if other and not other.get("line"):
                    rep.update(lat=other["lat"], lon=other["lon"], place_name=f"{gaz['name']} near {other['name']}")
        else:
            ms = next((s for s in model if s.get("lat") is not None and (s.get("precision") or "") in PRECISE | {"site"}), None)
            if ms:
                kn = place_by_name(ms.get("place"))
                if kn:
                    rep.update(place=kn, lat=kn["lat"], lon=kn["lon"], place_name=kn["name"], city=kn["city"],
                               country=kn["country"], precision=kn["kind"])
                else:
                    rep.update(place=None, lat=ms["lat"], lon=ms["lon"], place_name=str(ms.get("place") or "").split(",")[0],
                               city=_city_of(ms.get("place")), country=ms.get("country"), precision=ms.get("precision"))
                rep["source"] = "rule+model"
            elif post.get("lat") is not None and (post.get("precision") or "") in PRECISE:
                kn = place_by_name(post.get("place"))
                if kn:
                    rep.update(place=kn, lat=kn["lat"], lon=kn["lon"], place_name=kn["name"], city=kn["city"],
                               country=kn["country"], precision=kn["kind"])
                else:
                    rep.update(place=None, lat=post["lat"], lon=post["lon"], place_name=str(post.get("place") or "").split(",")[0],
                               city=_city_of(post.get("place")), country=post.get("country_code"), precision=post.get("precision"))
                rep["source"] = "rule+model"
            else:
                rep.update(place=None, lat=None, lon=None, place_name=None, city=None, country=post.get("country_code"),
                           precision=None)
        out.append(rep)
    # what the model saw and the rules did not ("la police encercle les manifestants" written another way)
    for s in model:
        k = SITUATION_KIND[s["kind"]]
        if k in kinds or s.get("lat") is None:
            continue
        kn = place_by_name(s.get("place"))
        out.append({"kind": k, "words": "", "vague": False, "source": "model",
                    "place": kn, "lat": kn["lat"] if kn else s["lat"], "lon": kn["lon"] if kn else s["lon"],
                    "place_name": kn["name"] if kn else str(s.get("place") or "").split(",")[0],
                    "city": kn["city"] if kn else _city_of(s.get("place")), "country": kn["country"] if kn else s.get("country"),
                    "precision": kn["kind"] if kn else s.get("precision"), "happening": s.get("happening")})
        kinds.append(k)
    # police coming: where from, when said
    for rep in out:
        if rep["kind"] in ("police_arrival", "charge") and rep.get("lat") is not None:
            fr = came_from(text, rep.get("place"))
            if fr:
                rep["from_place"] = fr["name"]
                b = None
                ex = load_exits().get(rep["place"]["id"]) if rep.get("place") else None
                for e in (ex or {}).get("exits") or []:
                    if fold(fr["name"]) in fold(e.get("name")) or fold(e.get("name")) in fold(fr["name"]):
                        b = e["bearing"]
                        break
                if b is None:
                    b = bearing(rep["lat"], rep["lon"], fr["lat"], fr["lon"])
                rep["from"] = dict(zip(("lat", "lon"), offset(rep["lat"], rep["lon"], b, FROM_M)))
                rep["from_bearing"] = round(b, 1)
    return out


def _city_of(place: str | None) -> str | None:
    parts = [p.strip() for p in str(place or "").split(",") if p.strip()]
    return parts[-2] if len(parts) >= 3 else (parts[0] if len(parts) == 2 else None)


# ── words for people ────────────────────────────────────────────────────────

def title_of(kind: str, place_name: str | None, city: str | None, from_place: str | None = None, vague: bool = False) -> str:
    where = place_name or "an unnamed place"
    if city and city not in where:
        where = f"{where} ({city})"
    on = "on" if place_name and re.match(r"(?i)(boulevard|rue|avenue|bd|autopista|quai)", place_name) else "at"
    if kind == "kettle":
        return f"Kettle at {where} — exits blocked"
    if kind == "tear_gas":
        return f"Tear gas used {on} {where}"
    if kind == "charge":
        return f"Police charge {on} {where}"
    if kind == "lbd":
        return f"Rubber bullets / LBD fired {on} {where}"
    if kind == "gunfire":
        return f"Shots fired {on} {where}"
    if kind == "water_cannon":
        return f"Water cannon used {on} {where}"
    if kind == "arrests":
        return f"Arrests {on} {where}"
    if kind == "police_arrival":
        if vague:
            return f"Movement reported {on} {where} (police or crowd)"
        return f"Police moving in {on} {where}" + (f" from {from_place}" if from_place else "")
    if kind == "barricade":
        return f"Barricades {on} {where}"
    if kind == "fire":
        return f"Fires {on} {where}"
    if kind == "crowd":
        return f"Crowd reported {on} {where}"
    return f"Footage from {where}"


GLOSS = {
    "kettle": "police are kettling people (blocking the exits)", "tear_gas": "tear gas is being fired",
    "charge": "police are charging", "lbd": "rubber bullets / LBD rounds are being fired", "gunfire": "shots are being fired",
    "water_cannon": "a water cannon is in use", "arrests": "people are being arrested",
    "police_arrival": "police are arriving or deploying", "barricade": "barricades are up", "fire": "fires are burning",
    "crowd": "a crowd is there", "footage": "footage posted from the scene",
}


def gloss(kind: str, place_name: str | None, vague: bool = False) -> str:
    """The rule's own English reading of a post, when the model has not
    translated it yet: what the words say, nothing added."""
    g = "things are moving (police or crowd)" if vague and kind == "police_arrival" else GLOSS.get(kind, "")
    return f"{g[:1].upper()}{g[1:]}{(' at ' + place_name) if place_name else ''}."


# ── signals ─────────────────────────────────────────────────────────────────

def _t(iso: str) -> _dt.datetime:
    d = _dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=_dt.timezone.utc)


def _iso(d: _dt.datetime) -> str:
    return d.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _zone(cc: str | None):
    try:
        import telegram_events as te
        return te.zone_for(None, cc) or _dt.timezone.utc
    except Exception:                                          # noqa: BLE001
        return _dt.timezone.utc


def _same_place(a: dict, b: dict) -> bool:
    if a.get("place") and b.get("place"):
        return a["place"]["id"] == b["place"]["id"]
    if a.get("lat") is None or b.get("lat") is None:
        return False
    return metres(a["lat"], a["lon"], b["lat"], b["lon"]) <= MERGE_M


def build(posts: list[dict], situations: dict | None = None, now: _dt.datetime | None = None,
          chats: dict | None = None) -> list[dict]:
    """Posts (dicts: channel, msg_id, channel_title, posted_at, text, media,
    thumb, summary_en, lat, lon, precision, place, country_code, reply_to)
    → street-report signals, newest first. Pure: tested without a
    database. `situations`: {(channel, msg_id): [model events]}; `chats`:
    {channel: {"city": …, "protest": bool}}."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    situations = situations or {}
    chats = chats or {}
    posts = sorted(posts, key=lambda p: p["posted_at"])
    reps: list[dict] = []
    last_by_chat: dict = {}
    for p in posts:
        ctx = chats.get(p["channel"]) or {}
        key = (p["channel"], p["msg_id"])
        text = p.get("text") or ""
        # a captionless picture or video right after a report in the same
        # chat (Telegram sends the words and the video as two messages)
        if not text.strip() and (p.get("media") or "none") in ("photo", "video"):
            prev = last_by_chat.get(p["channel"])
            if prev and 0 <= p["msg_id"] - prev["post"]["msg_id"] <= 3 \
                    and (_t(p["posted_at"]) - _t(prev["post"]["posted_at"])).total_seconds() <= 180:
                prev.setdefault("footage", []).append(p)
            continue
        for r in read_post(p, situations.get(key), chat_city=ctx.get("city"), protest_chat=bool(ctx.get("protest"))):
            r["post"] = p
            reps.append(r)
            last_by_chat[p["channel"]] = r
    groups: list[dict] = []
    for r in reps:
        t = _t(r["post"]["posted_at"])
        g = next((g for g in reversed(groups) if g["kind"] == r["kind"] and _same_place(g["anchor"], r)
                  and (t - g["last"]).total_seconds() / 60 <= MERGE_GAP_MIN), None)
        if g is None:
            g = {"kind": r["kind"], "anchor": r, "reps": [], "last": t}
            groups.append(g)
        g["reps"].append(r)
        g["last"] = max(g["last"], t)
        if g["anchor"].get("lat") is None and r.get("lat") is not None:
            g["anchor"] = r
    out = []
    for g in groups:
        a = g["anchor"]
        kind = g["kind"]
        verb, valid_min, sev = TACTICS[kind]
        age = (now - g["last"]).total_seconds() / 60
        if age > valid_min or age < -5:
            continue
        rs = g["reps"]
        first, last = rs[0]["post"], rs[-1]["post"]
        cc = a.get("country") or first.get("country_code")
        zone = _zone(cc)
        chans = list(dict.fromkeys(r["post"]["channel"] for r in rs))
        titles = list(dict.fromkeys(r["post"].get("channel_title") or r["post"]["channel"] for r in rs))
        n = len({(r["post"]["channel"], r["post"]["msg_id"]) for r in rs})
        if sev == "high" and (n >= 3 or len(chans) >= 2) and kind in ("kettle", "gunfire", "lbd", "tear_gas"):
            sev = "critical"
        elif sev == "moderate" and (n >= 3 or len(chans) >= 2):
            sev = "high"
        elif sev == "low" and n >= 4:
            sev = "moderate"
        vague = all(r.get("vague") for r in rs)
        from_place = next((r.get("from_place") for r in reversed(rs) if r.get("from_place")), None)
        frm = next((r.get("from") for r in reversed(rs) if r.get("from")), None)
        hhmm = g["last"].astimezone(zone).strftime("%H:%M")
        first_hhmm = _t(first["posted_at"]).astimezone(zone).strftime("%H:%M")
        title = title_of(kind, a.get("place_name"), a.get("city"), from_place, vague)
        sources = []
        footage = []
        for r in rs:
            p = r["post"]
            if any(s["channel"] == p["channel"] and s["msg_id"] == p["msg_id"] for s in sources):
                continue
            ftg = [f for f in r.get("footage") or []]
            footage += ftg
            media = p.get("media") if (p.get("media") or "none") != "none" else (ftg[0].get("media") if ftg else "none")
            thumb = p.get("thumb") or next((f.get("thumb") for f in ftg if f.get("thumb")), None)
            sources.append({
                "channel": p["channel"], "channel_title": p.get("channel_title") or p["channel"], "msg_id": p["msg_id"],
                "posted_at": p["posted_at"], "hhmm": _t(p["posted_at"]).astimezone(zone).strftime("%H:%M"),
                "text": (p.get("text") or "")[:400],
                "translation": (p.get("summary_en") or "").strip() or r.get("happening") or gloss(kind, a.get("place_name"), r.get("vague")),
                "translated_by": "model" if (p.get("summary_en") or r.get("happening")) else "rule",
                "words": r.get("words") or None, "media": media or "none",
                "thumb_url": f"/api/telegram/media/{thumb}" if thumb else None,
                "url": None if str(p["channel"]).startswith(("c/", "u/", "g/")) else f"https://t.me/{p['channel']}/{p['msg_id']}",
                "read_by": r.get("source"),
            })
        latest = sources[-1]
        span = f"at {first_hhmm}" if first_hhmm == hhmm else f"between {first_hhmm} and {hhmm}"
        count = f"{n} message{'s' if n != 1 else ''}" + (f" in {len(chans)} chats" if len(chans) > 1 else f" in {titles[0]}")
        quote = (latest["text"] or "").replace("\n", " ").strip()
        summary = (f"{title} — reported {span} local time ({count}); unverified. "
                   f"Latest, {latest['channel_title']} at {latest['hhmm']}: “{quote[:160]}{'…' if len(quote) > 160 else ''}” "
                   f"— {latest['translation']}")
        sig = {
            "id": f"tgr-{kind}-{first['channel']}-{first['msg_id']}", "kind": "street_report", "tactic": kind,
            "title": title, "headline": title, "summary": summary,
            "place": a.get("place_name"), "place_id": (a.get("place") or {}).get("id"), "city": a.get("city"),
            "country_code": (cc or "").lower() or None, "lat": a.get("lat"), "lon": a.get("lon"),
            "precision": a.get("precision"),
            "first_at": first["posted_at"], "at": last["posted_at"], "hhmm": hhmm, "age_min": round(max(0.0, age), 1),
            "valid_min": valid_min, "severity": sev,
            "n_messages": n, "n_channels": len(chans), "chats": titles, "channels": chans,
            "sources": sources, "media": next((s["media"] for s in reversed(sources) if s["media"] != "none"), "none"),
            "thumb_url": next((s["thumb_url"] for s in reversed(sources) if s["thumb_url"]), None),
            "url": latest["url"] or sources[0]["url"],
            "read_by": "+".join(sorted({x for s in sources for x in str(s["read_by"] or "rule").split("+")})),
            "vague": vague, "note": NOTE,
        }
        if a.get("lat") is not None:
            if kind == "tear_gas":
                sig["area"] = {"lat": a["lat"], "lon": a["lon"], "radius_m": min(260, 110 + 30 * (n - 1))}
            if kind == "kettle":
                ex, how = exits_for(a.get("place"), a["lat"], a["lon"])
                sig["exits"], sig["exits_from"] = ex, how
                sig["label"] = f"Kettled — exits blocked (reported {hhmm})"
            if kind in ("police_arrival", "charge") and frm:
                sig["from"], sig["from_place"] = frm, from_place
            if a.get("street_line") and kind in ("charge", "barricade", "police_arrival", "crowd", "fire", "tear_gas"):
                sig["street_line"] = a["street_line"]
        sig["label"] = sig.get("label") or f"{verb} ({hhmm})"
        out.append(sig)
    out.sort(key=lambda s: s["at"], reverse=True)
    return out


# ── reads ───────────────────────────────────────────────────────────────────

_cache: dict = {}
_lock = threading.Lock()
_chat_ctx: dict = {}


def chat_contexts(chans: list[str]) -> dict:
    """{channel: {city, protest}} from telegram_channels.json: the city a
    regional chat is about (GJ2026ARA → Lyon), and whether it is a
    protest chat (a group, or one read for calls and announcements)."""
    out = {}
    try:
        import telegram_ingest as tg
        with open(tg.CHANNELS_FILE) as fh:
            reg = json.load(fh)
    except Exception:                                          # noqa: BLE001
        reg = {}
    for c in chans:
        info = reg.get(c) or {}
        region = info.get("region")
        city = CITY_OF_REGION.get(region or "") or ("Paris" if (info.get("country") == "fr" and info.get("role") == "group") else None)
        protest = info.get("role") == "group" or bool(info.get("read_for")) or "gilets" in str(info.get("party") or "").lower()
        out[c] = {"city": city, "protest": protest}
    return out


def read(con, hours: float = LOOKBACK_H, now: _dt.datetime | None = None) -> list[dict]:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    cutoff = (now - _dt.timedelta(hours=hours)).isoformat()
    prev = con.row_factory
    con.row_factory = sqlite3.Row
    try:
        cols = {r[1] for r in con.execute("PRAGMA table_info(telegram_posts)")}
        if not cols:
            return []
        want = ["channel", "msg_id", "channel_title", "posted_at", "text", "media", "thumb", "summary_en", "lat", "lon",
                "precision", "place", "country_code", "role", "reply_to"]
        sel = ", ".join(c if c in cols else f"NULL AS {c}" for c in want)
        rows = [dict(r) for r in con.execute(
            f"SELECT {sel} FROM telegram_posts WHERE posted_at >= ? AND COALESCE(role,'') != 'ignore'"
            " ORDER BY posted_at DESC LIMIT 20000", (cutoff,))]
        # the cheap screen first: most posts say nothing of the street
        keep = []
        for r in rows:
            txt = r.get("text") or ""
            if cues(txt) or ((r.get("media") or "none") != "none" and (not txt.strip() or place_in(txt))):
                keep.append(r)
        sits: dict = {}
        try:
            for s in con.execute("SELECT channel, msg_id, kind, place, precision, lat, lon, country, happening"
                                 " FROM telegram_situations WHERE posted_at >= ?", (cutoff,)):
                sits.setdefault((s["channel"], s["msg_id"]), []).append(dict(s))
        except sqlite3.OperationalError:
            pass
        # a post the model read a development out of is a candidate even
        # when no word of the lexicon is in it
        have = {(r["channel"], r["msg_id"]) for r in keep}
        for r in rows:
            k = (r["channel"], r["msg_id"])
            if k in sits and k not in have:
                keep.append(r)
    finally:
        con.row_factory = prev
    return build(keep, sits, now, chat_contexts(list({r["channel"] for r in keep})))


def signals(hours: float = LOOKBACK_H, db_path: str | None = None) -> list[dict]:
    """Street-report signals of the last `hours`, newest first; cached CACHE_S."""
    key = (hours, db_path)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_S:
            return hit[1]
    import telegram_ingest as tg
    con = sqlite3.connect(db_path, timeout=30) if db_path else tg._con()
    try:
        out = read(con, hours)
    except sqlite3.OperationalError as e:
        print(f"[street-reports] error: read: {e}", flush=True)
        out = []
    finally:
        con.close()
    with _lock:
        _cache[key] = (time.time(), out)
    return out


def snapshot(hours: float = LOOKBACK_H) -> dict:
    """GET /api/routes/demonstrations/street."""
    sigs = signals(hours)
    return {"generated_at": _iso(_dt.datetime.now(_dt.timezone.utc)), "reports": sigs,
            "located": sum(1 for s in sigs if s["lat"] is not None), "note": NOTE}


SEV_TIER = {"critical": "critical", "high": "significant", "moderate": "elevated", "low": "elevated"}


def as_post(sig: dict) -> dict:
    """A street report in the shape of a telegram_ingest post, so the
    Telegram and unrest layers, the Desk and Home show it unchanged."""
    first, latest = sig["sources"][0], sig["sources"][-1]
    via = ", ".join(sig["chats"][:3]) + (f" and {len(sig['chats']) - 3} more" if len(sig["chats"]) > 3 else "")
    return {
        "id": sig["id"], "unified": True, "street_report": True, "headline": sig["title"], "summary_en": sig["summary"],
        "text": latest["text"], "lang": None, "channel": first["channel"], "channel_title": via,
        "posted_at": sig["at"], "first_at": sig["first_at"], "event_type": "unrest", "category": "unrest",
        "place": sig["place"], "precision": sig.get("precision") or "site", "country_code": sig["country_code"],
        "lat": sig["lat"], "lon": sig["lon"], "geocoded_as": sig["place"],
        "media": sig["media"], "thumb_url": sig["thumb_url"], "url": sig["url"],
        "also_reported_by": sig["chats"][1:], "views": None, "role": "group", "party": None,
        "claim": False, "first_hand": True, "msg_id": first["msg_id"],
        "severity_tier": SEV_TIER.get(sig["severity"], "elevated"), "signal_severity": sig["severity"],
        "graphic": False, "on_map": sig["lat"] is not None, "signal_kind": "street_report", "tactic": sig["tactic"],
        "n_messages": sig["n_messages"], "n_channels": sig["n_channels"], "sources": sig["sources"],
        "verification": f"{sig['n_messages']} Telegram message{'s' if sig['n_messages'] != 1 else ''} from the street — unverified",
    }


def posts(hours: float = LOOKBACK_H) -> list[dict]:
    return [as_post(s) for s in signals(hours)]

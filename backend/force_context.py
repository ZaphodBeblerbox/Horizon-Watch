"""
force_context.py — police is not the military (owner, 2026-10-23).

WHY. The owner saw Ukrainian military movement on the phone map as "Police
moving in". Production (2026-10-22, read-only): southfronteng/64842 "Russian
Army expands control west of Kupyansk, taking Moskovka and Malaya Shapkovka"
became "Police moving in at Palamarevka" (the model's situation kind
'advance' mapped to the street report 'police_arrival') and "Police charge
at Kupyansk" ('clashes' -> 'charge'). The street-report word list also
counted troops, soldiers and militaires as police.

THE RULE.
  police    law enforcement acting in a civil or protest context: police,
            gendarmerie, CRS, BAC, BRAV-M, riot police, Polizei, carabinieri,
            Guardia Civil, Mossos, GNB/PNB at a protest ...
  military  army, troops, soldiers, armoured vehicles, columns, brigades,
            artillery, the front, ZSU/VSU, Russian or Ukrainian forces, the
            IDF, Houthis, RSF ... and a war theatre's own context.
A text with military words, or from a war theatre without protest words,
is never police and never part of the Protests layer: it belongs to
troops_sighted and the frontline layers. Pure, no I/O.
"""
from __future__ import annotations

import re
import unicodedata

# where reporting of forces moving is war reporting unless it says protest
WAR_THEATRES = {"ua", "ru", "ps", "il", "lb", "ye", "sy", "sd", "ss", "so", "ml", "bf", "ne", "ly", "mm", "cd", "et", "ir", "iq", "af"}


def fold(s: str | None) -> str:
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.combining(c) or ord(c) > 0x2000)
    return unicodedata.normalize("NFC", t).lower().replace("’", "'")


MILITARY = re.compile(
    r"\b(?:army|armies|troops?|soldiers?|servicem[ae]n|military|militar(?:y|ies)|brigades?|battalions?|regiments?|divisions? (?:of|d)|"
    r"artillery|armou?red|tanks?|apcs?|ifvs?|bmp-?\d|btr-?\d|t-(?:72|80|90|64)|convoys?|columns? of|frontline|front line|"
    r"offensive|counter-?offensive|assault (?:group|troops)|marines|paratroop\w*|special forces|mercenar\w*|wagner|akhmat|"
    r"zsu|vsu|afu|idf|tsahal|hezbollah|houthis?|ansar allah|rsf|saf|hamas|qassam|pmc|"
    r"russian (?:forces|army|troops)|ukrainian (?:forces|army|troops)|israeli (?:forces|army|troops)|"
    r"armee|soldats?|militaires?|troupes?|blindes?|chars? d'assaut|colonne militaire|convoi militaire|bataillons?|regiments?|"
    r"artillerie|forces (?:russes|ukrainiennes|armees|israeliennes)|front\b(?= (?:de|du|russe|ukrainien))|"
    r"ejercito|tropas|soldados|militares|blindados|bundeswehr|soldaten|panzer|truppen|esercito|soldati)\b"
    r"|збройн\w*|зсу|всу|вс рф|армі\w*|арми\w*|войск\w*|військ\w*|бригад\w*|батальйон\w*|батальон\w*|полк\w*|"
    r"артилер\w*|артиллер\w*|техні\w*|техник\w*|бтр|бмп|танк\w*|штурм\w*|фронт\w*|окупант\w*|оккупант\w*|"
    r"جيش|جنود|الاحتلال|دبابات|آليات عسكرية|كتائب|سرايا|لواء|"
    r"စစ်ကောင်စီ|စစ်တပ်|စစ်သား|စစ်ကား")

POLICE = re.compile(
    r"\b(?:police|policiers?|policieres?|gendarm\w*|crs|bac|brav-?m|forces de l'ordre|fdo|flics?|keufs?|condes?|"
    r"riot police|cops?|polizei|polizisten|carabinieri|polizia|questura|guardia civil|mossos|ertzaintza|policia\w*|"
    r"gnb|pnb|guardia nacional|antidisturbios|uip|"
    r"lacrymo\w*|tear ?gas|lbd|flash-?ball|nasse|kettl\w*|canons? a eau|water cannons?|matraqu\w*|baton charge\w*)\b"
    r"|полиц\w*|поліц\w*|омон|росгвард\w*|ရဲ")

PROTEST = re.compile(
    r"\b(?:manif\w*|cortege|greve|grevistes?|blocages?|gilets? jaunes|lyceens?|etudiants?|protest\w*|demonstrat\w*|rall(?:y|ies)|"
    r"march(?:e|es|ers|ing)?|sit-in|rassemblement\w*|emeutes?|riots?|rioters|syndicats?|intersyndicale|"
    r"manifestaci\w*|marchas?|cacerolazo|planton|kundgebung|demo\b|corteo|presidio|sciopero)\b"
    r"|протест\w*|мітинг\w*|митинг\w*|متظاهر\w*|مظاهر\w*|ဆန္ဒပြ")


# The gendarmerie's own armour is law enforcement, not the army (owner, 2026-10-24: "Un blindé CENTAURE de la
# gendarmerie est déployé devant l'Assemblée nationale" was read as troops because of "blindé"). Read as the
# word "gendarmerie" before the military words are looked for; outside a war theatre only.
GENDARMERIE_ARMOUR = re.compile(
    r"\b(?:vehicules? )?blindes? (?:\w+ ){0,3}(?:de la |de |des |du )(?:gendarmerie|gendarmes|crs|police)\b|"
    r"\b(?:vehicules? )?blindes? (?:centaure|vbrg|vxb)\w*|\bcentaures?\b(?= .{0,30}gendarm)|\bvbrg\b|\bvxb-?\d*\b|"
    r"\barmou?red (?:\w+ ){0,2}(?:vehicles? )?(?:of|from) the (?:gendarmerie|police)\b|"
    r"\b(?:gendarmerie|police) (?:armou?red (?:vehicles?|cars?)|blindes?)\b")


def is_military(text: str | None, country_code: str | None = None) -> bool:
    """War reporting about armed forces: military words, or a war theatre
    with no protest words. Police words in a war theatre's text do not make
    it civil ("police" in Kupyansk is still the front)."""
    t = fold(text)
    if (country_code or "").lower() not in WAR_THEATRES:
        t = GENDARMERIE_ARMOUR.sub(" gendarmerie ", t)
    if MILITARY.search(t):
        # "la police et l'armée" at a protest: protest words and police words
        # outside a war theatre keep it civil, with the military named too
        if PROTEST.search(t) and POLICE.search(t) and (country_code or "").lower() not in WAR_THEATRES:
            return False
        return True
    if (country_code or "").lower() in WAR_THEATRES and not PROTEST.search(t):
        return True
    return False


def is_police(text: str | None, country_code: str | None = None) -> bool:
    """Law enforcement acting, in a civil context: police words and not war reporting."""
    t = fold(text)
    return bool(POLICE.search(t)) and not is_military(text, country_code)


def police_act_ok(text: str | None, country_code: str | None = None) -> bool:
    """May this text stand for a police act on the map (police_intervention, a
    kettle, a charge, police moving in)? Never in war reporting."""
    return not is_military(text, country_code)

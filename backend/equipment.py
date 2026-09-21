"""
equipment.py — weapon SYSTEM TYPES as first-class entities.

WHY THIS EXISTS. The ontology could say "Ukraine is allied with the UAE"
and "the UAE supplies Sudan", but it could never reach the finding the
operator actually wants out of that: that Ukrainian-origin materiel may
therefore turn up in Sudan. The reason is that there was no node in
between. Countries linked to countries and events linked to places, and
the *thing* that moves between them — a drone, a howitzer, a radar —
was not modelled at all. It only ever existed as words inside a
placemark title.

Built to the method in Noy & McGuinness, "Ontology Development 101".

STEP 1 — COMPETENCY QUESTIONS. These are the questions the layer exists
to answer, and the scope is exactly what they need, nothing more:

    1. What equipment has been observed in theatre X?
    2. Which faction operates system Y?
    3. Where does system Y come from — which country, which maker?
    4. Given that A supplies B, which of A's systems could appear in B?

STEP 4 — CLASSES, AND WHAT IS NOT ONE. An `equipment` node is a system
TYPE ("T-72"), never an individual vehicle. We observe hundreds of T-72s
and will never have identity for one of them, so the instance level is
not something this data can support, and pretending otherwise would
invent precision.

"Manufacturer" is deliberately NOT a class. Noy is explicit that a role
something plays is not a subclass of it: a company that makes a drone is
an organisation that happens to manufacture, exactly as it may also be
sanctioned or own a vessel. It is an `org` node with a `manufactures`
edge, so the sanctions layer and the ownership layer can see the same
company we do. Inventing `manufacturer:` would have split one firm into
two nodes that never meet.

STEP 4b — THE HIERARCHY. Eight families, each with a handful of kinds,
because Noy's rule of thumb is that siblings belong at the same level of
generality and a class with fifty direct children is really a missing
level. "Loitering munition" sits under `unmanned` rather than under
`missile` on purpose: a Lancet is recovered, cued and flown like a drone
and reported like one, and our evidence is drone reporting.

WHAT THIS IS NOT. The gazetteer is curated, and it says so: every entry
carries its origin as a claim with a method, never as an anonymous fact.
Origins here are stable public attribution of a system's design lineage
("the T-72 is a Soviet design"), which is not the same claim as who
supplied a particular unit — that is what the transfer layer is for, and
it is inferred, and it is capped below certainty.
"""
from __future__ import annotations
import re
from typing import Iterable

# ── Step 4b: the class hierarchy ──────────────────────────────────────
# family -> kinds. Kept shallow on purpose; a deeper tree than this is
# not supported by evidence that is mostly one line of placemark text.
FAMILIES: dict[str, tuple[str, ...]] = {
    "unmanned":     ("uav", "loitering_munition", "usv", "ugv"),
    "armour":       ("mbt", "ifv", "apc"),
    "artillery":    ("spg", "towed_artillery", "mlrs"),
    "air_defence":  ("sam", "manpads", "radar"),
    "aviation":     ("fixed_wing", "rotary"),
    "missile":      ("ballistic", "cruise"),
    "anti_armour":  ("atgm",),
    "support":      ("ew", "utility"),
}

KIND_FAMILY: dict[str, str] = {k: f for f, ks in FAMILIES.items() for k in ks}


def family_of(kind: str) -> str | None:
    """The family a kind belongs to — the is-a step up the hierarchy."""
    return KIND_FAMILY.get(kind)


# ── The gazetteer ─────────────────────────────────────────────────────
# name -> (kind, origin ISO2 or None, aliases)
#
# `origin` is DESIGN LINEAGE, not the supplier of any observed unit.
# None where lineage is genuinely mixed or not a single state (an "FPV
# drone" is a category of improvised airframe, not a product of a
# country), because a guess here would propagate into every inference
# built on top of it.
GAZETTEER: dict[str, tuple[str, str | None, tuple[str, ...]]] = {
    # unmanned — the systems this corpus is actually dense in
    "Lancet":        ("loitering_munition", "RU", ("Izdeliye-51", "Izdeliye 51")),
    "Shahed":        ("loitering_munition", "IR", ("Shahed-136", "Shahed 136", "Shahed-131")),
    "Geran":         ("loitering_munition", "RU", ("Geran-2", "Geran 2")),
    "Switchblade":   ("loitering_munition", "US", ()),
    "Bayraktar":     ("uav", "TR", ("TB2", "Bayraktar TB2")),
    "Orlan":         ("uav", "RU", ("Orlan-10", "Orlan 10")),
    "Zala":          ("uav", "RU", ("Zala 421",)),
    "Supercam":      ("uav", "RU", ()),
    "Mavic":         ("uav", "CN", ()),
    "Baba Yaga":     ("uav", None, ()),
    "Vampire":       ("uav", "UA", ()),
    "Molniya":       ("uav", "RU", ()),
    "Magura":        ("usv", "UA", ("Magura V5",)),
    "Sea Baby":      ("usv", "UA", ()),
    # armour
    "T-72":          ("mbt", "RU", ("T-72B", "T-72B3", "T-72AV")),
    "T-80":          ("mbt", "RU", ("T-80BV", "T-80BVM", "T-80U")),
    "T-90":          ("mbt", "RU", ("T-90M", "T-90A")),
    "T-64":          ("mbt", "UA", ("T-64BV",)),
    "T-62":          ("mbt", "RU", ("T-62M",)),
    "Leopard":       ("mbt", "DE", ("Leopard 1", "Leopard 2", "Leopard 2A4", "Leopard 2A6")),
    "Abrams":        ("mbt", "US", ("M1 Abrams", "M1A1")),
    "Challenger":    ("mbt", "GB", ("Challenger 2",)),
    "BMP-1":         ("ifv", "RU", ("BMP-1AM",)),
    "BMP-2":         ("ifv", "RU", ()),
    "BMP-3":         ("ifv", "RU", ()),
    "BMD-2":         ("ifv", "RU", ()),
    "Bradley":       ("ifv", "US", ("M2 Bradley", "M2A2")),
    "BTR-80":        ("apc", "RU", ()),
    "BTR-82":        ("apc", "RU", ("BTR-82A", "BTR-82AT")),
    "BTR-4":         ("apc", "UA", ("BTR-4E",)),
    "M113":          ("apc", "US", ()),
    # artillery
    "2S1":           ("spg", "RU", ("2S1 Gvozdika",)),
    "2S3":           ("spg", "RU", ("2S3 Akatsiya",)),
    "2S19":          ("spg", "RU", ("2S19 Msta-S",)),
    "PzH 2000":      ("spg", "DE", ("PzH2000",)),
    "Caesar":        ("spg", "FR", ()),
    "Archer":        ("spg", "SE", ()),
    "D-20":          ("towed_artillery", "RU", ()),
    "D-30":          ("towed_artillery", "RU", ()),
    "2A65":          ("towed_artillery", "RU", ("2A65 Msta-B",)),
    "M777":          ("towed_artillery", "US", ()),
    "MT-12":         ("towed_artillery", "RU", ()),
    "BM-21":         ("mlrs", "RU", ("BM-21 Grad",)),
    "BM-27":         ("mlrs", "RU", ("BM-27 Uragan",)),
    "BM-30":         ("mlrs", "RU", ("BM-30 Smerch",)),
    "HIMARS":        ("mlrs", "US", ("M142 HIMARS",)),
    "TOS-1A":        ("mlrs", "RU", ("TOS-1",)),
    "Grad":          ("mlrs", "RU", ()),
    "Uragan":        ("mlrs", "RU", ()),
    "Smerch":        ("mlrs", "RU", ()),
    # air defence
    "S-300":         ("sam", "RU", ()),
    "S-400":         ("sam", "RU", ()),
    "Buk":           ("sam", "RU", ("Buk-M1", "Buk-M2", "Buk-M3")),
    "Tor":           ("sam", "RU", ("Tor-M1", "Tor-M2")),
    "Pantsir":       ("sam", "RU", ("Pantsir-S1",)),
    "Osa":           ("sam", "RU", ("Osa-AKM",)),
    "Strela":        ("sam", "RU", ("Strela-10",)),
    "Patriot":       ("sam", "US", ("MIM-104",)),
    "IRIS-T":        ("sam", "DE", ()),
    "NASAMS":        ("sam", "NO", ()),
    "Gepard":        ("sam", "DE", ()),
    "Igla":          ("manpads", "RU", ()),
    "Stinger":       ("manpads", "US", ("FIM-92",)),
    "P-18":          ("radar", "RU", ()),
    "Neva-B":        ("radar", "RU", ()),
    "MR-231":        ("radar", "RU", ()),
    # missiles
    "Iskander":      ("ballistic", "RU", ("Iskander-M",)),
    "Tochka":        ("ballistic", "RU", ("Tochka-U",)),
    "Kalibr":        ("cruise", "RU", ()),
    "Kh-101":        ("cruise", "RU", ()),
    "Kinzhal":       ("cruise", "RU", ()),
    "Krasnopol":     ("cruise", "RU", ()),
    # anti-armour
    "Javelin":       ("atgm", "US", ("FGM-148",)),
    "NLAW":          ("atgm", "GB", ()),
    # support
    "Ural-4320":     ("utility", "RU", ()),
    "BREM-1":        ("utility", "RU", ()),
    "IMR-2":         ("utility", "RU", ()),
}

# An FPV drone is a real and overwhelmingly common observation (10,214
# placemarks) but it is a CATEGORY of improvised airframe, not a product
# with a maker or a country. It is modelled, and its origin is null, so
# that nothing downstream can infer a supplier from it.
GENERIC: dict[str, str] = {
    "FPV":  "uav",
    "UGV":  "ugv",
    "USV":  "usv",
}

# Designators that the pattern below matches and that are not equipment.
# Every one of these was found in the live corpus: "Vid 1" and "Pic 2"
# are the source-video markers GeoConfirmed puts in its own titles, and
# they were the two most frequent "systems" in the whole dataset.
STOPWORDS = frozenset({
    "VID", "PIC", "IMG", "OBR", "NO", "PART", "POV", "UTC", "KM", "MM",
    "AM", "PM", "NR", "REF", "FIG", "MAP", "SEC", "MIN", "GMT", "EST",
    "A1", "B1", "C1", "M2", "K2", "T1", "T2", "S1", "S2", "V1", "V2",
})

# 2S1, T-72, BM-21, BTR-82A, MR-231, Kh-101. Deliberately requires a
# digit: a bare capitalised word is a place or a person far more often
# than it is a weapon, and those are what the gazetteer is for.
DESIGNATOR_RE = re.compile(
    r"\b("
    r"[A-Z][A-Za-z]{0,4}-\d{1,4}[A-Z]{0,3}"   # T-72, BTR-82A, Kh-101
    r"|\d[A-Z]\d{1,3}[A-Z]?"                  # 2S1, 2A65, 2S19
    r"|[A-Z]{2,6}-?\d{2,4}"                   # M777, MIM104
    r")\b"
)


def canonical(raw: str) -> str:
    """One spelling per system.

    "BTR 82A", "BTR-82A" and "btr-82a" are the same vehicle, and left
    alone they became three nodes that never linked to each other.
    """
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s*-\s*", "-", s)
    # "BTR 82A" -> "BTR-82A": a space between a letter group and a
    # digit group is the same separator as a hyphen, and treating it
    # as different split systems across two nodes.
    s = re.sub(r"^([A-Za-z]{1,5})\s+(\d)", r"\1-\2", s)
    return s


_ALIAS: dict[str, str] = {}
for _name, (_kind, _origin, _aliases) in GAZETTEER.items():
    _ALIAS[canonical(_name).lower()] = _name
    for _a in _aliases:
        _ALIAS[canonical(_a).lower()] = _name
for _g in GENERIC:
    _ALIAS[_g.lower()] = _g


def resolve(token: str) -> str | None:
    """A raw token to its canonical system name, or None if unknown."""
    t = canonical(token).lower()
    if t in _ALIAS:
        return _ALIAS[t]
    # "T-72B3" resolves to "T-72": a variant is the same system for
    # every question this layer answers, and splitting them would
    # scatter the evidence across a dozen one-observation nodes.
    base = re.match(r"^([a-z]{1,5}-\d{1,4})", t)
    if base and base.group(1) in _ALIAS:
        return _ALIAS[base.group(1)]
    return None


def kind_of(name: str) -> str | None:
    if name in GAZETTEER:
        return GAZETTEER[name][0]
    return GENERIC.get(name)


def origin_of(name: str) -> str | None:
    """Design-lineage country, or None where there honestly is not one."""
    if name in GAZETTEER:
        return GAZETTEER[name][1]
    return None


def _loose(candidate: str) -> str:
    """A pattern that tolerates how people actually type a designator.

    "BTR-82A", "BTR 82A" and "BTR82A" are one vehicle. Matching the
    literal spelling only found the first, which quietly halved the
    evidence for every hyphenated system in the gazetteer.
    """
    return r"\b" + re.escape(candidate).replace(r"\-", r"[-\s]?") + r"\b"


def extract(text: str) -> list[str]:
    """Canonical system names mentioned in a piece of text, deduplicated.

    Word-boundary matched, which is not a detail: substring matching
    reported "Tor" 6,933 times because it is inside "history" and
    "Volgograd" is inside "Grad". The honest counts are 88 and 334.
    """
    if not text:
        return []
    out: list[str] = []
    seen: set[str] = set()

    for name in GAZETTEER:
        for candidate in (name, *GAZETTEER[name][2]):
            if re.search(_loose(candidate), text, re.I):
                if name not in seen:
                    seen.add(name)
                    out.append(name)
                break

    for g in GENERIC:
        if g not in seen and re.search(r"\b" + re.escape(g) + r"\b", text, re.I):
            seen.add(g)
            out.append(g)

    for tok in DESIGNATOR_RE.findall(text):
        if tok.upper().replace("-", "") in STOPWORDS or tok.upper() in STOPWORDS:
            continue
        name = resolve(tok)
        if name and name not in seen:
            seen.add(name)
            out.append(name)

    return out


def extract_all(texts: Iterable[str]) -> dict[str, int]:
    """Mention counts across a corpus — how the gazetteer is audited."""
    counts: dict[str, int] = {}
    for t in texts:
        for name in extract(t):
            counts[name] = counts.get(name, 0) + 1
    return counts
